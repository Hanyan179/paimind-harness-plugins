# Proposal purpose examples and host theme — 2026-09-08

- Source owner: `packages/proposal-experience/src/client/index.tsx`.
- Added maintained purpose explanations, audience, story structure and illustrative examples for Growth & investment ask, Seasonal reset proposal and Performance & partnership review. Unknown purposes display their own description instead of an unrelated Category Analysis preview.
- Card, option, preview, text and border colors now consume native Harness theme tokens. Brand logos and storyboard artwork retain their own colors.
- Validation: targeted TypeScript check passed; 12 proposal client tests passed, including switching all three purposes, unknown-purpose fallback and no premature answer submission. Upstream primitive source-map warning remains non-blocking.
- Live browser: current 3080 Harness loaded the updated client bundle. Content & Data card visibly follows the light host background; computed card background rgb(247,248,251), foreground rgb(20,40,66). User continued selecting in the live session during verification. Dark-theme switching and full deck generation were not verified in this change.
- Runtime scope: 3080 runs the b634 checkout. Only its generated proposal client bundle was replaced for preview; source changes remain in this repository. Previous client bundle is backed up at `/tmp/proposal-client-before-20260908.js`. Rebuilding b634 can replace this preview; no runtime restart, release or Git synchronization was performed.
