import { SessionShell } from "../components/session-shell";
import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useKeyboard } from "@opentui/react";
import type { InferResponseType } from "hono/client";
import { UserMessage, BotMessage, ErrorMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import {
  type SupportedChatModel,
  type SupportedChatModelId,
  type ModeType,
} from "@nightcode/shared";
import { useChat } from "../hooks/use-chat";
import type { Message } from "../hooks/use-chat";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { usePromptConfig } from "../providers/prompt-config";
import { useDialog } from "../providers/dialog";
import { ToolApprovalDialogContent } from "../components/dialogs";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>(
    (val) => val != null && typeof val === "object" && "id" in val
  ),
  initialPrompt: z.
    object({
      message: z.string(),
      mode: z.custom<ModeType>(),
      model: z.custom<SupportedChatModelId>(), 
    })
    .optional(),
});

function ChatMessage({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p)=> p.text)
      .join("")

    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"}/>;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      streaming={false}
    />
  );
}

function SessionChat({ 
  session,
  initialPrompt,
}: { session: SessionData,
     initialPrompt?: {message: string; mode: ModeType; model: SupportedChatModelId};
 }) {
  const [initialMessages] = useState(() => session.messages as unknown as Message[]);
  const { isTopLayer } = useKeyboardLayer();
  // Single source for what is sent to the server and shown in the status bar
  const { mode, model } = usePromptConfig();
  const {
    messages,
    status,
    submit,
    abort,
    interrupt,
    error,
    pendingApproval,
    respondToApproval,
    isRunningTools,
  } = useChat(session.id, initialMessages);
  // A local tool can still be running after the stream ended
  const isBusy = status === "streaming" || status === "submitted" || isRunningTools;
  const dialog = useDialog();
  const hasSubmitedInitialPromptRef = useRef(false);

  // Stop the pending reply when the user leaves this session.
  useEffect(() => {
    return () => void abort();
  }, [abort]);

  // Let the user cancel a reply even before the first streamed chunk arrives.
  useKeyboard((key) => {
    if (
      key.name === "escape" && isTopLayer("base") && isBusy
    ) {
      key.preventDefault();
      interrupt();
    }
  });

  // Ask before running a tool that changes local state; one dialog per call, in order.
  useEffect(() => {
    if (!pendingApproval) return;
    const { toolCallId } = pendingApproval;
    dialog.open({
      title: "Allow local tool?",
      children: (
        <ToolApprovalDialogContent
          request={pendingApproval}
          onRespond={(approved) => respondToApproval(toolCallId, approved)}
        />
      ),
      onClose: () => respondToApproval(toolCallId, false),
    });
  }, [pendingApproval, dialog, respondToApproval]);

  useEffect(()=>{
    if(!initialPrompt || hasSubmitedInitialPromptRef.current) return;
    hasSubmitedInitialPromptRef.current = true;
    void submit({
      userText: initialPrompt.message,
      mode: initialPrompt.mode,
      model: initialPrompt.model,
    })
  }, [initialPrompt, submit])

  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model })}
      inputDisabled={pendingApproval != null}
      loading={isBusy}
      interruptible={isBusy}
      onInterrupt={interrupt}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} />
      ))}
      {error && <ErrorMessage message={error.message}/>}
    </SessionShell>
  );
}

export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  // prefetched, redirected throw new session and passed to state
  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const [session, setSession] = useState<SessionData | null>(prefetched?.session ?? null);

  useEffect(() => {
    if (prefetched?.session) return;

    setSession(null);
    if (!id) return;
    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    fetchSession();
    return () => {
      ignore = true;
    };
  }, [id, prefetched, toast, navigate]);

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
  }
  return (
  <SessionChat 
  key={session.id} 
  session={session} 
  initialPrompt={prefetched?.initialPrompt}
  />
);
}
