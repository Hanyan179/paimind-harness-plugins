# Proposal workbench audit and recording — 2026-09-08

## Scope and ownership review

Existing renderer-bento enhancement. Renderer owns the presentation workbench, its expand/exit controls, thumbnail visibility, and transient React state. No new persistent entity or namespace; no changes to source facts, runtime services, or Harness compatibility. Trace remains presentation-trace's inspector contribution. Component cleanup removes document listeners; native conversation remains outside this surface. No upstream source edits.

## Before recording

Fresh browser inspection of the completed six-slide Dollar General synthetic deck showed trace squeezing the canvas between conversation, thumbnail rail, and inspector. Edit had large unused margins at panel width and no expansion entry.

Changes: full-viewport workbench with native fullscreen request when supported, explicit exit, Escape fallback, collapsible thumbnails, bounded inspector width, stacked inspector below 1000 px, honest transient-edit guidance. Expansion remains active when switching preview/edit/trace.

Live preview uses the b634 composition at port 3080. Main repository source is built into the live renderer-bento client bundle for browser verification. Backup: /tmp/bento-client-before-20260908.js. This is local preview, not a release; a b634 rebuild would replace that bundle.

Observed expanded trace canvas: 2062 × 1340 in 2560 × 1440 browser viewport. Embedded browser reported no document.fullscreenElement; the viewport fallback worked. This proves browser-wide expansion, not OS fullscreen API success.

Editing is temporary in the frame; source file persistence is not implemented. Source facts remain locked. Reload restores original file.

## Recording

Output directory: /Users/hansen/Downloads/proposal-demo-recording-20260908/
Fresh flow prompt requests five interactive choice screens, synthetic analysis, fact set, outline, and native Bento HTML output under proposal-video-demo-20260908/. Recording status and artifact verification will be completed after the run.

## Additional recording finding

Bilingual option labels failed exact preview lookup (for example Strategy Consulting 战略咨询风 and 季节重置提案（Seasonal Reset）). Maintained label aliases now resolve those variants while submitting the original answer unchanged. Verified all three style images by real clicks after refresh. Thirteen proposal UI tests and seventeen renderer tests passed (30 total); both package typechecks passed. An upstream dependency emits a missing source-map warning; it did not fail tests.
