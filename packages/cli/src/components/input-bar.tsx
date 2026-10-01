import { useRef, useCallback, useEffect } from "react";
import { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { KeyBinding } from "@opentui/core";
import { EmptyBorder } from "./border";
import { StatusBar } from "./status-bar";
import { CommandMenu } from "./command-menu";
import type { Command } from "./command-menu/types";
import { useCommandMenu } from "./command-menu/use-command-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { useNavigate } from "react-router";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@nightcode/database/enums";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  // Cancels the running response; while set, ctrl+c calls it instead of exiting.
  onCancel?: () => void;
};

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "enter", shift: true, action: "newline" },
];

export function InputBar({ onSubmit, disabled = false, onCancel }: Props) {
  const { mode, toggleMode, setMode, setModel } = usePromptConfig();
  const textareRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const renderer = useRenderer();
  const toast = useToast();
  const dialog = useDialog();
  const { isTopLayer, setResponder } = useKeyboardLayer();
  const { colors } = useTheme();
  const navigate = useNavigate();

  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareRef.current;
    if (!textarea) return;

    handleContentChange(textarea.plainText);
  }, []);

  const handleSubmit = useCallback(() => {
    if (disabled) return;

    const textarea = textareRef.current;
    if (!textarea) return;

    const text = textarea.plainText.trim();
    if (text.length === 0) return;

    onSubmit(text);
    textarea.setText("");
  }, [disabled, onSubmit]);

  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textareRef.current;
      if (!textarea || !command) return;

      textarea.setText("");

      if (command.action) {
        // Actions may be async; catch failures so they don't become unhandled rejections.
        void Promise.resolve(
          command.action({
            exit: () => renderer.destroy(),
            toast,
            dialog,
            navigate,
            mode,
            setMode,
            setModel,
          })
        ).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          toast.show({
            variant: "error",
            message: `${command.value} failed: ${reason}`,
          });
        });
      } else {
        textarea.insertText(command.value + " ");
      }
    },
    [renderer, toast, dialog, navigate, mode, setMode, setModel]
  );

  const handleCommandExecute = useCallback(
    (index: number) => {
      const command = resolveCommand(index);
      handleCommand(command);
    },
    [resolveCommand, handleCommand]
  );

  useEffect(() => {
    const textarea = textareRef.current;
    if (!textarea) return;

    textarea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  onSubmitRef.current = () => {
    if (disabled) return;

    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }

    handleSubmit();
  };

  useKeyboard((key) => {
    if (disabled) return;
    if (!isTopLayer("base")) return;
    if (key.name === "tab") {
      key.preventDefault();
      toggleMode();
    }
  });

  // register the base layer responder for ctrl+c dismissal
  useEffect(() => {
    setResponder("base", () => {
      if (onCancel) {
        onCancel();
        return true;
      }
      // Don't exit while input is disabled for work in progress.
      if (disabled) return true;

      const textarea = textareRef.current;
      if (textarea && textarea.plainText.length > 0) {
        textarea.setText("");
        return true;
      }
      return false;
    });

    return () => setResponder("base", null);
  }, [disabled, onCancel, setResponder]);

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={mode === Mode.BUILD ? colors.primary : colors.planMode}
        customBorderChars={{
          ...EmptyBorder,
          vertical: "|",
          bottomLeft: "'",
        }}
        width="100%"
      >
        <box
          position="relative"
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
          gap={1}
        >
          {showCommandMenu && (
            <box
              position="absolute"
              bottom="100%"
              left={0}
              width="100%"
              backgroundColor={colors.surface}
              zIndex={10}
            >
              <CommandMenu
                query={commandQuery}
                selectedIndex={selectedIndex}
                scrollRef={scrollRef}
                onSelect={setSelectedIndex}
                onExecute={handleCommandExecute}
              />
            </box>
          )}
          <textarea
            ref={textareRef}
            focused={!disabled && (isTopLayer("base") || isTopLayer("command"))}
            keyBindings={TEXTAREA_KEY_BINDINGS}
            onContentChange={handleTextareaContentChange}
            placeholder={`Ask anything... "Fix a bug in database"`}
          />
          <StatusBar />
        </box>
      </box>
    </box>
  );
}
