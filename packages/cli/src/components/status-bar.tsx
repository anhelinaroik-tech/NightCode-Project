import { TextAttributes } from "@opentui/core";
import { Mode, type ModeType } from "@nightcode/shared";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";

// "BUILD" -> "Build"
function formatMode(mode: ModeType) {
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

export function StatusBar() {
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();

  return (
    <box flexDirection="row" gap={1}>
      <text fg={mode == Mode.PLAN ? colors.planMode : colors.primary}>
        {mode == Mode.PLAN ? "Plan" : "Build"}
      </text>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        &#8250;
      </text>
      <text>{model}</text>
    </box>
  );
}
