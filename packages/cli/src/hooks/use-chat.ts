import { useMemo, useRef } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import {
  DEFAULT_CHAT_MODEL_ID,
  Mode,
  type ModeType,
  type SupportedChatModelId,
  type ToolContracts,
} from "@nightcode/shared";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool } from "../lib/local-tools";

// Must match the metadata the server attaches in routes/chat.ts
export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

// The shared contracts declare no outputSchema, so the inferred output would be `undefined`;
// tool results come from executeLocalTool and can be any shape.
type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

type SubmitParams = {
  userText: string;
  mode: ModeType;
  model: SupportedChatModelId;
};

export function useChat(sessionId: string, initialMessages: Message[]) {
  // The transport and tool handler are created once, so they read the mode/model of the
  // latest submit through a ref. Automatic tool-result resubmits reuse those values.
  const configRef = useRef<Omit<SubmitParams, "userText">>({
    mode: Mode.BUILD,
    model: DEFAULT_CHAT_MODEL_ID,
  });

  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      headers() {
        const auth = getAuth();
        return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
      },
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No message to send");

        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;

        // The server merges incoming messages with the stored history by id, so usually only
        // the last one is needed. But it skips saving while tool calls are pending, so on a
        // tool-result resubmit the user message that started the turn isn't stored yet.
        const previousMessage = messages[messages.length - 2];
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode ?? configRef.current.mode,
            model: message.metadata?.model ?? metadata?.model ?? configRef.current.model,
          },
        };
      },
    });
  }, [sessionId]);

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    // Tools have no `execute` on the server; once every call in the last assistant
    // message has an output, send the results back so the model can continue.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;

      try {
        const output = await executeLocalTool(
          toolCall.toolName,
          toolCall.input,
          configRef.current.mode
        );
        // Not awaited: awaiting inside onToolCall can deadlock the auto-resubmit.
        void chat.addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output,
        });
      } catch (error) {
        void chat.addToolOutput({
          state: "output-error",
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  const submit = ({ userText, mode, model }: SubmitParams) => {
    configRef.current = { mode, model };
    return chat.sendMessage({ text: userText, metadata: { mode, model } });
  };

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    isStreaming: chat.status === "submitted" || chat.status === "streaming",
    submit,
    abort: chat.stop,
    interrupt: chat.stop,
  };
}
