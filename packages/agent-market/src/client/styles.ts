export const AGENT_CENTER_STYLE: string = `
body[data-paimind-agent-test-session-active] [data-slot='sidebar.workspaces'] [role='treeitem'][aria-selected='true'] {
  display: none !important;
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
  --paimind-agent-bg: var(--paimind-ui-canvas);
  --paimind-agent-panel: var(--paimind-ui-panel);
  --paimind-agent-soft: var(--paimind-ui-subtle);
  --paimind-agent-line: var(--paimind-ui-border);
  --paimind-agent-ink: var(--paimind-ui-text);
  --paimind-agent-muted: var(--paimind-ui-muted);
  --paimind-agent-accent: var(--paimind-ui-accent);
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
  --paimind-agent-native-conversation-width: clamp(360px, 34vw, 520px);
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
[data-paimind-product-center-host][data-paimind-product-center-native-conversation-disabled] [data-paimind-product-center-native-conversation-content] {
  opacity: .72;
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
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-center] {
  position: relative;
  width: min(1180px, 100%);
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0 auto;
  padding: 24px clamp(18px, 3vw, 40px) 48px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-center][data-builder-open='true'] {
  overflow: clip;
  overscroll-behavior: none;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 390px);
  align-items: center;
  gap: 28px;
  padding: 26px clamp(22px, 3vw, 34px);
  border: 1px solid var(--paimind-agent-line);
  border-radius: 20px;
  background: var(--paimind-agent-panel);
  box-shadow: 0 12px 34px rgba(31, 49, 79, .06);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-eyebrow] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--paimind-agent-accent);
  font-size: 11px;
  font-weight: 740;
  letter-spacing: .1em;
  text-transform: uppercase;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] h1 {
  margin: 0;
  font-size: clamp(30px, 3.4vw, 40px);
  line-height: 1.08;
  letter-spacing: -.04em;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-copy] {
  max-width: 650px;
  margin: 11px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 14px;
  line-height: 22px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-hero-actions] {
  display: grid;
  gap: 10px;
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
[data-paimind-agent-draft-question-recovered] > :not([data-paimind-agent-draft-projection]) {
  display: none !important;
}

[data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 18px 0 24px;
  padding: 5px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 14px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs] {
  min-width: 0;
  display: flex;
  gap: 3px;
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
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
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
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-section-head] h2 {
  margin: 0;
  font-size: 18px;
  line-height: 25px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-section-head] p {
  margin: 4px 0 0;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  list-style: none;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-card] {
  min-width: 0;
  min-height: 222px;
  padding: 19px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 16px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card][data-broken='true'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d04444) 28%, var(--paimind-agent-line));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-head] {
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
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
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
  margin: 0;
  color: var(--paimind-agent-muted);
  font-size: 11px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-alert] {
  padding: 8px 10px;
  border-radius: 9px;
  color: var(--dsw-alias-state-error-primary, #d04444) !important;
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-context] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  margin-top: auto;
  color: var(--paimind-agent-muted);
  font-size: 9px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card-context] span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-actions] {
  align-items: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-button][data-primary='true'] {
  margin-left: auto;
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
  font-size: 11px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] > span {
  color: var(--paimind-agent-ink);
  font-weight: 680;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] button {
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 9px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 11px;
  line-height: 17px;
  text-align: left;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] button:hover {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 38%, var(--paimind-agent-line));
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-soft);
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
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter] {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 24;
  width: 14px;
  padding: 0;
  border: 0;
  outline: 0;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  background: transparent;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter]::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 6px;
  width: 1px;
  background: var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter]::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 4px;
  width: 5px;
  height: 50px;
  border-radius: 999px;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 140ms ease, background-color 140ms ease;
  background: color-mix(in srgb, var(--paimind-agent-accent) 54%, transparent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter]:is(:hover, :focus-visible)::after,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter][data-active='true']::after {
  opacity: 1;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter]:focus-visible {
  outline: 2px solid var(--paimind-agent-accent);
  outline-offset: -4px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form] {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  overflow: clip;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form][data-mode='test'] {
  grid-template-rows: auto auto minmax(0, 1fr);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form][data-mode='test'] [data-paimind-agent-form-head] {
  padding: 15px 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form][data-mode='test'] h2 {
  font-size: 18px;
  line-height: 24px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px clamp(18px, 2.4vw, 30px);
  border-bottom: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head] > div:first-child {
  min-width: 0;
  flex: 1;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-head-actions] {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
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
[data-paimind-product-surface='agent-center'] [data-paimind-agent-brief-head] {
  display: grid;
  padding: 2px 0 4px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-identity-row] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 238px);
  align-items: start;
  gap: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-identity-fields] {
  min-width: 0;
  display: grid;
  gap: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] legend {
  margin-bottom: 7px;
  color: var(--paimind-agent-muted);
  font-size: 10px;
  font-weight: 650;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] button {
  min-width: 0;
  padding: 7px 3px 6px;
  display: grid;
  justify-items: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--paimind-agent-muted);
  background: transparent;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] button[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 34%, var(--paimind-agent-line));
  color: var(--paimind-agent-ink);
  background: color-mix(in srgb, var(--paimind-agent-accent) 8%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] [data-paimind-agent-avatar-seat] {
  width: 38px;
  height: 38px;
  border-radius: 50%;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-avatar-picker] small {
  width: 100%;
  overflow: hidden;
  font-size: 8px;
  line-height: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--paimind-agent-accent) 25%, var(--paimind-agent-line));
  border-radius: 12px;
  color: var(--paimind-agent-muted);
  background: color-mix(in srgb, var(--paimind-agent-accent) 6%, var(--paimind-agent-panel));
  font-size: 10px;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-icon] {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 12%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-copy] {
  min-width: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-actions] {
  display: flex;
  align-items: center;
  gap: 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] strong {
  display: block;
  color: var(--paimind-agent-ink);
  font-size: 11px;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] p {
  margin: 2px 0 7px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-fields] {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-fields] span {
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, transparent);
  font-size: 9px;
  line-height: 14px;
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
[data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] button[data-primary='true'] {
  border-color: var(--paimind-agent-accent);
  color: var(--paimind-agent-panel);
  background: var(--paimind-agent-accent);
}
[data-paimind-product-center-native-conversation-content] [data-paimind-agent-draft-projection] {
  width: fit-content;
  margin-top: 10px;
  padding: 5px 9px;
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--paimind-agent-accent) 22%, var(--paimind-agent-line));
  border-radius: 999px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 7%, var(--paimind-agent-panel));
  font-size: 10px;
  line-height: 16px;
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

[data-paimind-product-surface='agent-center'] [data-paimind-agent-form-column][data-secondary='true'] {
  width: clamp(360px, 31vw, 400px);
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow: clip;
  border-left: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation] {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: clip;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 16px;
  background: var(--paimind-agent-panel);
  box-shadow: 0 10px 28px rgba(31, 49, 79, .06);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-head] {
  flex: none;
  padding: 14px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  border-bottom: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-creator],
[data-paimind-product-surface='agent-center'] [data-paimind-agent-creator-avatar] {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-head] h3 {
  margin: 0;
  font-size: 13px;
  line-height: 19px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-head] p {
  margin: 2px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-creator-permission] {
  grid-column: 2;
  width: fit-content;
  margin-top: 5px;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-soft);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-creator-permission][data-enabled='true'] {
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
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
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 7px;
  border-bottom: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button {
  min-height: 32px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--paimind-agent-muted);
  background: transparent;
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button[aria-selected='true'] {
  color: var(--paimind-agent-accent);
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-tabs] button:disabled {
  cursor: wait;
  opacity: .58;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] [data-paimind-agent-conversation-tabs] {
  padding: 4px;
  border: 0;
  border-radius: 10px;
  background: var(--paimind-agent-soft);
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
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form][data-mode='test'] [data-paimind-agent-native-toolbar] {
  padding: 10px 14px;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-form][data-mode='test'] [data-paimind-agent-native-status] small {
  white-space: normal;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-mode] {
  min-height: 0;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-profile] {
  padding: 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 12px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-profile] > span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--paimind-agent-accent);
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-profile] strong {
  color: var(--paimind-agent-ink);
  font-size: 12px;
  line-height: 18px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-profile] p {
  margin: 3px 0 0;
  color: var(--paimind-agent-muted);
  font-size: 9px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-composition] {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-composition] span {
  padding: 2px 7px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 999px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-soft);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-composition] small {
  flex-basis: 100%;
  color: var(--paimind-agent-muted);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-mode] [data-paimind-agent-test-gate] {
  min-height: 180px;
  padding: 18px 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-mode] [data-paimind-agent-test-gate] [data-paimind-agent-button] {
  margin-top: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-mode] [data-paimind-agent-test-gate][data-tone='error'] svg,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-mode] [data-paimind-agent-test-gate][data-tone='error'] p {
  color: var(--dsw-alias-state-error-primary, #d04444);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 12px;
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-history-open='true'] {
  display: grid;
  grid-template-columns: minmax(260px, 32%) minmax(0, 1fr);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] > header {
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] > header p {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--paimind-agent-muted);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript-messages] {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] article {
  margin: 0 auto 20px;
  max-width: 820px;
  padding: 16px;
  border-radius: 12px;
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] article[data-role='user'] {
  background: color-mix(in srgb, var(--paimind-agent-accent) 8%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] article[data-role='error'] {
  color: var(--dsw-alias-state-error-primary, #d04444);
}
[data-paimind-product-surface='agent-center'] [data-paimind-test-transcript] pre {
  margin: 10px 0 0;
  font: inherit;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  [data-paimind-product-surface='agent-center'] [data-history-open='true'] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 42% minmax(0, 1fr);
  }
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] > header {
  padding: 11px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--paimind-agent-line);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] > header strong {
  color: var(--paimind-agent-ink);
  font-size: 11px;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] > header [data-paimind-agent-button] {
  flex: none;
  min-height: 28px;
  padding: 5px 8px;
  font-size: 9px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] ul {
  min-height: 0;
  margin: 0;
  padding: 6px;
  display: grid;
  align-content: start;
  gap: 4px;
  overflow: auto;
  list-style: none;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button {
  width: 100%;
  min-width: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--paimind-agent-ink);
  background: transparent;
  text-align: left;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button:not(:disabled) {
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button:not(:disabled):hover {
  background: color-mix(in srgb, var(--paimind-agent-accent) 5%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button:focus-visible {
  outline: 2px solid var(--paimind-agent-accent);
  outline-offset: 1px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button[aria-current='page'] {
  border-color: color-mix(in srgb, var(--paimind-agent-accent) 24%, var(--paimind-agent-line));
  background: color-mix(in srgb, var(--paimind-agent-accent) 8%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button > span:first-child {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--paimind-agent-muted);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button > span:first-child[data-state='running'] {
  background: var(--dsw-alias-state-warning-primary, #9a6400);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button > span:first-child[data-state='complete'] {
  background: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button > span:first-child[data-state='error'] {
  background: var(--dsw-alias-state-error-primary, #d04444);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li > button > span:last-child {
  min-width: 0;
  display: grid;
  gap: 2px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li strong,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li strong {
  font-size: 10px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history] li small,
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history-empty] {
  color: var(--paimind-agent-muted);
  font-size: 8px;
  line-height: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-history-empty] {
  min-height: 98px;
  padding: 18px 14px;
  display: grid;
  place-items: center;
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-ready] {
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 9px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-soft);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-ready] > svg {
  flex: none;
  color: var(--paimind-agent-accent);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-ready] > span {
  min-width: 0;
  display: grid;
  gap: 1px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-ready] strong {
  color: var(--paimind-agent-ink);
  font-size: 10px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-ready] small {
  font-size: 8px;
  line-height: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-actions] {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
[data-paimind-agent-test-locked='true'] [data-paimind-agent-test-seat] {
  cursor: default !important;
}
[data-paimind-agent-test-locked='true'] [data-paimind-agent-test-seat] svg:last-child {
  display: none;
}
[data-paimind-agent-test-locked='true'] [data-paimind-quick-agents] {
  display: none !important;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-messages] {
  flex: 1 1 0;
  min-height: 0;
  max-height: none;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message] {
  max-width: 92%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message][data-role='user'] {
  align-self: flex-end;
  flex-direction: row-reverse;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message] > span {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 10%, var(--paimind-agent-panel));
  font-size: 8px;
  font-weight: 760;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message] > div {
  min-width: 0;
  padding: 8px 10px;
  border-radius: 4px 12px 12px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-bg);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message][data-role='user'] > div {
  border-radius: 12px 4px 12px 12px;
  color: var(--paimind-agent-ink);
  background: color-mix(in srgb, var(--paimind-agent-accent) 9%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message] p {
  margin: 0;
  font-size: 10px;
  line-height: 17px;
  overflow-wrap: anywhere;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-message] small {
  display: block;
  margin-top: 5px;
  color: var(--paimind-agent-accent);
  font-size: 8px;
  line-height: 14px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-suggestions] {
  flex: none;
  padding: 0 13px 8px;
  display: flex;
  gap: 6px;
  overflow: auto;
  scrollbar-width: thin;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-suggestions] button {
  flex: none;
  padding: 5px 8px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 999px;
  color: var(--paimind-agent-muted);
  background: transparent;
  font: inherit;
  font-size: 8px;
  cursor: pointer;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-composer] {
  flex: none;
  padding: 10px 12px 4px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 7px;
  border-top: 1px solid var(--paimind-agent-line);
  background: var(--paimind-agent-panel);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-composer] textarea {
  min-width: 0;
  min-height: 62px;
  max-height: 128px;
  resize: vertical;
  padding: 9px 10px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 10px;
  color: var(--paimind-agent-ink);
  background: var(--paimind-agent-bg);
  font: inherit;
  font-size: 10px;
  line-height: 17px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-hint] {
  flex: none;
  padding: 0 12px 10px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-panel);
  font-size: 8px;
  line-height: 13px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test] {
  min-height: 0;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-gate] {
  min-height: 0;
  flex: 1;
  padding: 26px 18px;
  display: grid;
  place-items: center;
  align-content: center;
  color: var(--paimind-agent-muted);
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-gate] svg {
  margin-bottom: 9px;
  color: var(--dsw-alias-state-warning-primary, #9a6400);
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-gate] strong {
  color: var(--paimind-agent-ink);
  font-size: 12px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-gate] p {
  max-width: 290px;
  margin: 5px 0 0;
  font-size: 9px;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-empty] {
  min-height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  color: var(--paimind-agent-muted);
  text-align: center;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-empty] p {
  max-width: 240px;
  margin: 7px 0 0;
  font-size: 9px;
  line-height: 16px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-status] {
  align-self: stretch;
  padding: 8px 10px;
  border-radius: 9px;
  color: var(--paimind-agent-muted);
  background: var(--paimind-agent-soft);
  font-size: 9px;
  line-height: 15px;
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-status][data-status='complete'] {
  color: var(--paimind-agent-accent);
  background: color-mix(in srgb, var(--paimind-agent-accent) 8%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-test-status][data-status='error'] {
  color: var(--dsw-alias-state-error-primary, #d04444);
  background: color-mix(in srgb, currentColor 7%, var(--paimind-agent-panel));
}
[data-paimind-product-surface='agent-center'] [data-paimind-agent-open-test] {
  flex: none;
  min-height: 32px;
  margin: 0 12px 10px;
  border: 1px solid var(--paimind-agent-line);
  border-radius: 9px;
  color: var(--paimind-agent-accent);
  background: var(--paimind-agent-panel);
  font: inherit;
  font-size: 9px;
  font-weight: 650;
  cursor: pointer;
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

@media(max-width:980px) {
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] {
    --paimind-agent-native-conversation-width: clamp(320px, 40vw, 400px);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-grid],
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-loading-grid] {
    grid-template-columns: 1fr;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] {
    grid-template-columns: auto minmax(0, 1fr);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-actions] {
    grid-column: 2;
    flex-wrap: wrap;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] {
    grid-template-columns: minmax(200px, 250px) minmax(0, 1fr);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-column][data-secondary='true'] {
    order: 1;
    width: 100%;
    height: clamp(430px, 62dvh, 580px);
    padding: 14px clamp(18px, 2.6vw, 34px);
    border-left: 0;
    border-bottom: 1px solid var(--paimind-agent-line);
  }
}

@media(max-width:680px) {
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] {
    --paimind-agent-native-conversation-height: clamp(260px, 44dvh, 420px);
  }
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] > [data-paimind-product-surface='agent-center'] {
    inset: 0 0 var(--paimind-agent-native-conversation-height);
    border-right: 0;
    border-bottom: 1px solid var(--paimind-line, var(--dsw-alias-border-l1, rgba(110, 128, 154, .18)));
  }
  [data-paimind-product-center-host][data-paimind-product-center-native-conversation] [data-paimind-product-center-native-conversation-content] {
    inset: auto 0 0 !important;
    width: 100% !important;
    height: var(--paimind-agent-native-conversation-height) !important;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-center] {
    padding: 12px 10px 28px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter] {
    display: none;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] {
    padding: 20px 17px;
    border-radius: 16px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-hero] h1 {
    font-size: 32px;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs-shell] {
    display: grid;
    overflow: hidden;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tabs] {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-tab] {
    min-width: 0;
    padding: 7px 4px;
    gap: 4px;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-actions] {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-card] [data-paimind-agent-button][data-primary='true'] {
    margin: 0;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-starter-suggestions] > div {
    grid-template-columns: 1fr;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update] {
    grid-template-columns: 1fr;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-icon] {
    display: none;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-ai-update-actions] {
    grid-column: auto;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-toolbar] {
    padding: 9px 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-native-status] small {
    white-space: normal;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-form-column][data-secondary='true'] {
    height: min(64dvh, 540px);
    min-height: 420px;
    padding: 10px 12px;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-composer] {
    grid-template-columns: 1fr;
  }
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-conversation-composer] [data-paimind-agent-button] {
    width: 100%;
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
  [data-paimind-product-surface='agent-center'] [data-paimind-agent-splitter]::after {
    transition: none;
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
