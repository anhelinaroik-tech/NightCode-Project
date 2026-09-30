import { TextAttributes } from "@opentui/core";
import { DEFAULT_CHAT_MODEL_ID, type SupportedChatModelId } from "@nightcode/shared";
import type { Mode } from "@nightcode/database/enums";
import { useTheme } from "../providers/theme";

type Props = {
  mode?: Mode;
  model?: SupportedChatModelId;
};

// "BUILD" -> "Build"
function formatMode(mode: Mode) {
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

export function StatusBar({ mode = "BUILD", model = DEFAULT_CHAT_MODEL_ID }: Props) {
  const {colors} = useTheme();
  return (
    <box flexDirection="row" gap={1}>
      <text fg={colors.primary}>{formatMode(mode)}</text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        &#8250;
      </text>
      <text>{model}</text>
    </box>
  );
}
