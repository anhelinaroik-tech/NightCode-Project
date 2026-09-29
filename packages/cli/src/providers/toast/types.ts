export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
    message: string;
    variant?: ToastVariant;
    duration?: number;
};

// how long message should be shown
export const DEFAULT_DURATION = 3000;