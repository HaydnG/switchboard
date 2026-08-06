export const designTokens = {
  color: {
    canvas: 'var(--sb-color-canvas)',
    surface: {
      base: 'var(--sb-color-surface-base)',
      panel: 'var(--sb-color-surface-panel)',
      raised: 'var(--sb-color-surface-raised)',
    },
    text: {
      strong: 'var(--sb-color-text-strong)',
      body: 'var(--sb-color-text-body)',
      muted: 'var(--sb-color-text-muted)',
      inverse: 'var(--sb-color-text-inverse)',
    },
    border: {
      subtle: 'var(--sb-color-border-subtle)',
      strong: 'var(--sb-color-border-strong)',
      focus: 'var(--sb-color-border-focus)',
    },
    action: {
      primary: 'var(--sb-color-action-primary)',
      primaryHover: 'var(--sb-color-action-primary-hover)',
      secondary: 'var(--sb-color-action-secondary)',
      danger: 'var(--sb-color-action-danger)',
    },
    state: {
      success: 'var(--sb-color-state-success)',
      warning: 'var(--sb-color-state-warning)',
      danger: 'var(--sb-color-state-danger)',
      info: 'var(--sb-color-state-info)',
    },
  },
  radius: {
    xs: 'var(--sb-radius-xs)',
    sm: 'var(--sb-radius-sm)',
    md: 'var(--sb-radius-md)',
  },
  shadow: {
    panel: 'var(--sb-shadow-panel)',
    focus: 'var(--sb-shadow-focus)',
  },
  space: {
    1: 'var(--sb-space-1)',
    2: 'var(--sb-space-2)',
    3: 'var(--sb-space-3)',
    4: 'var(--sb-space-4)',
    5: 'var(--sb-space-5)',
    6: 'var(--sb-space-6)',
  },
  type: {
    ui: 'var(--sb-font-ui)',
    mono: 'var(--sb-font-mono)',
    size: {
      xs: 'var(--sb-type-xs)',
      sm: 'var(--sb-type-sm)',
      md: 'var(--sb-type-md)',
      lg: 'var(--sb-type-lg)',
    },
  },
} as const;

export type DesignTokens = typeof designTokens;
