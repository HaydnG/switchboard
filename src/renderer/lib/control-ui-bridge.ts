import type {
  ControlDialogOptions,
  ControlDialogResult,
  ControlToastOptions,
} from '@renderer/types/control-ui';

type ShowDialogFn = (options: ControlDialogOptions) => Promise<ControlDialogResult>;
type ShowToastFn = (options: ControlToastOptions) => void;

let showDialogImpl: ShowDialogFn | null = null;
let showToastImpl: ShowToastFn | null = null;

function installGlobals() {
  window.showControlDialog = (options) => {
    if (!showDialogImpl) return Promise.resolve(false);
    return showDialogImpl(options);
  };

  window.showControlMessage = (options) =>
    window.showControlDialog!({
      ...options,
      confirmLabel: options.confirmLabel || 'OK',
      cancelLabel: '',
    });

  window.showControlToast = (options) => {
    showToastImpl?.(options);
  };
}

export function registerControlUi(impl: { showDialog: ShowDialogFn; showToast: ShowToastFn }) {
  showDialogImpl = impl.showDialog;
  showToastImpl = impl.showToast;
}

installGlobals();
