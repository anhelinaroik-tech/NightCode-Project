import { TextAttributes } from "@opentui/core";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { Header } from "../components/header";
import { InputBar } from "../components/input-bar";
import { useTheme } from "../providers/theme";

export function NotFound() {
    const navigate = useNavigate();
    const location = useLocation();
    const { colors } = useTheme();

    const handleSubmit = useCallback(
        (text: string) => {
            navigate("/sessions/new", { state: { message: text } });
        },
        [navigate]
    );

    return (
        <box
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
        gap={2}
        width="100%"
        height="100%"
        >
            <Header/>
            <box alignItems="center">
                <text fg={colors.error}>Page not found</text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    No screen for {location.pathname}
                </text>
            </box>
            <box width="100%" maxWidth={78} paddingX={2}>
                <InputBar onSubmit={handleSubmit}/>
            </box>
        </box>
    );
};
