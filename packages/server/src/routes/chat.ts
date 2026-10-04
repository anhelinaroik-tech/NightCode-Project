import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamText as aiStreamText } from "ai";
import { db } from "@nightcode/database/client";
import { Mode, MessageStatus } from "@nightcode/database/enums";
import { type ChatStreamEvent } from "@nightcode/shared";
import {isSupportedChatModel, resolveChatModel} from "../lib/models";
import * as Sentry from "@sentry/hono/bun";

const submitSchema = z.object({
    content: z.string().trim().min(1, "Message cannot be empty"),
    mode: z.enum(Mode),
    model: z.string().refine(isSupportedChatModel, "Unsupported chat model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
    if(!result.success){
        return c.json({error:"Invalid request body"}, 400);
    }
});

type ActiveStream = {
    abortController: AbortController;
    finished: Promise<void>;
    release: () => void;
};

// One stream per session, shared by submit and resume, so messages are persisted in order
const activeStreams = new Map<string, ActiveStream>();

// Takes the session's stream slot and aborts the previous holder.
// Await `previous` before persisting anything, so its interrupted reply is stored first.
function claimStream(sessionId: string) {
    const previous = activeStreams.get(sessionId);
    previous?.abortController.abort();

    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
    });
    const entry: ActiveStream = {
        abortController: new AbortController(),
        finished,
        release: () => {
            if (activeStreams.get(sessionId) === entry) activeStreams.delete(sessionId);
            resolveFinished();
        },
    };
    activeStreams.set(sessionId, entry);

    return { entry, previous: previous?.finished ?? Promise.resolve() };
}

//conv history
// Strip error messages and empty assistant messages from the conversation
function buildConversationHistory(
    messages: {role: "USER" | "ASSISTANT" | "ERROR"; content: string; status: MessageStatus }[],
){
    return messages.flatMap((m)=> {
        if(m.role==="ERROR") return [];
        if(m.role ==="ASSISTANT" && m.content.length ===0) return [];
        return[
            {role: m.role === "USER" ? ("user" as const): ("assistant" as const), content: m.content
            },
        ];
    });
};

function getResumableUserMessage(
    messages:{ role: "USER" | "ASSISTANT" | "ERROR"; 
        model: string; 
        mode: Mode
    }[],
){
    const lastMessage = messages[messages.length-1];
    if(!lastMessage || lastMessage.role !== "USER"){
        return null;
    }

    return lastMessage;
}

type StreamParams = {
    sessionId: string;
    model: string;
    history: { role: "user" | "assistant"; content: string }[];
    mode: Mode;
    abortController: AbortController;
};

async function streamAIResponse(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    params: StreamParams,
) {
    const {sessionId, model, history, mode, abortController} = params;
    const startTime = Date.now();
    const resolvedModel = resolveChatModel(model);
    let fullText = "";

    // Always persist, so an empty interrupted reply is not auto-resumed on reopen
    const persistInterruptedMessage = async () => {
        const elapsedMs = Date.now() - startTime;

        await db.message.create({
            data:{
                sessionId,
                role: "ASSISTANT",
                status: MessageStatus.INTERRUPTED,
                model,
                content: fullText,
                mode,
                duration: Math.round(elapsedMs / 1000),
            },
        });
    };

    try {
        const result = aiStreamText({
            model: resolvedModel.model,
            messages: history,
            abortSignal: abortController.signal,
        });

        for await(const part of result.fullStream){
            if(stream.aborted) break;

            if(part.type === "text-delta"){
                fullText += part.text;
                const event: ChatStreamEvent = {type: "text-delta", text: part.text};
                await stream.writeSSE({event: "text-delta", data: JSON.stringify(event)});
            }

            if(part.type === "error"){
                throw part.error;
            }
        }

        if(stream.aborted || abortController.signal.aborted) {
            await persistInterruptedMessage();
            return;
        }

        // thats how we know when streaming is finished
        const elapsedMs = Date.now() - startTime;
        const assistantMessage=await db.message.create({
            data: {
                sessionId,
                role: "ASSISTANT",
                status: MessageStatus.COMPLETE,
                model,
                content: fullText,
                mode,
                duration: Math.round(elapsedMs / 1000),
            },
        });

        const doneEvent: ChatStreamEvent={
            type: "done",
            messageId: assistantMessage.id,
            durationMs: elapsedMs,
        };

        await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvent)});
    } catch (err) {
        if (abortController.signal.aborted){
            await persistInterruptedMessage();
            return;
        }

        Sentry.captureException(err);
        const message = err instanceof Error ? err.message : String(err);

        // A failed save must not hide the model error from the client
        try {
            await db.message.create({
                data:{
                    sessionId,
                    role: "ERROR",
                    status: MessageStatus.COMPLETE,
                    model,
                    content: message,
                    mode,
                },
            });
        } catch (dbErr) {
            Sentry.captureException(dbErr);
        }

        const errorEvent: ChatStreamEvent = { type: "error", message};
        await stream.writeSSE({event: "error", data: JSON.stringify(errorEvent)});
    }
};

