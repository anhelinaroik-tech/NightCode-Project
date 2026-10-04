import { useCallback, useMemo, useRef, useState } from "react";
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
  isReadOnlyTool,
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

export type ToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

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
  // Tool calls that change local state wait here until the user allows or rejects them.
  const [approvalQueue, setApprovalQueue] = useState<ToolApprovalRequest[]>([]);
  const approvalResolversRef = useRef(new Map<string, (approved: boolean) => void>());
  // Set when the user interrupts, so rejected/finished tool calls don't restart the turn.
  const interruptedRef = useRef(false);

  const requestApproval = (request: ToolApprovalRequest) =>
    new Promise<boolean>((resolve) => {
      approvalResolversRef.current.set(request.toolCallId, resolve);
      setApprovalQueue((queue) => [...queue, request]);
    });

  const respondToApproval = useCallback((toolCallId: string, approved: boolean) => {
    const resolve = approvalResolversRef.current.get(toolCallId);
    if (!resolve) return;
    approvalResolversRef.current.delete(toolCallId);
    setApprovalQueue((queue) => queue.filter((r) => r.toolCallId !== toolCallId));
    resolve(approved);
  }, []);

  const rejectAllApprovals = useCallback(() => {
    for (const toolCallId of [...approvalResolversRef.current.keys()]) {
      respondToApproval(toolCallId, false);
    }
  }, [respondToApproval]);

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
    sendAutomaticallyWhen: (options) =>
      !interruptedRef.current && lastAssistantMessageIsCompleteWithToolCalls(options),
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;

      try {
        if (!isReadOnlyTool(toolCall.toolName)) {
          const approved = await requestApproval({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
          });
          if (!approved) {
            throw new Error(
              `The user rejected this ${toolCall.toolName} call. Do not retry it; ask the user how to proceed.`
            );
          }
        }


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
    interruptedRef.current = false;
    return chat.sendMessage({ text: userText, metadata: { mode, model } });
  };

  const stop = useCallback(() => {
    interruptedRef.current = true;
    rejectAllApprovals();
    return chat.stop();
  }, [chat.stop, rejectAllApprovals]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    isStreaming: chat.status === "submitted" || chat.status === "streaming",
    submit,
    abort: stop,
    interrupt: stop,
    pendingApproval: approvalQueue[0],
    respondToApproval,
  };
}
