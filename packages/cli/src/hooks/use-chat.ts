import { useState, useRef, useCallback, useEffect, act } from "react";
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
import { requestId } from "hono/request-id";
import { AppContext } from "@opentui/react";
import { measureText } from "@opentui/core";

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
    const updateMessages = useCallback((updater: (prev: Message[]) => Message[])=>{
        setMessages((prev)=> updater(prev));
    }, []);

    // захищає від застарілих (stale) стрімів. Вона перевіряє, чи запит, від якого прийшла подія, досі є поточним активним стрімом.
    const isActiveRequest = useCallback((requestId: string) => {
        return activeStreamRef.current?.requestId === requestId;
    }, []);

    const emitParts = useCallback((
        requestId: string,
        parts: ClientMessagePart[], 
    )=>{
        if(!isActiveRequest(requestId)) return;

        // snapshot фіксує поточний вміст масиву в конкретний момент. Для React це новий об'єкт, а мутабельний буфер у ref можна й далі спокійно доповнювати.Одне зауваження: копія поверхнева. Якщо ви змінюватимете сам об'єкт частини (наприклад, parts[i].text += delta), React цього теж не побачить. Змінений елемент треба замінювати новим об'єктом: parts[i] = { ...parts[i], text: parts[i].text + delta }.
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

        updateMessages((prev)=> [
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
            updateMessages((prev)=> [
                ...prev,
                {
                    // коли сервер повертає помилку, код додає в список messages локальне повідомлення з role: "error". Сервер його не створював, тому своєї id з бази даних у нього немає. Проте кожному елементу списку потрібна унікальна id, наприклад щоб React міг використати її як key під час рендеру. Тож id генерується прямо в CLI.
                    id: crypto.randomUUID(),
                    role: "error",
                    content: message,
                },
            ]);
            return;
        }; 

        const parts: ClientMessagePart[] = [];
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
                const message = err instanceof Error ? err.message : "Invalide stream event";
                updateMessages((prev) => [
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
                        last.text += event.text;
                    } else {
                        parts.push({type: "text", text: event.text});
                    }
                    // A function that passes the assistant's response chunks accumulated during the stream into the React state, causing the UI to re-render and display the new text.
                    emitParts(activeStream.requestId, parts);
                    break;
                }
                case "done": {
                    if(!isActiveRequest(activeStream.requestId)) return;

                    const fullText = parts
                        .filter((p)=> p.type === "text")
                        .map((p)=> p.text)
                        .join("");

                    updateMessages((prev)=> [
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
                    updateMessages((prev) => [
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
    }, [updateMessages, emitParts, isActiveRequest]);

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
            if(isActiveRequest(activeStream.requestId)) return;
            const msg = err instanceof Error ? err.message:String(err);
            updateMessages((prev)=> [
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
    },[clearStream, handleStream, isActiveRequest, updateMessages]);

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

        updateMessages((prev)=>[...prev, userMessage]);

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
    }, [runStream, sessionId, updateMessages, stopActiveStream]);

    const abort = useCallback(()=>{
        stopActiveStream(false);
    }, [stopActiveStream]);

    const interrupt = useCallback(()=> {
        stopActiveStream(true);
    }, [stopActiveStream]);

    return { messages, streaming, submit, abort, interrupt};
};

