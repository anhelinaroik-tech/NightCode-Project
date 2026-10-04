import { TextAttributes } from "@opentui/core";
import { Mode } from "@nightcode/database/enums";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";

// "BUILD" -> "Build"
function formatMode(mode: Mode) {
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
