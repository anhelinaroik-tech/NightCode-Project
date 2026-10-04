import { useState, useRef, useCallback, useEffect } from "react";
import { EventSourceParserStream } from "eventsource-parser/stream";
import prettyMs from "pretty-ms";
import type { ClientResponse } from "hono/client"; 
import { apiClient } from "../lib/api-client"; 
import { getErrorMessage } from "../lib/http-errors"; 
import type { Mode } from "@nightcode/database/enums";
import {
chatStreamEventSchema, 
type SupportedChatModelId
} from "@nightcode/shared";

export type ClientMessagePart = { type: "text"; text: string};

export type Message=
    | { 
        id: string, 
        role: "user"; 
        content: string; 
        mode: Mode; 
        model: SupportedChatModelId 
    }
    | {
        id: string;
        role: "assistant";
        content: string;
        mode: Mode;
        model: SupportedChatModelId;
        parts: ClientMessagePart[];
        duration?: string;
        interrupted?: boolean;
    }
    | {
        id: string;
        role: "error";
        content: string;
    };

type StreamingState = 
    | { status: "idle" }
    | {
        status: "streaming";
        parts: ClientMessagePart[];
        mode: Mode;
        model: SupportedChatModelId
    };

type ActiveStream = {
    requestId: string;
    controller: AbortController;
    mode: Mode;
    model: SupportedChatModelId;
    parts: ClientMessagePart[];
    interruptedCaptured?: boolean;
};

type SubmitParams = {
    userText: string;
    mode: Mode;
    model: SupportedChatModelId;
};

type RunStreamParams = {
    mode: Mode,
    model: SupportedChatModelId;
    request: (controller: AbortController) => Promise<ClientResponse<unknown>>;
};

