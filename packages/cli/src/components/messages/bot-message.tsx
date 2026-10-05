import { Mode, type ModeType } from "@nightcode/shared";
import type {Message} from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { TextAttributes } from "@opentui/core";
import { EmptyBorder } from "../border";
import prettyMs from "pretty-ms";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, {type: `tool-${string}` | "dynamic-tool"}>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart{
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

const MAX_ARGS_LENGTH = 120;

// One line per call: file tools show only the path, never the content they write
function formatToolArgs(tc: ToolPart): string {
  if(!("input" in tc) || tc.input == null) return "";
  if(typeof tc.input !== "object") return String(tc.input);
  const input = tc.input as Record<string, unknown>;
  const toolName = tc.type === "dynamic-tool" ? tc.toolName : tc.type.slice("tool-".length);

  const text =
    toolName === "writeFile" || toolName === "editFile"
      ? String(input.path ?? "")
      : toolName === "bash"
        ? String(input.command ?? "")
        : Object.values(input).map(String).join(" ");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_ARGS_LENGTH ? `${oneLine.slice(0, MAX_ARGS_LENGTH)}…` : oneLine;
}

const MAX_RESULT_LINES = 5;

function countOf(output: Record<string, unknown>, key: string){
  const value = output[key];
  return Array.isArray(value) ? value.length : 0;
}

function lastLines(text: string){
  const lines = text.trimEnd().split("\n");
  return lines.length > MAX_RESULT_LINES
    ? ["…", ...lines.slice(-MAX_RESULT_LINES)].join("\n")
    : lines.join("\n");
}

// One-line summary of a local tool's result (plus the tail of bash output).
function formatToolResult(toolName: string, output: unknown): string {
  if(output == null || typeof output !== "object") return String(output ?? "");
  const result = output as Record<string, unknown>;
  const truncated = result.truncated ? " (truncated)" : "";

  switch(toolName){
    case "readFile": {
      const content = typeof result.content === "string" ? result.content : "";
      return `Read ${content.split("\n").length} lines${truncated}`;
    }
    case "listDirectory":
      return `${countOf(result, "entries")} entries`;
    case "glob":
      return `${countOf(result, "files")} files${truncated}`;
    case "grep":
      return `${countOf(result, "matches")} matches${truncated}`;
    case "writeFile":
      return `Wrote ${String(result.bytesWritten ?? 0)} bytes`;
    case "editFile":
      return "Edited";
    case "bash": {
      const stdout = typeof result.stdout === "string" ? result.stdout : "";
      const stderr = typeof result.stderr === "string" ? result.stderr : "";
      const tail = lastLines(`${stdout}${stderr}`);
      return `Exit code ${String(result.exitCode)}${tail ? `\n${tail}` : ""}`;
    }
    default:
      return JSON.stringify(output).slice(0, 200);
  }
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

// cosmetic part
function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      const key =
        isToolPart(part) ? `group-tc-${part.toolCallId}` : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

export function BotMessage({
  parts,
  model,
  mode,
  durationMs,
  streaming = false,
}: Props) {
  const { colors } = useTheme();
  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i)=> (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if(part.type === "reasoning"){
              return (
                <box key={`reasoning-${j}`}
                border={["left"]}
                borderColor={colors.thinkingBorder}
                customBorderChars={{
                  ...EmptyBorder,
                  vertical: "│",
                }}
                width="100%"
                paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {part.text}
                  </text>
                </box>
              );
            }

            if(isToolPart(part)){
              const toolName = 
                part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);

              return (
                <box
                key={part.toolCallId}
                border={["left"]}
                borderColor={colors.thinkingBorder}
                customBorderChars={{
                  ...EmptyBorder,
                  vertical: "│",
                }}
                width="100%"
                paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                  <em fg={colors.toolName}>{formatToolName(toolName)}:</em> {formatToolArgs(part)}
                  {part.state !== "output-available" && part.state !== "output-error" 
                  ? "…" 
                  : ""
                  }
                  </text>
                  {part.state === "output-available" ? (
                    <text attributes={TextAttributes.DIM}>→ {formatToolResult(toolName, part.output)}</text>
                  ) : null}
                  {part.state === "output-error" ? (
                    <text fg={colors.error}>✕ {part.errorText}</text>
                  ) : null}
                </box>
              );
            }

            if(part.type === "text"){
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{part.text}</text>
                </box>
              );
            }

            return null;
          })}
        </box>
    ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}> ◉ </text>
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>

            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              &gt;
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {(durationMs != null) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  &gt;
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
