import type {
  ControlDialogDetailRow,
  ControlDialogOptions,
  ControlDialogTone,
  NormalizedControlDialogOptions,
} from '@renderer/types/control-ui';

const KNOWN_TONES = new Set<ControlDialogTone>(['default', 'danger', 'warning', 'success']);

export function formatControlDialogDetails(
  details?: ControlDialogOptions['details'],
): ControlDialogDetailRow[] {
  if (!details) return [];
  if (Array.isArray(details)) {
    return details
      .filter(
        (item) =>
          item && item.value !== undefined && item.value !== null && String(item.value) !== '',
      )
      .map((item) => ({ label: String(item.label || ''), value: String(item.value) }));
  }
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([label, value]) => ({ label: String(label), value: String(value) }));
}

export function normalizeControlDialogOptions(
  options: ControlDialogOptions = {},
): NormalizedControlDialogOptions {
  const tone = KNOWN_TONES.has(options.tone as ControlDialogTone)
    ? (options.tone as ControlDialogTone)
    : 'default';

  return {
    title: String(options.title || ''),
    message: String(options.message || ''),
    confirmLabel: String(options.confirmLabel || 'Confirm'),
    cancelLabel: options.cancelLabel === undefined ? 'Cancel' : String(options.cancelLabel),
    secondaryLabel: String(options.secondaryLabel || ''),
    tone,
    details: formatControlDialogDetails(options.details),
  };
}

export function controlDialogToneClass(tone: ControlDialogTone | string): string {
  return `control-dialog-${KNOWN_TONES.has(tone as ControlDialogTone) ? tone : 'default'}`;
}

export function controlDialogKicker(tone: ControlDialogTone): string {
  return tone === 'danger' ? 'Destructive Action' : 'Confirm Action';
}
