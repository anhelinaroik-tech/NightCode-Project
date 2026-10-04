import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamText as aiStreamText, stepCountIs } from "ai";
import { db } from "@nightcode/database/client";
import { Mode, MessageStatus } from "@nightcode/database/enums";
import { 
    type ChatStreamEvent,
    type MessagePart,
    toolCallArgsSchema,
    messagePartsSchema,
 } from "@nightcode/shared";
import {isSupportedChatModel, resolveChatModel} from "../lib/models";
import {createTools} from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import { Prisma } from "@nightcode/database";
import type { AuthenticatedEnv } from "../middleware/require-auth";
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
    cwd: string | null;
    history: { role: "user" | "assistant"; content: string }[];
    mode: Mode;
    abortController: AbortController;
};

async function streamAIResponse(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    params: StreamParams,
) {
    const {sessionId, model, cwd, history, mode, abortController} = params;
    const startTime = Date.now();
    const tools  = cwd ? createTools(cwd, mode) : undefined;
    const parts: MessagePart[] = [];
    const resolvedModel = resolveChatModel(model);

    const getFullText = () =>
        parts
            .filter((p)=> p.type === "text")
            .map((p)=> p.text)
            .join(" ");

    // Attach a tool's output (or error) to its call and forward it to the client
    const recordToolResult = async (toolCallId: string, result: string) => {
        const tcPart = parts.find(
            (p): p is Extract<MessagePart, {type: "tool-call"}> =>
                p.type === "tool-call" && p.id === toolCallId,
        );

        if(tcPart) {
            tcPart.result = result;
        }

        const event: ChatStreamEvent = {
            type: "tool-result",
            toolCallId,
            result,
        };

        await stream.writeSSE({event: "tool-result", data: JSON.stringify(event)});
    };

    const getValidatedParts = (): Prisma.InputJsonValue | undefined =>
        parts.length > 0 ? messagePartsSchema.parse(parts) : undefined;

    // Always persist, so an empty interrupted reply is not auto-resumed on reopen
    const persistInterruptedMessage = async () => {
        const fullText = getFullText();
        const elapsedMs = Date.now() - startTime;
        const validatedParts = getValidatedParts();

        await db.message.create({
            data:{
                sessionId,
                role: "ASSISTANT",
                status: MessageStatus.INTERRUPTED,
                model,
                content: fullText,
                parts: validatedParts,
                mode,
                duration: Math.round(elapsedMs / 1000),
            },
        });
    };

    try {
        const result = aiStreamText({
            model: resolvedModel.model,
            system: buildSystemPrompt({cwd, mode}),
            messages: history,
            tools, 
            stopWhen: tools ? stepCountIs(50) :undefined,
            providerOptions: resolvedModel.providerOptions,
            abortSignal: abortController.signal,
        });

        for await(const part of result.fullStream){
            if(stream.aborted) break;

            if(part.type === "reasoning-delta"){
                const last = parts[parts.length-1];
                // if last part still reasoning?
                if(last && last.type === "reasoning"){
                    // adding new blocks to the line
                    last.text += part.text;
                }else{
                    // ending this part and moving to another
                    parts.push({type: "reasoning", text: part.text});
                }
                const event: ChatStreamEvent = { type: "reasoning-delta", text: part.text};
                await stream.writeSSE({
                    event: "reasoning-delta", 
                    data: JSON.stringify(event)
                });
            }

            if(part.type === "text-delta"){
                const last = parts[parts.length-1];
                if(last && last.type === "text"){
                    last.text += part.text;
                } else{
                    parts.push({type: "text", text: part.text});
                }

                const event: ChatStreamEvent = {type: "text-delta", text: part.text};
                await stream.writeSSE({event: "text-delta", data: JSON.stringify(event)});
            }

            if(part.type === "tool-call"){
                // Malformed input is reported back as a tool-error, so don't end the response here
                const parsedArgs = toolCallArgsSchema.safeParse(part.input);
                const args = parsedArgs.success ? parsedArgs.data : {};

                parts.push({
                    type: "tool-call",
                    id: part.toolCallId,
                    name: part.toolName,
                    args,
                });

                const event: ChatStreamEvent = {
                    type: "tool-call",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args,
                };
                await stream.writeSSE({event: "tool-call", data: JSON.stringify(event)});
            }

            if(part.type === "tool-result"){
                const resultStr = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
                await recordToolResult(part.toolCallId, resultStr);
            }

            // Invalid input or a throwing execute(): the model sees the error and the conversation continues
            if(part.type === "tool-error"){
                const message = part.error instanceof Error ? part.error.message : String(part.error);
                await recordToolResult(part.toolCallId, `Error: ${message}`);
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
                content: getFullText(),
                parts: getValidatedParts(),
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

const app = new Hono<AuthenticatedEnv>()
// Stream a reply to the last user message that is already stored, instead of posting it again
    .post("/:sessionId/resume", async (c)=>{
        const sessionId = c.req.param("sessionId");
        const userId = c.get("userId");

        const session = await db.session.findUnique({
            where: {id: sessionId, userId},
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
            cwd: session.cwd,
            history: buildConversationHistory(session.messages),
            mode: resumableMessage.mode,
        });
    })
    .post("/:sessionId", submitValidator, async (c)=>{
        const sessionId = c.req.param("sessionId");
        const userId = c.get("userId");
        const data = c.req.valid("json");

        // Check ownership before claiming the stream slot, so a user can't abort someone else's stream
        const ownedSession = await db.session.findUnique({
            where: {id: sessionId, userId},
            select: {id: true},
        });
        if(!ownedSession){
            return c.json({error: "Session not found"}, 404);
        }

        const { entry, previous } = claimStream(sessionId);
        try {
            await previous;

            const session=await db.session.findUnique({
                where:{id: sessionId, userId},
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
                cwd: session.cwd,
                history,
                mode: data.mode,
            });
        } catch (error) {
            entry.release();
            throw error;
        }
    });

    export default app;
