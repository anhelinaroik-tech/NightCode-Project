import React, {
    createContext,
    useContext,
    useState,
    useCallback,
    useMemo,
    useRef,
} from "react";
import { useKeyboard ,useRenderer } from "@opentui/react";

type Responder = () => boolean;
type KeyboardLayerContextValue={
    push: (id: string, responder?: Responder) => void;
    pop: (id: string)=> void;
    isTopLayer: (id: string)=> boolean;
    setResponder: (id: string, responder: Responder | null) => void;
};

const KeyboardLayerContext =
createContext<KeyboardLayerContextValue|null>(null);

export function KeyboardLayerProvider({children}: {children: React.ReactNode}){
    const [stack, setStack] =useState<string[]>(["base"]);
    const stackRef = useRef(stack);
    stackRef.current = stack;

    const responders= useRef<Map<string, Responder>>(new Map());
    const renderer = useRenderer();

    const push = useCallback((id: string, responder?: Responder)=>{
        if (responder){
            responders.current.set(id, responder);
        }

        setStack((prev)=>{
            if (prev.includes(id)){
                return prev;
            }

            return[...prev, id];
        });
    }, []);

    const pop = useCallback((id:string)=> {
        responders.current.delete(id);
        // Keep the same array when id isn't on the stack, so callers can pop freely without re-rendering.
        setStack((prev) => prev.includes(id) ? prev.filter((layer)=> layer !==id) : prev);
    }, []);

    const isTopLayer = useCallback(
        (id: string) => {
            return stack[stack.length-1]===id;
        }, [stack],
    );

    const setResponder = useCallback((
        id: string, 
        responder: Responder | null
    )=> {
        if(responder){
            responders.current.set(id, responder);
        }
        else {
            responders.current.delete(id);
        }
    }, []);

    // Single ctrl+c handler that walks the responder chain
    useKeyboard((key)=> {
        if(!key.ctrl|| key.name!=="c") return;

        const currentStack = stackRef.current;
        for(let i = currentStack.length-1; i>=0; i--){
            const layerId = currentStack[i]!;
            const responder=responders.current.get(layerId);
            if(responder && responder()){
                return;
            }
        };

        // No responder handled it - exit
        renderer.destroy();
    });

    const value = useMemo<KeyboardLayerContextValue>(
        () => ({ push, pop, isTopLayer, setResponder }),
        [push, pop, isTopLayer, setResponder],
    );

    return(
        <KeyboardLayerContext.Provider value={value}>
            {children}
        </KeyboardLayerContext.Provider>
    );
};

export function useKeyboardLayer(){
    const context = useContext(KeyboardLayerContext);
    if(!context){
        throw new Error("useKeyboardLayer must be used within a KeyboardLayerProvider");
    }
    return context;
}