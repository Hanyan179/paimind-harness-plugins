import { PAIMIND_MOTION_CSS } from './motion.js'
export * from './motion.js'
export * from './keyboard.js'

/**
 * Shared, opt-in visual foundation for PAIMind-owned client surfaces.
 * Harness remains the theme owner; these aliases only normalize PAIMind density,
 * focus, radii and progressive-disclosure behavior below an explicit scope.
 */
export const PAIMIND_UI_FOUNDATION_CSS: string = `${PAIMIND_MOTION_CSS}

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
  --paimind-ui-space-1: 4px;
  --paimind-ui-space-2: 8px;
  --paimind-ui-space-3: 12px;
  --paimind-ui-space-4: 16px;
  --paimind-ui-space-6: 24px;
  --paimind-ui-control-height: 36px;
  --paimind-ui-text-sm: 12px;
  --paimind-ui-text-md: 14px;
  --paimind-ui-text-lg: 20px;
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
  min-height: var(--paimind-ui-control-height);
  padding: 6px 10px;
  border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-sm);
  color: var(--paimind-ui-muted);
  background: var(--paimind-ui-panel);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background var(--paimind-motion-fast) ease, border-color var(--paimind-motion-fast) ease;
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

:where([data-paimind-ui-scope]) [data-paimind-ui-field] {
  width: 100%; min-width: 0; min-height: var(--paimind-ui-control-height);
  padding: 8px 12px; border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-sm); background: var(--paimind-ui-panel);
  color: var(--paimind-ui-text); font: inherit; line-height: 1.5;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-field]:disabled { opacity: .55; }
:where([data-paimind-ui-scope]) [data-paimind-ui-choices] {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
  gap: var(--paimind-ui-space-2); border: 0; margin: 0; padding: 0; min-width: 0;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-choice] {
  display: flex; gap: var(--paimind-ui-space-2); align-items: flex-start;
  padding: var(--paimind-ui-space-3); border: 1px solid var(--paimind-ui-border);
  border-radius: var(--paimind-ui-radius-md); cursor: pointer; min-width: 0;
  background: var(--paimind-ui-panel); color: var(--paimind-ui-text);
  transition: border-color var(--paimind-motion-fast) ease, background var(--paimind-motion-fast) ease;
}
:where([data-paimind-ui-scope]) [data-paimind-ui-choice]:has(:checked) {
  border-color: var(--paimind-ui-accent);
  background: color-mix(in srgb, var(--paimind-ui-accent) 9%, var(--paimind-ui-panel));
}
:where([data-paimind-ui-scope]) [data-paimind-ui-choice]:has(:disabled) { opacity: .55; cursor: not-allowed; }
:where([data-paimind-ui-scope]) [data-paimind-ui-choice] input { flex: none; margin: 3px 0 0; accent-color: var(--paimind-ui-accent); }
:where([data-paimind-ui-scope]) [data-paimind-ui-choice] span { min-width: 0; display: grid; gap: 4px; }
:where([data-paimind-ui-scope]) [data-paimind-ui-choice] strong { font-size: var(--paimind-ui-text-md); line-height: 20px; }
:where([data-paimind-ui-scope]) [data-paimind-ui-choice] small { color: var(--paimind-ui-muted); font-size: var(--paimind-ui-text-sm); line-height: 18px; }
:where([data-paimind-ui-scope]) [data-paimind-ui-state] { color: var(--paimind-ui-muted); font-size: var(--paimind-ui-text-sm); line-height: 18px; }
:where([data-paimind-ui-scope]) [data-paimind-ui-state='error'] { color: var(--paimind-ui-danger); }
:where([data-paimind-ui-scope]) [data-paimind-ui-state='success'] { color: var(--paimind-ui-success); }

:where([data-paimind-ui-scope]) :is(button, select, textarea, input) { max-width: 100%; }
:where([data-paimind-ui-scope]) :is(p, h1, h2, h3, h4, code) { overflow-wrap: anywhere; }
:where([data-paimind-ui-scope]) summary { cursor: pointer; }
:where([data-paimind-ui-scope]) summary:focus-visible { outline: 2px solid var(--paimind-ui-accent); outline-offset: 2px; }
@media (max-width: 680px), (pointer: coarse) {
  [data-paimind-ui-scope] :is(button, select, input:not([type='checkbox']):not([type='radio']):not([type='file']), summary) { min-height: 44px; }
  [data-paimind-ui-scope] label:has(> input:is([type='checkbox'], [type='radio'])) { min-height: 44px; }
}

/* A 44px target with a compact track, shared by every settings switch. */
:where([data-paimind-ui-scope]) [data-paimind-ui-switch] { position:relative;flex:0 0 auto;width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:var(--paimind-ui-radius-sm);background:transparent;cursor:pointer; }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch]::before { content:'';position:absolute;top:10px;left:1px;width:42px;height:24px;border-radius:999px;background:var(--paimind-ui-border);transition:background var(--paimind-motion-fast) ease; }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch]::after { content:'';position:absolute;top:13px;left:4px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transform:none;transition:transform var(--paimind-motion-fast) ease; }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch][aria-checked='true'] { background:transparent; }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch][aria-checked='true']::before { background:var(--paimind-ui-accent); }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch][aria-checked='true']::after { transform:translateX(18px); }
:where([data-paimind-ui-scope]) [data-paimind-ui-switch]:is(:disabled,[aria-disabled='true']) { opacity:.55;cursor:not-allowed; }
`
