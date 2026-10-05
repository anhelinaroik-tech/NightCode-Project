import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useLocation, useNavigate } from "react-router";
import type { InferResponseType } from "hono/client";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import {apiClient } from "../../lib/api-client";
import {getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import { useTheme } from "../../providers/theme";

type Session = InferResponseType<typeof apiClient.sessions.$get, 200>[number];

export const SessionDialogContent = () => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const {close} = useDialog();
    const navigate = useNavigate();
    const location = useLocation();
    const {show} = useToast();
    const {colors} = useTheme();
    // First ctrl+d marks a session, the second one on the same session deletes it.
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    // Sessions whose DELETE is in flight, so pressing ctrl+d again can't send a second request
    const deletingIdsRef = useRef(new Set<string>());

    useEffect(()=>{
        let ignore = false;

        const fetchSession = async () => {
            try {
                const res = await apiClient.sessions.$get();
                if(!res.ok){
                    throw new Error(await getErrorMessage(res));
                }

                const data = await res.json();

                if(!ignore){
                    setSessions(data);
                    setLoading(false);
                }
            } catch (error) {
                if(!ignore){
                    show({
                        variant: "error",
                        message: error instanceof Error ? error.message : "Failed to fetch sessions",
                    });
                    close();
                }
            }
        };

        fetchSession();

        return ()=>{
            ignore = true;
        };
    }, [close, show]);

    const handleSelect = useCallback(
        (session: Session) => {
            close();
            navigate(`/sessions/${session.id}`);
        },
        [close, navigate],
    );

    const handleDelete = useCallback(
        async (session: Session) => {
            if (deletingIdsRef.current.has(session.id)) return;

            if (pendingDeleteId !== session.id) {
                setPendingDeleteId(session.id);
                return;
            }

            setPendingDeleteId(null);
            deletingIdsRef.current.add(session.id);
            try {
                const res = await apiClient.sessions[":id"].$delete({
                    param: { id: session.id },
                });
                if (!res.ok) {
                    throw new Error(await getErrorMessage(res));
                }

                setSessions((prev) => prev.filter((s) => s.id !== session.id));
                show({ variant: "success", message: `Deleted "${session.title}"` });

                // Don't leave the user in a session that no longer exists.
                if (location.pathname === `/sessions/${session.id}`) {
                    close();
                    navigate("/", { replace: true });
                }
            } catch (error) {
                show({
                    variant: "error",
                    message: error instanceof Error ? error.message : "Failed to delete session",
                });
            } finally {
                deletingIdsRef.current.delete(session.id);
            }
        },
        [pendingDeleteId, show, location.pathname, close, navigate],
    );

    if(loading){
        return(
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading sessions...</text>
            </box>
        );
    }

    return (
        <box flexDirection="column" gap={1}>
        <DialogSearchList
        items={sessions}
        onSelect={handleSelect}
        // onHighlight also fires on mouse moves over the same row, so only a different row resets it
        onHighlight={(session) => setPendingDeleteId((id) => (id === session.id ? id : null))}
        onDelete={(session) => void handleDelete(session)}
        filterFn={(s, query)=> s.title.toLowerCase().includes(query.toLowerCase())}
        renderItem={(session, isSelected) => (
            <>
            <text selectable={false} fg={isSelected ? "black" : "white"}>
            {session.title}
            </text>
            <box flexGrow={1}/>
            {pendingDeleteId === session.id ? (
                <text selectable={false} fg={isSelected ? "black" : colors.error}>
                    ctrl+d again to delete
                </text>
            ) : (
                <text selectable={false}
                fg={isSelected ? "black" : undefined}
                attributes={TextAttributes.DIM}
                >
                    {format(new Date(session.createdAt), "hh:mm a")}
                </text>
            )}
            </>
        )}

        getKey={(s)=> s.id}
        placeholder="Search sessions"
        emptyText="No matching sessions"
        />
        <text attributes={TextAttributes.DIM}>enter open · ctrl+d delete</text>
        </box>
    );
};

