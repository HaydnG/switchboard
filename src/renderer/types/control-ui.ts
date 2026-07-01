export type ControlDialogTone = 'default' | 'danger' | 'warning' | 'success';

export type ControlDialogResult = boolean | 'secondary';

export interface ControlDialogDetailRow {
  label: string;
  value: string;
}

export interface ControlDialogOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  tone?: ControlDialogTone | string;
  details?: Record<string, unknown> | ControlDialogDetailRow[];
}

export interface NormalizedControlDialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  secondaryLabel: string;
  tone: ControlDialogTone;
  details: ControlDialogDetailRow[];
}

export interface ControlToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  timeoutMs?: number;
}

export interface ControlToastItem extends ControlToastOptions {
  id: string;
}

export interface ActiveControlDialog {
  id: string;
  options: NormalizedControlDialogOptions;
  resolve: (result: ControlDialogResult) => void;
}
