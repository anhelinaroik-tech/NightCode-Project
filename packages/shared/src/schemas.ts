import { z } from "zod";

// Keep the explicit key schema here because the one-argument z.record(...) form
// does not type-check cleanly with the Zod typings used in this workspace
export const toolCallArgsSchema = z.record(z.string(), z.json());

// definition that will help validate whst kind of message LLM streams back to us
export const messagePartSchema = z.discriminatedUnion("type", [
  z.object({
    // what ai model is thinking
    type: z.literal("reasoning"),
    text: z.string(),
  }),
  z.object({
    // some work with files, command to run...
    type: z.literal("tool-call"),
    id: z.string(),
    name: z.string(),
    args: toolCallArgsSchema,
    result: z.string().optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
]);

export const messagePartsSchema = z.array(messagePartSchema);

export type MessagePart = z.infer<typeof messagePartSchema>;

// Tool-call args stay as nested JSON on the wire so the client does not need
// a second JSON.parse step after decoding the SSE event payload itself

// what we can recieve from vercel ai sdk
export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text-delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("reasoning-delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: toolCallArgsSchema,
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    result: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    messageId: z.string(),
    durationMs: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
