import type { ReactNode } from "react";

export type DialogConfig = {
  title: string;
  children: ReactNode;
  // Runs when the dialog closes or is replaced by another one, e.g. to treat esc as "cancel".
  onClose?: () => void;
};
