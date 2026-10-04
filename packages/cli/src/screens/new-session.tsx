import { useEffect, useMemo, useRef } from "react";
import {z} from "zod";
import { useNavigate, useLocation } from "react-router";
import { UserMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell"; 

import {useToast} from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { usePromptConfig } from "../providers/prompt-config";

const newSessionStateSchema = z.object({
  message: z.string(),
});

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast(); 
  const hasStartedRef = useRef(false);
  const { mode, model } = usePromptConfig();
  // Read through a ref so a mode/model change can't re-run the effect and drop the in-flight navigation
  const promptConfigRef = useRef({ mode, model });
  promptConfigRef.current = { mode, model };

const state = useMemo(()=> {
  const parsed = newSessionStateSchema.safeParse(location.state);
  return parsed.success ? parsed.data : null;
}, [location.state])

// Guard: if navigated here directly without state, go home
  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  // Create the session on mount - this screen exists to do
  useEffect(()=>{
    if(!state || hasStartedRef.current) return;

    hasStartedRef.current = true;
    const { mode, model } = promptConfigRef.current;

    let ignore = false;
    const createSession = async ()=>{
      try{
        const res = await apiClient.sessions.$post({
          json:{
            title: state.message.slice(0,100),
            cwd: process.cwd(),
            initialMessage: {
              role: "USER",
              content: state.message,
              mode,
              model,
            },
          }
        });

        if(ignore) return;
        if(!res.ok){
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        navigate(
          `/sessions/${session.id}`,
          // Pass the created session via router state so the next screen doesn't refetch it
          {replace: true, state:{session}}
        );
      } catch (error){
        if (ignore) return;
        toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", {replace: true});
      }
    };

    createSession();
    return ()=>{
      ignore = true;
    }; 
  }, [state, navigate, toast]);

  if (!state) return null;

  return (
    <SessionShell onSubmit={()=> {}} inputDisabled loading>
      <UserMessage message={state.message}/>
    </SessionShell>
  );
};
