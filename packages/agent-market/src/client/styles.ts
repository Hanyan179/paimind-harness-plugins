export const AGENT_CENTER_STYLE: string = `
[data-paimind-agent-proposal-tool-row] {
  min-width: 0;
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary, #5f6368);
  font-size: 13px;
  line-height: 20px;
}
[data-paimind-agent-proposal-tool-row] > span:first-child {
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-state-success-primary, #16845b);
}
[data-paimind-agent-proposal-tool-row][data-state='error'] > span:first-child {
  color: var(--dsw-alias-state-error-primary, #c43b3b);
}
[data-paimind-agent-proposal-tool-row] > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-agent-trigger] {
  box-sizing: border-box;
  width: calc(100% + 8px);
  min-height: 34px;
  margin: 4px -4px;
  padding: 6px 8px 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 12px;
  color: var(--paimind-ink, var(--dsw-alias-label-primary, #202124));
  background: transparent;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
[data-paimind-agent-trigger]:hover,
[data-paimind-agent-trigger]:focus-visible,
[data-paimind-agent-trigger][aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .12));
}
[data-paimind-agent-trigger][data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 8px 0;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}
div:has(> div > button[data-paimind-product-trigger='agent-center'][data-wide='true']) {
  width: 100% !important;
  height: auto !important;
  flex-direction: column !important;
  align-items: stretch !important;
  gap: 2px !important;
}
div:has(> div > button[data-paimind-product-trigger='agent-center'][data-wide='false']) {
  width: 36px !important;
  height: auto !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 2px !important;
}
[data-paimind-agent-trigger-label] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-paimind-product-surface='agent-center'] {
  --paimind-agent-bg: var(--paimind-canvas, var(--dsw-alias-bg-base, #f4f7fb));
  --paimind-agent-panel: var(--paimind-glass-strong, var(--dsw-alias-bg-layer-1, #fff));
  --paimind-agent-soft: var(--paimind-glass, var(--dsw-alias-bg-layer-2, #eef2f7));
  --paimind-agent-line: var(--paimind-line, var(--dsw-alias-border-l1, rgba(110, 128, 154, .18)));
  --paimind-agent-ink: var(--paimind-ink, var(--dsw-alias-label-primary, #17223a));
  --paimind-agent-muted: var(--paimind-muted, var(--dsw-alias-label-secondary, #65718a));
  --paimind-agent-accent: var(--paimind-accent, var(--dsw-alias-state-business-primary, #3471f5));
  position: absolute;
  inset: 0;
  z-index: 80;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  isolation: isolate;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
}
[data-paimind-product-center-host][data-paimind-product-center-native-conversation] {
  --paimind-agent-native-conversation-width: clamp(340px, 34vw, 520px);
}
[data-paimind-product-center-host][data-paimind-product-center-native-conversation] > [data-paimind-product-surface='agent-center'] {
  right: var(--paimind-agent-native-conversation-width);
  border-right: 1px solid var(--paimind-line, var(--dsw-alias-border-l1, rgba(110, 128, 154, .18)));
}
[data-paimind-product-center-host][data-paimind-product-center-native-conversation] [data-paimind-product-center-native-conversation-content] {
  position: absolute !important;
  inset: 0 0 0 auto !important;
  z-index: 81 !important;
  width: var(--paimind-agent-native-conversation-width) !important;
  min-width: 0 !important;
  height: 100% !important;
  max-height: none !important;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #fff);
}
[data-paimind-product-surface='agent-center'] * {
  box-sizing: border-box;
}
[data-paimind-product-surface='agent-center'] [data-paimind-product-initial-focus]:focus {
  outline: none;
}
[data-paimind-product-surface='agent-center'] :is(button, input, select, textarea):focus-visible {
  outline: 2px solid var(--paimind-agent-accent);
  outline-offset: 2px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-product-body] {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--paimind-agent-bg);
  container: paimind-agent-center / inline-size;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-center] {
  position: relative;
  width: min(1120px, 100%);
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0 auto;
  padding: 22px clamp(18px, 3vw, 38px) 40px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  align-items: end;
  gap: 32px;
  padding: 2px 0 18px;
  border-bottom: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-eyebrow] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--paimind-agent-accent);
  font-size: 11px;
  font-weight: 740;
  letter-spacing: .1em;
  text-transform: uppercase;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] h1 {
  margin: 0;
  font-size: clamp(28px, 3vw, 34px);
  line-height: 1.12;
  letter-spacing: -.04em;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-copy] {
  max-width: 560px;
  margin: 7px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 14px;
  line-height: 22px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-actions] {
  min-width: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-search-row] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-search-wrap] {
  position: relative;
  display: flex;
  align-items: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-search-icon] {
  position: absolute;
  left: 14px;
  z-index: 1;
  color: var(--paimind-agent-muted);
  pointer-events: none;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-search] {
  width: 100%;
  min-height: 44px;
  padding: 10px 14px 10px 42px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 12px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
  font-size: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-search]:focus {
  border-color: var(--paimind-agent-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--paimind-agent-accent) 12%, transparent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-buttons],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-tab] {
  min-height: 38px;
  padding: 8px 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, color .16s ease;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button]:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 34%, var(--paimind-agent-line));
  color: var(--paimind-agent-ink);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button][data-primary='true'] {
  border-color: var(--paimind-agent-accent);
  color: #fff;
  background: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button][data-danger='true'] {
  color: var(--dsw-alias-state-error-primary, #d04444);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button][data-quiet='true'] {
  border-color: transparent;
  background: transparent;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button][data-icon-only='true'] {
  width: 38px;
  padding: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-button]:disabled {
  opacity: .45;
  cursor: not-allowed;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 12px 0 14px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs] {
  min-width: 0;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-tab] {
  min-height: 40px;
  border-color: transparent;
  background: transparent;
  font-weight: 650;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-tab][aria-selected='true'] {
  color: var(--paimind-agent-accent);
  background: var(--paimind-agent-panel);
  box-shadow: 0 1px 3px rgba(31, 49, 79, .1);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-count] {
  min-width: 21px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 9px;
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-business-filter] {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--paimind-agent-muted);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-business-filter] select {
  min-width: 210px;
  min-height: 36px;
  padding: 7px 30px 7px 10px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 9px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
  font-size: 11px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-section-head] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 28px;
  margin-bottom: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-visually-hidden] {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-section-head] p {
  margin: 0;
  color: var(--paimind-agent-muted);
  font-size: 11px;
  line-height: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-section-actions] {
  display: flex;
  align-items: center;
  gap: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-result-count] {
  color: var(--paimind-agent-muted);
  font-size: 10px;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-grid],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-grid] {
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  list-style: none;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] {
  min-width: 0;
  min-height: 96px;
  padding: 13px 15px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 14px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
  display: grid;
  grid-template-columns: minmax(260px, 1.35fr) minmax(170px, .75fr) auto;
  grid-template-areas:
    'identity badges actions'
    'description context actions';
  align-items: center;
  gap: 7px 16px;
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card]:hover {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 24%, var(--paimind-agent-line));
  box-shadow: 0 8px 22px rgba(31, 49, 79, .05);
  transform: translateY(-1px);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card][data-broken='true'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d04444) 28%, var(--paimind-agent-line));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-head] {
  grid-area: identity;
  display: flex;
  align-items: center;
  gap: 11px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-icon],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-seat] {
  position: relative;
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 13px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-seat] > [data-paimind-agent-avatar] {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center;
  border-radius: inherit;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-fallback] {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  transition: opacity .14s ease;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-seat][data-paimind-agent-avatar-ready='true'] > [data-paimind-agent-avatar-fallback],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-seat]:has(> [data-paimind-agent-avatar]) > [data-paimind-agent-avatar-fallback] {
  opacity: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-title] {
  min-width: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-title] h3 {
  margin: 0;
  overflow: hidden;
  color: var(--paimind-agent-ink);
  font-size: 15px;
  line-height: 21px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-kicker] {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-badges] {
  grid-area: badges;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-start;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-badge] {
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-soft);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-badge][data-category='true'],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-badge][data-success='true'] {
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] > p {
  grid-area: description;
  margin: 0;
  color: var(--paimind-agent-muted);
  font-size: 11px;
  line-height: 18px;
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-alert] {
  grid-area: unset !important;
  grid-column: 1 / 3;
  padding: 8px 10px;
  border-radius: 9px;
  color: var(--dsw-alias-state-error-primary, #d04444) !important;
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-context] {
  grid-area: context;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  min-width: 0;
  color: var(--paimind-agent-muted);
  font-size: 9px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-context] span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-actions] {
  grid-area: actions;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-button][data-primary='true'] {
  margin-left: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-status] {
  min-height: 220px;
  padding: 30px;
  display: grid;
  place-items: center;
  align-content: center;
  border: 1px dashed var(--paimind-agent-line);
  border-radius: 16px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font-size: 12px;
  line-height: 19px;
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-status-icon] {
  width: 44px;
  height: 44px;
  margin-bottom: 10px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-status] strong {
  color: var(--paimind-agent-ink);
  font-size: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-status] p {
  max-width: 540px;
  margin: 5px 0 14px;
  overflow-wrap: anywhere;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] {
  display: grid;
  align-content: start;
  gap: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] :is(span, strong, i) {
  display: block;
  border-radius: 9px;
  background: var(--paimind-agent-soft);
  animation: paimind-agent-loading 1.3s ease-in-out infinite;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] span {
  width: 42px;
  height: 42px;
  border-radius: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] strong {
  width: 46%;
  height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] i {
  width: 82%;
  height: 58px;
}
@keyframes paimind-agent-loading {
  0%, 100% { opacity: .45; }
  50% { opacity: .9; }
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-error],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-note] {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  font-size: 11px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-error] {
  color: var(--dsw-alias-state-error-primary, #d04444);
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-note] {
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-backdrop] {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: auto;
  background: rgba(10, 24, 44, .34);
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter] {
  width: min(720px, 100%);
  max-height: min(760px, calc(100dvh - 48px));
  padding: 24px;
  display: grid;
  gap: 16px;
  overflow: auto;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 20px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-panel);
  box-shadow: 0 26px 76px rgba(19, 36, 62, .24);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-head] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-icon] {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 10%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-copy] {
  min-width: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-copy] h2 {
  margin: 0;
  font-size: 23px;
  line-height: 30px;
  letter-spacing: -.02em;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-copy] > p:last-child {
  margin: 5px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 12px;
  line-height: 19px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-purpose] {
  display: grid;
  gap: 7px;
  color: var(--paimind-agent-ink);
  font-size: 12px;
  font-weight: 700;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-purpose] textarea {
  min-height: 134px;
  resize: vertical;
  padding: 14px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 13px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] {
  display: grid;
  gap: 8px;
  color: var(--paimind-agent-muted);
  font-size: 10px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] button {
  min-height: 32px;
  padding: 6px 9px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 9px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-fields] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-note] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border-radius: 10px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-bg);
  font-size: 10px;
  line-height: 17px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-note] svg {
  flex: none;
  color: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-error] {
  margin: 0;
  padding: 9px 11px;
  border-radius: 9px;
  color: var(--dsw-alias-state-error-primary, #d04444);
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
  font-size: 11px;
  line-height: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-actions] {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-builder-layer] {
  position: absolute;
  inset: 0;
  z-index: 8;
  min-width: 0;
  min-height: 0;
  overflow: clip;
  background: var(--paimind-agent-bg);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form] {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: clip;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px clamp(18px, 2.4vw, 30px);
  border-bottom: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] > div {
  min-width: 0;
  flex: 1;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-kicker] {
  margin: 0 0 3px !important;
  color: var(--paimind-agent-accent) !important;
  font-size: 10px !important;
  font-weight: 730;
  letter-spacing: .09em;
  text-transform: uppercase;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form] h2 {
  margin: 0;
  font-size: 23px;
  line-height: 29px;
  letter-spacing: -.025em;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] p {
  max-width: 760px;
  margin: 4px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 11px;
  line-height: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-builder-close] {
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 50%;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-builder-close]:hover {
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-save-state] {
  flex: none;
  align-self: center;
  padding: 5px 9px;
  border-radius: 999px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-soft);
  font-size: 9px;
  font-weight: 650;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-save-state][data-dirty='true'] {
  color: var(--dsw-alias-state-warning-primary, #9a6400);
  background: color-mix(in srgb, currentColor 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-message] {
  min-height: 0;
  overflow: hidden;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-error] {
  margin: 0;
  padding: 9px clamp(18px, 2.4vw, 30px);
  color: var(--dsw-alias-state-error-primary, #d04444);
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
  font-size: 10px;
  line-height: 17px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-body] {
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: clip;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-main] {
  min-width: 0;
  min-height: 0;
  padding: 22px clamp(18px, 2.6vw, 34px) 34px;
  display: grid;
  align-content: start;
  gap: 14px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-editable-fields] {
  min-width: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 14px;
  border: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-brief-head] {
  display: grid;
  gap: 14px;
  padding: 2px 0 4px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-brief-head] > div:first-child h2 {
  font-size: 20px;
  line-height: 27px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-brief-head] > div:first-child p {
  margin: 4px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 11px;
  line-height: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-identity-row] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--paimind-agent-accent) 25%, var(--paimind-agent-line));
  border-radius: 12px;
  color: var(--paimind-agent-muted);
  background: color-mix(in srgb, var(--paimind-agent-accent) 6%, var(--paimind-agent-panel));
  font-size: 10px;
  line-height: 17px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] > span {
  min-width: 0;
  flex: 1;
  display: inline-flex;
  align-items: flex-start;
  gap: 7px;
  color: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] > div {
  flex: none;
  display: flex;
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] strong {
  color: var(--paimind-agent-ink);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] p {
  margin: 2px 0 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] button {
  margin: 0;
  padding: 5px 8px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 8px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-panel] {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 15px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] > span:first-child {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
  font-size: 9px;
  font-weight: 760;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] h3,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] strong {
  margin: 1px 0 0;
  color: var(--paimind-agent-ink);
  font-size: 14px;
  line-height: 20px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] p,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-panel-head] small {
  display: block;
  margin: 2px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-fields] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] {
  min-width: 0;
  display: grid;
  gap: 6px;
  color: var(--paimind-agent-muted);
  font-size: 10px;
  font-weight: 620;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field][data-wide='true'] {
  grid-column: 1 / -1;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] :is(input, select, textarea) {
  width: 100%;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
  font-size: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] :is(input, select, textarea):focus {
  border-color: var(--paimind-agent-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--paimind-agent-accent) 11%, transparent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] textarea {
  min-height: 92px;
  resize: vertical;
  line-height: 19px;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-panel] {
  height: max-content;
  min-height: 76px;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: clip;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-toggle] {
  width: 100%;
  min-height: 74px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border: 0;
  color: var(--paimind-agent-ink);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-toggle]:hover,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-toggle][aria-expanded='true'] {
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-toggle] [data-paimind-agent-panel-head] {
  min-width: 0;
  margin: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-toggle] > span:last-child {
  flex: none;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-picker] {
  min-width: 0;
  margin: 0;
  padding: 0 16px 16px;
  border: 0;
  background: transparent;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-picker] legend {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-picker]:disabled {
  opacity: .68;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-policy] {
  margin: 0 0 11px !important;
  padding: 9px 10px;
  border-radius: 9px;
  color: var(--paimind-agent-muted) !important;
  background: var(--paimind-agent-bg);
  font-size: 10px !important;
  font-weight: 500 !important;
  line-height: 17px !important;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-toolbar] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-search] {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--paimind-agent-muted);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-search] > svg {
  position: absolute;
  left: 11px;
  pointer-events: none;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] [data-paimind-agent-skill-search] > input {
  min-height: 40px;
  padding-left: 34px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-selected] {
  min-height: 40px;
  padding: 8px 11px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-selected][aria-pressed='true'] {
  border-color: var(--paimind-agent-accent);
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-categories] {
  display: flex;
  gap: 5px;
  margin-top: 9px;
  padding: 1px 0 4px;
  overflow: auto;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-categories] button {
  flex: none;
  min-height: 31px;
  padding: 5px 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 9px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-categories] button small {
  min-width: 17px;
  padding: 1px 4px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-size: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-categories] button[aria-pressed='true'] {
  border-color: var(--paimind-agent-accent);
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-summary] {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 9px 0 7px;
  color: var(--paimind-agent-muted);
  font-size: 9px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-results] {
  max-height: 360px;
  padding-right: 3px;
  display: grid;
  gap: 7px;
  overflow: auto;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill] {
  content-visibility: auto;
  contain-intrinsic-size: 64px;
  padding: 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  background: var(--paimind-agent-bg);
  font-weight: 500;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill][data-selected='true'] {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 42%, var(--paimind-agent-line));
  background: color-mix(in srgb, var(--paimind-agent-accent) 5%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-field] [data-paimind-agent-skill] > input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  padding: 0;
  box-shadow: none;
  accent-color: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill] > span {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill] strong {
  min-width: 0;
  color: var(--paimind-agent-ink);
  font-size: 10px;
  line-height: 16px;
  overflow-wrap: anywhere;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill] small {
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill] em {
  grid-column: 1 / -1;
  display: -webkit-box;
  overflow: hidden;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  font-style: normal;
  line-height: 15px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-empty] {
  padding: 18px 12px;
  border: 1px dashed var(--paimind-agent-line);
  border-radius: 10px;
  color: var(--paimind-agent-muted);
  font-size: 10px;
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-runtime-note] {
  margin: 0;
  padding: 4px 2px;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  line-height: 16px;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] {
  padding: 9px clamp(18px, 2.4vw, 30px);
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button {
  min-height: 32px;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  color: var(--paimind-agent-muted);
  background: transparent;
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button[aria-selected='true'] {
  color: var(--paimind-agent-accent);
  background: var(--paimind-agent-panel);
  box-shadow: 0 2px 8px rgba(31, 49, 79, .07);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button:disabled {
  cursor: wait;
  opacity: .58;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  color: var(--paimind-agent-muted);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] > svg {
  color: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status][data-tone='warning'] > svg {
  color: var(--dsw-alias-state-warning-primary, #9a6400);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status][data-tone='error'] > svg {
  color: var(--dsw-alias-state-error-primary, #d04444);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] span {
  min-width: 0;
  display: grid;
  gap: 1px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] strong {
  color: var(--paimind-agent-ink);
  font-size: 10px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] small {
  overflow: hidden;
  font-size: 9px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] {
  min-width: 0;
  padding: 12px clamp(18px, 2.4vw, 30px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
  box-shadow: 0 -7px 22px rgba(31, 49, 79, .035);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] > p {
  margin: 0;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] > div {
  flex: none;
  display: flex;
  gap: 8px;
}

@container paimind-agent-center (max-width:860px) {
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 14px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell] {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'identity actions'
      'description description'
      'badges context';
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card-alert] {
    grid-column: 1 / -1;
  }
}

@container paimind-agent-center (max-width:620px) {
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-center] {
    padding: 14px 12px 28px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-buttons] {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs] {
    overflow-x: auto;
    scrollbar-width: thin;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'identity'
      'description'
      'badges'
      'context'
      'actions';
    gap: 9px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-actions] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px 38px;
    justify-content: stretch;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card-alert] {
    grid-column: 1;
  }
}

@media(max-width:980px) {
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] {
    --paimind-agent-native-conversation-width: clamp(320px, 38vw, 380px);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-grid],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-grid] {
    grid-template-columns: 1fr;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'identity actions'
      'description description'
      'badges context';
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-body] {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    overscroll-behavior: contain;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-main] {
    order: 2;
    overflow: visible;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] {
    grid-template-columns: minmax(200px, 250px) minmax(0, 1fr);
  }
}

@media(max-width:680px) {
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] {
    --paimind-agent-native-conversation-width: min(46vw, 320px);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-center] {
    padding: 12px 10px 28px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
    padding: 0 0 14px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] h1 {
    font-size: 29px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell] {
    display: grid;
    overflow: hidden;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs] {
    overflow: auto;
    scrollbar-width: thin;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-business-filter] {
    display: grid;
    gap: 5px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-business-filter] select {
    width: 100%;
    min-width: 0;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-section-head],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card-context] {
    align-items: flex-start;
    flex-direction: column;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'identity'
      'description'
      'badges'
      'context'
      'actions';
    gap: 9px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-actions] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px 38px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-button][data-primary='true'] {
    margin: 0;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card-alert] {
    grid-column: 1;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-backdrop] {
    padding: 10px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter] {
    max-height: calc(100dvh - 20px);
    padding: 18px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-head] {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-icon] {
    width: 42px;
    height: 42px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-fields],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-identity-row],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-fields] {
    grid-template-columns: 1fr;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-field][data-wide='true'] {
    grid-column: auto;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-actions] {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] {
    padding: 13px 12px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] p {
    display: none;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-save-state] {
    display: none;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-error],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-main],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] {
    padding-left: 12px;
    padding-right: 12px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] {
    padding: 9px 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] small {
    white-space: normal;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-panel] {
    padding: 15px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-skills-panel] {
    padding: 0;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-toolbar] {
    grid-template-columns: 1fr;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-skill-summary] {
    display: grid;
    gap: 3px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] {
    align-items: stretch;
    flex-direction: column;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-actions] > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media(prefers-reduced-motion:reduce) {
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-button],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tab] {
    transition: none;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] :is(span, strong, i) {
    animation: none;
  }
}

@media(forced-colors:active) {
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-button],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tab],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-panel] {
    forced-color-adjust: auto;
  }
}
`
