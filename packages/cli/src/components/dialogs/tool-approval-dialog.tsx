import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import type { ToolApprovalRequest } from "../../hooks/use-chat";

const PREVIEW_LINES = 8;

type ToolApprovalDialogContentProps = {
  request: ToolApprovalRequest;
  onRespond: (approved: boolean) => void;
};

function previewLines(text: string) {
  const lines = text.split("\n");
  const shown = lines.slice(0, PREVIEW_LINES);
  if (lines.length > PREVIEW_LINES) {
    shown.push(`… ${lines.length - PREVIEW_LINES} more lines`);
  }
  return shown.join("\n");
}

function getStringField(input: unknown, key: string) {
  if (input == null || typeof input !== "object") return "";
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function ToolDetails({ request }: { request: ToolApprovalRequest }) {
  const { colors } = useTheme();
  const { toolName, input } = request;

  switch (toolName) {
    case "bash": {
      const description = getStringField(input, "description");
      return (
        <box flexDirection="column" gap={1}>
          {description ? <text attributes={TextAttributes.DIM}>{description}</text> : null}
          <text fg={colors.primary}>$ {previewLines(getStringField(input, "command"))}</text>
        </box>
      );
    }
    case "writeFile": {
      const content = getStringField(input, "content");
      return (
        <box flexDirection="column" gap={1}>
          <text>
            Write <strong>{getStringField(input, "path")}</strong> ({content.split("\n").length} lines)
          </text>
          <text attributes={TextAttributes.DIM}>{previewLines(content)}</text>
        </box>
      );
    }
    case "editFile":
      return (
        <box flexDirection="column" gap={1}>
          <text>
            Edit <strong>{getStringField(input, "path")}</strong>
          </text>
          <text fg={colors.error}>- {previewLines(getStringField(input, "oldString"))}</text>
          <text fg={colors.success}>+ {previewLines(getStringField(input, "newString"))}</text>
        </box>
      );
    default:
      return <text attributes={TextAttributes.DIM}>{previewLines(JSON.stringify(input, null, 2))}</text>;
  }
}

export function ToolApprovalDialogContent({ request, onRespond }: ToolApprovalDialogContentProps) {
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();
  const [allowSelected, setAllowSelected] = useState(true);

  // Respond before closing: closing on its own (esc, click outside) counts as a rejection.
  const respond = (approved: boolean) => {
    onRespond(approved);
    dialog.close();
  };

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "left" || key.name === "right" || key.name === "tab") {
      setAllowSelected((value) => !value);
    } else if (key.name === "return" || key.name === "enter") {
      respond(allowSelected);
    } else if (key.name === "y") {
      respond(true);
    } else if (key.name === "n") {
      respond(false);
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <ToolDetails request={request} />
      <box flexDirection="row" gap={2}>
        <box
          paddingX={1}
          backgroundColor={allowSelected ? colors.success : undefined}
          onMouseDown={() => respond(true)}
        >
          <text fg={allowSelected ? "black" : undefined}>Allow (y)</text>
        </box>
        <box
          paddingX={1}
          backgroundColor={allowSelected ? undefined : colors.error}
          onMouseDown={() => respond(false)}
        >
          <text fg={allowSelected ? undefined : "black"}>Reject (n)</text>
        </box>
      </box>
      <text attributes={TextAttributes.DIM}>←/→ choose · enter confirm · esc reject</text>
    </box>
  );
}