export function useChat(
    sessionId: string,
    initialMessage: Message[],
){
    const[messages, setMessages] = useState<Message[]>(initialMessage);
    const[streaming, setStreaming] = useState<StreamingState>({
        status: "idle"
    });
    const activeStreamRef = useRef<ActiveStream | null>(null);

    // Ignore events from stale streams that are no longer the active request
    const isActiveRequest = useCallback((requestId: string) => {
        return activeStreamRef.current?.requestId === requestId;
    }, []);

    const emitParts = useCallback((
        requestId: string,
        parts: ClientMessagePart[], 
    )=>{
        if(!isActiveRequest(requestId)) return;

        // Shallow copy, so parts must be replaced rather than mutated in place
        const snapshot = [...parts];
        const activeStream = activeStreamRef.current;
        if(!activeStream) return;

        activeStream.parts = snapshot;
        setStreaming({
            status: "streaming",
            parts: snapshot,
            mode: activeStream.mode,
            model: activeStream.model,
        });
    },[isActiveRequest]);

    const captureInterruptedMessage=useCallback((
        activeStream: ActiveStream
    )=> {
        if(
            activeStream.interruptedCaptured || 
            activeStream.parts.length === 0
        ) {
            return;
        }

        activeStream.interruptedCaptured = true;
        const parts = [...activeStream.parts];
        const fullText = parts
            .filter((p)=> p.type === "text")
            .map((p)=> p.text)
            .join("");

        setMessages((prev)=> [
            ...prev,
            {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullText,
                mode: activeStream.mode,
                model: activeStream.model,
                parts,
                interrupted: true,
            },
        ]);
    }, []);

    const clearStream =  useCallback(
        (requestId: string) => {
            if(!isActiveRequest(requestId)) return;

            activeStreamRef.current = null;
            setStreaming({status: "idle"});
        }, [isActiveRequest],
    );

    const handleStream = useCallback(async (
        response: ClientResponse<unknown>,
        activeStream: ActiveStream
    )=> {
        if(!isActiveRequest(activeStream.requestId)) return;

        if(!response.ok){
            const message = await getErrorMessage(response);
            setMessages((prev)=> [
                ...prev,
                {
                    // Local error with no DB row, so generate an id for the React key
                    id: crypto.randomUUID(),
                    role: "error",
                    content: message,
                },
            ]);
            return;
        }; 

        const parts: ClientMessagePart[] = [];
        let receivedTerminalEvent = false;
        let streamEventError = false;
        const stream = response
            // decoding response from server
            .body!.pipeThrough(new TextDecoderStream())
            .pipeThrough(new EventSourceParserStream());

        for await (const { data } of stream ) {
            if(!isActiveRequest(activeStream.requestId)) return;

            let event;
            try {
                event = chatStreamEventSchema.parse(JSON.parse(data));
            } catch (err) {
                streamEventError = true;
                const message = err instanceof Error ? err.message : "Invalid stream event";
                setMessages((prev) => [
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        role: "error",
                        content: message,
                    },
                ]);
                break;
            }

            switch(event.type){
                case "text-delta":{
                    const last = parts[parts.length-1];
                    if(last && last.type === "text"){
                        parts[parts.length - 1] = { ...last, text: last.text + event.text };
                    } else {
                        parts.push({type: "text", text: event.text});
                    }
                    // A function that passes the assistant's response chunks accumulated during the stream into the React state, causing the UI to re-render and display the new text.
                    emitParts(activeStream.requestId, parts);
                    break;
                }
                case "done": {
                    if(!isActiveRequest(activeStream.requestId)) return;
                    receivedTerminalEvent = true;

                    const fullText = parts
                        .filter((p)=> p.type === "text")
                        .map((p)=> p.text)
                        .join("");

                    setMessages((prev)=> [
                        ...prev,
                        {
                            id: event.messageId,
                            role: "assistant",
                            content: fullText,
                            mode: activeStream.mode,
                            model: activeStream.model,
                            duration: prettyMs(event.durationMs),
                            parts: [...parts],
                        },
                    ]);
                    break;
                }
                case "error":
                    receivedTerminalEvent = true;
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "error",
                            content: event.message,
                        },
                    ]);
                    break;
            }
        }

        // The body ended without done/error, so keep the partial answer
        if (
            !receivedTerminalEvent &&
            !streamEventError &&
            isActiveRequest(activeStream.requestId)
        ) {
            captureInterruptedMessage(activeStream);
        }
    }, [emitParts, isActiveRequest, captureInterruptedMessage]);

    const runStream = useCallback(async (
        { mode, model, request}: RunStreamParams
    )=> {
        const controller = new AbortController();
        const activeStream: ActiveStream = {
            requestId: crypto.randomUUID(),
            controller,
            mode,
            model,
            parts: [],
            interruptedCaptured: false,
        };

        activeStreamRef.current=activeStream;
        setStreaming({status: "streaming", parts: [], mode, model});

        try {
            const response = await request(controller);
            await handleStream(response, activeStream);
            
        } catch (err) {
            if(err instanceof DOMException && err.name === "AbortError") return;
            if(!isActiveRequest(activeStream.requestId)) return;
            const msg = err instanceof Error ? err.message:String(err);
            setMessages((prev)=> [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "error",
                    content: msg,
                },
            ]);
        } finally {
            clearStream(activeStream.requestId);
        }
    },[clearStream, handleStream, isActiveRequest]);

    const stopActiveStream = useCallback((
        capturePartial: boolean
    )=> {
        const activeStream = activeStreamRef.current;
        if(!activeStream) return;

        if (capturePartial){
            captureInterruptedMessage(activeStream);
        }

        activeStreamRef.current=null;
        setStreaming({status: "idle"});
        activeStream.controller.abort();
    }, [captureInterruptedMessage]);

    const resume = useCallback(async (
        {mode, model}: Omit<SubmitParams, "userText">
    )=> {
        await runStream({
            mode,
            model,
            request: async (controller) => {
                return apiClient.chat[":sessionId"].resume.$post(
                    { param: {sessionId}},
                    {init: {signal: controller.signal}},

                );
            }
        });
    },[runStream, sessionId]);

    // Auto-resume when the conversation ends with a user message that has no reply
    const hasAutoResumeRef = useRef(false);
    useEffect(()=> {
        if(hasAutoResumeRef.current) return;
        const last = initialMessage[initialMessage.length-1];
        if(!last || last.role !== "user") return;

        hasAutoResumeRef.current = true;
        void resume({mode: last.mode, model: last.model});

    }, [initialMessage, resume]);

    const submit = useCallback(async (
        {userText, mode, model}: SubmitParams
    )=> {
        // Show the partial answer before sending the next message
        stopActiveStream(true);

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: userText,
            mode,
            model,
        };

        setMessages((prev)=>[...prev, userMessage]);

        await runStream({
            mode,
            model,
            request: async(controller)=>{
                return apiClient.chat[":sessionId"].$post(
                    {
                        param: { sessionId },
                        json: { content: userText, mode, model }
                    },
                    // signal - stop connection even if its streaming( for button STOP)
                    {init: {signal: controller.signal}},
                );
            },
        });
    }, [runStream, sessionId, stopActiveStream]);

    const abort = useCallback(()=>{
        stopActiveStream(false);
    }, [stopActiveStream]);

    const interrupt = useCallback(()=> {
        stopActiveStream(true);
    }, [stopActiveStream]);

    return { messages, streaming, submit, abort, interrupt};
};

