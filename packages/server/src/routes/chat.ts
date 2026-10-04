import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { db } from "@nightcode/database/client";
import type { Prisma } from "@nightcode/database";
import {
  getToolContracts,
  modeSchema,
  type ModeType,
  type ToolContracts,
} from "@nightcode/shared";
import { buildSystemPrompt } from "../system-prompt";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { calculateCreditsForUsage } from "../lib/credits";
import { ingestAiUsage } from "../lib/polar";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import * as Sentry from "@sentry/hono/bun";

type ChatMessageMetadata = {
    mode?: ModeType;
    model?: string;
    durationMs?: number;
    usage?: LanguageModelUsage;
};

type NightcodeUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;

const submitSchema = z.object({
    id: z.string(),
    messages: z.
        array(
            z.custom<NightcodeUIMessage>((value)=>{
                return value != null && typeof value === "object" && "id" in value && "parts" in value;
            }),
        )
        .min(1),
    mode: modeSchema,
    model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
    if(!result.success){
        return c.json({error: "Invalid request body"}, 400);
    }
});

function hasPendingToolCalls(message: NightcodeUIMessage){
    return message.parts.some((part)=>{
        if(part.type === "dynamic-tool" || part.type.startsWith("tool-")){
            const state = (part as {state?: string}).state;
            return state !== "output-available" && state !== "output-error";
        }

        return false;
    });
}

// Only the token totals feed billing, so the detail breakdowns come from the latest step
function addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
    // A step without a count must not wipe out the counts already known from earlier steps
    const sum = (x: number | undefined, y: number | undefined) =>
        x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
    return {
        ...b,
        inputTokens: sum(a.inputTokens, b.inputTokens),
        outputTokens: sum(a.outputTokens, b.outputTokens),
        totalTokens: sum(a.totalTokens, b.totalTokens),
    };
}

const INGEST_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

// Polar deduplicates events by external_id, so retrying with the same eventId can't bill twice.
async function ingestAiUsageWithRetry(params: Parameters<typeof ingestAiUsage>[0]) {
    for (let attempt = 0; ; attempt++) {
        try {
            await ingestAiUsage(params);
            return;
        } catch (error) {
            const delay = INGEST_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) throw error;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

const app = new Hono<AuthenticatedEnv>()
    .post(
        "/",
        requireCreditsBalance,
        submitValidator,
        async (c)=>{
            const userId = c.get("userId");
            const {id, messages, mode, model} = c.req.valid("json");

            const session = await db.session.findUnique({
                where:{id, userId},
            });

            if(!session){
                return c.json({error: "Session not found"}, 404);
            }

            const startTime = Date.now();
            const tools = getToolContracts(mode);
            const resolvedModel = resolveChatModel(model);
            const previousMessages = Array.isArray(session.messages)
                ? (session.messages as unknown as NightcodeUIMessage[])
                : [];
            const mergedMessages = [...previousMessages];

            for (const message of messages){
                const incomingMessage = {
                    ...message,
                    metadata: {...message.metadata, mode, model},
                } satisfies NightcodeUIMessage;

                const existingMessageIndex = mergedMessages.findIndex((m) => m.id === incomingMessage.id);

                if(existingMessageIndex === -1){
                    mergedMessages.push(incomingMessage);
                } else {
                    mergedMessages[existingMessageIndex] = incomingMessage;
                }
            }

            const  nextMessages =  await validateUIMessages<NightcodeUIMessage>({
                messages: mergedMessages,
                tools,

            });
        
            const modelMessages = await convertToModelMessages(nextMessages, {tools});
            // Summed per finished step, so an aborted or failed request is still billed for the
            // steps that completed. Every request (including tool-result resubmits) is its own event.
            let completedUsage: LanguageModelUsage | null = null;
            const requestId = crypto.randomUUID();
            let usageIngestionStarted = false;

            const ingestUsage = (outcome: "complete" | "aborted" | "error") => {
                if (!completedUsage || usageIngestionStarted) return;
                usageIngestionStarted = true;
                const usage = completedUsage;

                // Not awaited: a slow or failing Polar must not delay or break the reply
                void (async () => {
                    try {
                        const billableUsage = calculateCreditsForUsage({
                            provider: resolvedModel.provider,
                            model: resolvedModel.modelId,
                            usage,
                        });

                        await ingestAiUsageWithRetry({
                            externalCustomerId: userId,
                            eventId: `chat-request:${requestId}`,
                            credits: billableUsage.credits,
                        });
                    } catch (error) {
                        Sentry.captureException(error);
                        console.error("Failed to ingest Polar AI usage for chat request", {
                            error,
                            sessionId: id,
                            requestId,
                            outcome,
                            userId,
                        });
                    }
                })();
            };

            const result = streamText({
                model: resolvedModel.model,
                system: buildSystemPrompt({mode}),
                messages: modelMessages,
                tools,
                providerOptions: resolvedModel.providerOptions,
                // Stop the model when the client disconnects or the user interrupts
                abortSignal: c.req.raw.signal,
                onStepFinish(step){
                    completedUsage = completedUsage ? addUsage(completedUsage, step.usage) : step.usage;
                },
                onFinish(){
                    ingestUsage("complete");
                },
                onAbort(){
                    ingestUsage("aborted");
                },
                onError({error}){
                    Sentry.captureException(error);
                    ingestUsage("error");
                },
            });

            return result.toUIMessageStreamResponse<NightcodeUIMessage>({
                originalMessages: nextMessages,
                messageMetadata({part}){
                    if(part.type === "start"){
                        return {mode, model};
                    }

                    if (part.type !== "finish") return undefined;

                    return {
                        mode, 
                        model,
                        durationMs: Date.now() - startTime,
                        ...(completedUsage ? {usage: completedUsage} : {}),
                    };
                },
                async onFinish(event){
                    if (event.isAborted) return;

                    if (hasPendingToolCalls(event.responseMessage)) return;

                    await db.session.update({
                        where: { id, userId},
                        data: {
                            messages: event.messages as unknown as Prisma.InputJsonValue,
                        },
                    });

                },
                onError(error){
                    return error instanceof Error ? error.message : String(error);
                },
            })
        },
    );

export default app;