function streamChat(
    c: Context,
    entry: ActiveStream,
    params: Omit<StreamParams, "abortController">,
) {
    const { abortController } = entry;
    try {
        return streamSSE(
            c,
            async (stream) => {
                // Stop the model request when the client disconnects
                stream.onAbort(() => {
                    abortController.abort();
                });

                try {
                    await streamAIResponse(stream, { ...params, abortController });
                } finally {
                    entry.release();
                }
            },
            async (err, stream) => {
                entry.release();
                const message = err instanceof Error ? err.message : String(err);
                const errorEvent: ChatStreamEvent = {type: "error", message};
                await stream.writeSSE({event: "error", data: JSON.stringify(errorEvent)});
            },
        );
    } catch (error) {
        entry.release();
        throw error;
    }
}

const app = new Hono()
// Stream a reply to the last user message that is already stored, instead of posting it again
    .post("/:sessionId/resume", async (c)=>{
        const sessionId = c.req.param("sessionId");

        const session = await db.session.findUnique({
            where: {id: sessionId },
            include: {messages: {orderBy: {createdAt: "asc"}}},
        });

        if(!session){
            return c.json({error: "Session not found"}, 404);
        }

        const resumableMessage = getResumableUserMessage(session.messages);
        if(!resumableMessage){
            return c.json({error: "Session has no pending user message to resume"}, 409);
        }

        if(!isSupportedChatModel(resumableMessage.model)){
            return c.json({error: `Session uses unsupported model: ${resumableMessage.model}`}, 409);
        }

        if(activeStreams.has(sessionId)){
            return c.json({
                error: "Session already has an active stream"
            }, 409);
        }

        const { entry } = claimStream(sessionId);
        return streamChat(c, entry, {
            sessionId,
            model: resumableMessage.model,
            history: buildConversationHistory(session.messages),
            mode: resumableMessage.mode,
        });
    })
    .post("/:sessionId", submitValidator, async (c)=>{
        const sessionId = c.req.param("sessionId");
        const data = c.req.valid("json");

        const { entry, previous } = claimStream(sessionId);
        try {
            await previous;

            const session=await db.session.findUnique({
                where:{id: sessionId},
                include: { messages:{orderBy:{createdAt:"asc"}}},
            });

            if(!session){
                entry.release();
                return c.json({error: "Session not found"}, 404);
            }

            await db.message.create({
                data:{
                    sessionId,
                    role: "USER",
                    status: MessageStatus.COMPLETE,
                    model: data.model,
                    content: data.content,
                    mode: data.mode,
                },
            });

            const history = buildConversationHistory([
                ...session.messages, // todo limit to 5-10 messages
                {
                    role: "USER" as const, 
                    content: data.content, 
                    status: MessageStatus.COMPLETE
                },
            ]);

            return streamChat(c, entry, {
                sessionId,
                model: data.model,
                history,
                mode: data.mode,
            });
        } catch (error) {
            entry.release();
            throw error;
        }
    });

    export default app;
