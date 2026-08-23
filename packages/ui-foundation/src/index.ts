/**
 * Shared, opt-in visual foundation for PAIMind-owned client surfaces.
 * Harness remains the theme owner; these aliases only normalize PAIMind density,
 * focus, radii and progressive-disclosure behavior below an explicit scope.
 */
export const PAIMIND_UI_FOUNDATION_CSS: string = `
:where([data-paimind-ui-scope]) {
  --paimind-ui-canvas: var(--paimind-canvas, var(--dsw-alias-bg-base, #f4f7fb));
  --paimind-ui-panel: var(--paimind-glass-strong, var(--dsw-alias-bg-layer-1, #fff));
  --paimind-ui-subtle: var(--paimind-glass, var(--dsw-alias-bg-layer-2, #eef2f7));
  --paimind-ui-border: var(--paimind-line, var(--dsw-alias-border-l1, rgba(110, 128, 154, .18)));
  --paimind-ui-text: var(--paimind-ink, var(--dsw-alias-label-primary, #17223a));
  --paimind-ui-muted: var(--paimind-muted, var(--dsw-alias-label-secondary, #65718a));
  --paimind-ui-faint: var(--dsw-alias-label-tertiary, #78849a);
  --paimind-ui-accent: var(--paimind-accent, var(--dsw-alias-state-business-primary, #3471f5));
  --paimind-ui-danger: var(--dsw-alias-state-error-primary, #d04444);
  --paimind-ui-success: var(--dsw-alias-state-success-primary, #2b8a57);
  --paimind-ui-warning: var(--dsw-alias-state-warning-primary, #b7791f);
  --paimind-ui-radius-sm: 8px;
  --paimind-ui-radius-md: 12px;
  --paimind-ui-radius-lg: 16px;
  --paimind-ui-shadow-overlay: 0 20px 64px rgba(18, 30, 52, .18);
  color: var(--paimind-ui-text);
  font: inherit;
}
:where([data-paimind-ui-scope]) *,
:where([data-paimind-ui-scope]) *::before,
:where([data-paimind-ui-scope]) *::after { box-sizing: border-box; }
:where([data-paimind-ui-scope]) :is(button, input, select, textarea):focus-visible {
  outline: 2px solid var(--paimind-ui-accent);
  outline-offset: 2px;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-panel] {
  border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-lg);
  color: var(--paimind-ui-text);
  background: var(--paimind-ui-panel);
}
:where([data-paimind-ui-scope]) [data-paimind-ui-card] {
  border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-md);
  color: var(--paimind-ui-text);
  background: var(--paimind-ui-panel);
}
:where([data-paimind-ui-scope]) [data-paimind-ui-button] {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-sm);
  color: var(--paimind-ui-muted);
  background: var(--paimind-ui-panel);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-button]:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--paimind-ui-accent) 34%, var(--paimind-ui-border));
  color: var(--paimind-ui-text);
}
:where([data-paimind-ui-scope]) [data-paimind-ui-button][data-variant='primary'] {
  border-color: var(--paimind-ui-accent);
  color: #fff;
  background: var(--paimind-ui-accent);
}
:where([data-paimind-ui-scope]) [data-paimind-ui-button][data-variant='quiet'] {
  border-color: transparent;
  background: transparent;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-button]:disabled {
  opacity: .45;
  cursor: not-allowed;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-summary] {
  color: var(--paimind-ui-muted);
  font-size: 12px;
  line-height: 18px;
}
`
