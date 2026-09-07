/** Layout is source-owned; colors, controls, states and motion come from ui-foundation. */
export const APPEARANCE_STYLE = `
[data-paimind-appearance] { display: grid; gap: var(--paimind-ui-space-4); padding: var(--paimind-ui-space-4); }
[data-paimind-appearance] h3 { margin: 0; font-size: 16px; line-height: 24px; }
[data-paimind-appearance] p { margin: 0; }
[data-paimind-motion-title] { display: grid; gap: 4px; }
[data-paimind-motion-preview] { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-radius: var(--paimind-ui-radius-sm); background: var(--paimind-ui-subtle); }
[data-paimind-motion-preview] > span { min-width: 0; display: grid; gap: 4px; }
[data-paimind-motion-indicator] { width: 12px; height: 12px; flex: none; border-radius: 50%; background: var(--paimind-ui-accent); }
[data-paimind-motion-preview][data-motion-enabled='true'] [data-paimind-motion-indicator] { animation: paimind-preference-pulse var(--paimind-motion-loop) ease-in-out infinite; }
@keyframes paimind-preference-pulse { 0%,100% { opacity: .5; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
`
