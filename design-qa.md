# FP01 Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b29bdb06-ad2e-473c-b2d7-d53da319a3e3.png`
- Implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-unified-history-orbs-20px.jpg`
- Combined dark-theme settled-row comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-native-vs-unified-orbs.jpg`
- Live tool state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-live-bash-status.jpg`

The source and implementation crops were normalized to the same 536px row-region width and the same settled-history state before comparison.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the nine small visual primitives intentionally share a quiet monochrome particle language; their silhouette, dynamic label, and motion state carry differentiation.

## Verified behavior

- 20px orbs occupy the native 16px leading slot without changing the 24px row rhythm.
- Settled history is paused; only rows explicitly marked `running` animate.
- Final idle browser measurement: 69 history orbs, all 69 paused, 0 playing.
- Hover and expanded states return the native chevron.
- Error and stopped rows retain native semantic status markers.
- Dark theme and 390px narrow layout preserve contrast and show no horizontal overflow.
- Browser live run synchronized Think, Bash, main status, and sidebar state.

final result: passed

---

# Conversation Auto-naming Model Service Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-389e7726-4e5f-43f1-a305-ac1de5ebc68a.jpg` (`3574 x 2382`).
- Browser implementation: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/conversation-title-model-services.png` (`1766 x 1226`).
- Same-input comparison: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/conversation-title-reference-vs-implementation.png` (`2400 x 800`).
- Compact window captures: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/conversation-title-model-services-640.png` and `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/conversation-title-model-services-420.png`.

The reference and live implementation were normalized onto equal `1200 x 800` canvases and reviewed side by side. The implementation intentionally keeps only the currently delivered service instead of reproducing the reference's speculative service list.

## Comparison history

1. P1 observed in the reference: model utilities are called assistants and presented as a long future-service catalog.
2. P1 fix: the live product uses one native Settings section named `模型服务`, one wide service card named `对话自动命名`, and no assistant terminology.
3. P2 observed: a single generic dropdown would not communicate whether the service can be stopped.
4. P2 fix: the service header owns an explicit switch; disabling it immediately disables the model selector, and enabling it restores the selected route.
5. P2 observed: fixed two-column rows would compress at a narrow window.
6. P2 fix: below `680px`, the model row becomes one column; the `420 x 900` capture keeps the title, switch, label and selector readable without page-level horizontal overflow.

## Verified behavior

- The service switch persisted off and on states; the final state is enabled.
- The model selector persisted an explicit DeepSeek route and then restored `跟随当前对话模型`.
- A real new Session immediately showed the exact 36-character temporary title `请分析当前产品版插件生态的兼容性风险，并给出下一阶段最优先的三个验证任务`.
- The same Session replaced it in the background with `分析插件生态兼容性风险` after about one second.
- The persisted Session log contains one fallback title event and one provider title event bound to the same user-message sequence; no shadow Session or visible title-generation message was created.
- Browser logs contain no application error. The recorded warnings are expected connection retries from the deliberate Runtime restarts used to load the rebuilt plugin.
- Repository verification passed: `94` test files / `446` tests, Build, Type Check, API Snapshot, package-pack, bundle-budget, documentation and framework gates.

## Findings

- P0: none.
- P1: none after replacing the generic service catalog with one real, controllable service.
- P2: none after responsive reflow and real title lifecycle verification.
- P3: the service is a plugin-native Settings section adjacent to `模型`; the upstream Models page has no nested extension slot, so no Harness source modification was introduced.

final result: passed

---

# Settings Extension Center and Scheduler Design QA

## Source visual truth

- Selected style reference: `/Users/hansen/.codex/generated_images/01a05baf-4a20-7701-bab4-2773d9c3c65e/exec-27a520c9-9913-4e31-aea2-765b475d638d.png` (`1571 x 1001`).
- Product correction: remove the bottom `查看更多扩展` action; treat each visible card as a composition pack containing individually identifiable extensions.

## Browser-rendered implementation

- Extension Center: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/08-extension-center-pack-ui.png` (`1597 x 1226`, CSS viewport `1597 x 1226`, device scale factor `2`).
- Pack detail: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/09-extension-center-pack-detail.png` (`1597 x 1226`).
- Scheduler: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/10-scheduler-agenda-ui.png` (`1597 x 1226`).
- Same-input comparison: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/11-reference-vs-implementation.png`.
- Global wide Settings: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/12-settings-global-wide.png` (`1597 x 1226`).
- Global wide same-input comparison: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-audit/13-global-wide-reference-vs-implementation.png`.
- Mobile source captures: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-responsive-audit/mobile-通用设置.png` and `mobile-扩展中心.png` (`480 x 844`, device scale factor `1`).
- Mobile implementation captures: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-responsive-audit/mobile-after-通用设置.png` and `mobile-after-扩展中心.png` (`480 x 844`, device scale factor `1`).
- Responsive same-input comparison: `/Users/hansen/.codex/visualizations/2026/09/01/01a05baf-4a20-7701-bab4-2773d9c3c65e/paimind-settings-responsive-audit/responsive-before-after.png`.

## Comparison history

1. P1 observed: the old Extension Center exposed internal module inventory as a long technical dashboard instead of a product-facing extension surface.
2. P1 fix: replaced it with six compact composition-pack cards and a pack-detail level that identifies the actual extensions inside each pack.
3. P1 observed: Scheduler controls were visually mixed with overview and configuration fields, so recurring work did not scan like an agenda.
4. P1 fix: replaced the dashboard layout with status tabs, grouped time rows and direct run, edit and pause actions.
5. P2 observed: descriptive fields such as entry location, value, steps and stop impact made the settings surface read like documentation.
6. P2 fix: removed those fields and the `查看更多扩展` action. Visible copy now describes only the feature pack, extension count, runtime state and task schedule.
7. P2 observed: only Extension Center and Scheduler owned the wide-dialog rule, so switching to General, Models, Plugins, Personalization or Developer Resources returned to the narrow layout.
8. P2 fix: moved the desktop wide-dialog rule into the reversible PAIMind Visual Experience layer and removed both feature-specific copies.
9. P1 observed: at `480 x 844`, General, Extension Center and Personalization retained the `188px` vertical settings rail, reducing content to roughly `244px`; labels wrapped one character per line and core controls were partially hidden.
10. P1 fix: the shared Visual Experience layer now turns the settings rail into a horizontally scrollable `56px` navigation row below `600px`, expands content to the full dialog width, and keeps each plugin's own card/grid reflow.

## Verified behavior

- Search and four status filters remain available in both settings surfaces.
- Selecting a feature pack opens its extension list; independent switches appear only for extensions with an explicit runtime capability contract.
- Scheduler status filtering was exercised in the live Browser without mutating task data.
- General, Models, Plugins, Extension Center, Scheduler, Personalization and Developer Resources all measured `1480 x 920` in the same `1597 x 1226` viewport.
- At `760 x 900`, all seven pages measured `712 x 800` with zero dialog overflow and no visible-width offenders.
- At `480 x 844`, all seven pages measured `464 x 828`; the navigation measured `464 x 56`, content remained readable and no page produced dialog-level horizontal overflow.
- Browser console reported zero warnings and zero errors for the verified flow.
- Targeted TypeScript checks, `43` component tests and the repository build passed.

## Findings

- P0: none.
- P1: none after restoring pack hierarchy, agenda hierarchy and narrow-screen reflow.
- P2: none after removing documentation-style fields, the extra discovery action and feature-owned shell width duplication.
- P3: the existing Harness settings dialog remains the host surface; PAIMind Visual Experience supplies one reversible desktop width rule without modifying upstream Harness source. Mobile keeps the native responsive width.

final result: passed

---

# Proposal Trace Adaptive Category Hierarchy Design QA

## Source visual truth

- Previous single-category directory: `/tmp/paimind-trace-classification-20260824/01-directory-categories-panel.jpg` (`411 x 1326`).
- Product rule confirmed by the user: a current slide with one evidence category must skip category selection and open its metrics and facts directly; two or more categories keep the category directory.

## Rendered implementation

- Mainline in-app-browser capture: `/tmp/paimind-trace-adaptive-20260825/single-category-full.png` (`1280 x 720`, CSS viewport `1280 x 720`, device scale factor `1`).
- Focused single-category metrics region: `/tmp/paimind-trace-adaptive-20260825/single-category-metrics-panel.png` (`448 x 258`).
- Same-input before/after comparison: `/tmp/paimind-trace-adaptive-20260825/single-category-before-after.png` (`896 x 258`).

The previous panel was cropped to its top `411 x 258` region and normalized to
`448 x 258`; the implementation was cropped from the live mainline Browser at
the same visible Trace state and size. The combined comparison was opened before
this report was written.

## Comparison history

1. P1 observed: a slide with one registered category showed a category card whose only action was to reveal the facts already implied by that slide.
2. P1 fix: the current slide now derives its sole block automatically and renders `Metrics & Facts` immediately, with no category card and no `Back to categories` control.
3. Regression protection: slides with two or more categories still start at `Evidence Categories`, reveal only the selected category's facts, and restore the category directory through the back action.

## Required fidelity surfaces

- Fonts and typography: unchanged Harness typography and metric hierarchy; no new font or optical-weight drift.
- Spacing and layout rhythm: removing the redundant category card moves the first metric group directly under the persistent Trace navigation without introducing an empty context row.
- Colors and visual tokens: existing semantic Light/Dark tokens, borders, active state, and fact-card surfaces are unchanged.
- Image and asset quality: no image, icon, logo, or decorative asset changed; the change is information architecture only.
- Copy and content: single-category pages expose only the real metric labels, fact values, dimensions, and periods. Multi-category pages retain the category labels and descriptions.

## Verified behavior

- Mainline Browser rendered `Metrics & Facts`, `$109.8M`, and `$12.6M` immediately on the one-category QA slide.
- `Evidence Categories` and `Back to categories` were absent in that live state.
- Business and Technical navigation remained disabled until a specific fact was selected.
- Targeted tests passed for single-category direct entry, dense fact expansion, multi-category selection, category back navigation, and category fact isolation.
- The multi-category browser layout is intentionally unchanged from the prior verified category directory; current generated DG decks contain one block per slide, so multi-category runtime behavior is covered by the dedicated component regression test.

## Findings

- P0: none.
- P1: none after removing the redundant single-category hop.
- P2: none; navigation state and responsive styles remain unchanged.
- P3: none.

final result: passed

---

# Proposal Trace Current-slide Classification Design QA

## Source visual truth

- User-reported directory state: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b28a6c28-8b51-4870-b979-756440f7f7f2.png` (`916 x 2674`).
- The source shows a deck-level header, a second directory introduction, a current-slide summary, a five-slide directory, a business block, and fact cards competing inside one narrow Trace inspector.

## Rendered implementation

- Directory categories: `/tmp/paimind-trace-classification-20260824/01-directory-categories-panel.jpg` (`411 x 1326`).
- Selected category metrics: `/tmp/paimind-trace-classification-20260824/02-directory-metrics-panel.jpg` (`411 x 1326`).
- Business Trace: `/tmp/paimind-trace-classification-20260824/03-business-panel.jpg` (`411 x 1326`).
- Technical Trace: `/tmp/paimind-trace-classification-20260824/04-technical-panel.jpg` (`411 x 1326`).
- Four-stage interaction comparison: `/tmp/paimind-trace-classification-20260824/trace-four-stage-contact-sheet.jpg` (`1740 x 1326`).
- Full external-Chrome capture: `/tmp/paimind-trace-classification-20260824/01-directory-categories-full.jpg` (`2768 x 1461`).

The live browser used the mainline `http://localhost:3080/` Harness at a
`2768 x 1461` CSS viewport. The Trace inspector measured `411 x 1326` CSS px;
the screenshot pixels matched the CSS geometry at the captured density.

## Normalization and comparison input

- The source's `84px` deck sliver was cropped away, then the remaining Trace panel was normalized from `832 x 2674` to `411 x 1326`.
- Full-height same-input comparison: `/tmp/paimind-trace-classification-20260824/directory-before-after.jpg` (`822 x 1326`).
- Focused top-region comparison: `/tmp/paimind-trace-classification-20260824/directory-top-before-after.jpg` (`822 x 620`).
- The normalized source and the final Directory implementation were opened together before this report was written.

## Comparison history

1. P1 observed: the source repeated deck identity, generation status, current-slide summary, and all-slide navigation inside the inspector even though the slide rail already owned deck navigation.
2. P1 fix: removed the Trace header, summary card, and five-slide directory. Directory now starts with evidence categories for the currently visible slide only.
3. P1 observed: business blocks and all facts were expanded simultaneously, so a dense slide would become a long undifferentiated list.
4. P1 fix: added a staged hierarchy: current-slide category -> metrics and facts -> Business Trace -> Technical Trace. Business and Technical navigation remain disabled until a fact is selected.
5. P2 observed: `What supports this result?` and `How was this fact produced?` repeated the meaning of their active navigation tabs and delayed the evidence.
6. P2 fix: removed both explanatory headers. Business opens directly on verified value, registered source, definition, method, and scope; Technical opens directly on lineage, calculation, source fields, code, and runtime.
7. Post-fix external-Chrome interaction and visual comparison found no remaining P0, P1, or P2 issue.

## Required fidelity surfaces

- Fonts and typography: the Harness font stack and existing optical weights are preserved. Functional labels, category titles, metric labels, fact values, and evidence fields have distinct hierarchy without adding marketing copy.
- Spacing and layout rhythm: the fixed three-tab navigation is followed by one compact category card or one metric list. Repeated `11–15px` card padding and `7–12px` gaps replace the previous nested long-form stack.
- Colors and visual tokens: all surfaces, borders, text, active states, and buttons continue to resolve from the existing Harness semantic Light/Dark tokens.
- Image and asset quality: no visible product asset was replaced or simulated. The real Playful Storybook Bento slide remains in the workbench; Trace is native UI.
- Copy and content: removed `Live evidence`, the deck title/status/page count, `Evidence map for this deck`, the current-slide overview, `Slide Directory`, and both explanatory question headers. Remaining copy labels actual categories, metrics, facts, sources, calculations, and lineage.

## Verified behavior

- Directory initially exposed one current-slide evidence category and no fact rows.
- Selecting the category exposed four facts grouped under its registered metric; no other slide conclusions were present.
- Selecting `+32.8%` opened Business Trace and focused the corresponding deck evidence.
- `View technical trace` opened lineage and calculation evidence; both removed question headers stayed absent.
- Legacy-copy counts in the live DOM were zero for `Live evidence`, `Evidence map`, `Slide Directory`, `What supports this result?`, and `How was this fact produced?`.
- Trace geometry measured `clientWidth=411`, `scrollWidth=411`, `clientHeight=1326`, and `scrollHeight=1326`; the Technical page measured `clientHeight=1261`, `scrollHeight=1261`.
- The captured live interaction produced zero browser warnings and zero browser errors.

## Findings

- P0: none.
- P1: none after removing deck-level duplication and introducing staged current-slide classification.
- P2: none after removing explanatory headers and verifying all four interaction stages.
- P3: a slide with only one registered category intentionally leaves open space; dense slides use the same grid for multiple categories and defer fact density until selection.

final result: passed

---

# Proposal Trace Readability and Hierarchy Design QA

## Comparison input

- Source visual truth: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-0a8134b8-018b-437c-be7e-d4a94f0dc13d.png` (`5210 x 3084`, Retina capture). The user identified the compressed right Trace panel in this real mainline state as the defect to correct.
- Browser-rendered implementation: `/tmp/paimind-trace-panel-fix-20260824/01-directory-full.jpg` (`2608 x 1461`, external Chrome, CSS viewport `2608 x 1461`, screenshot normalized to `1x`, browser device scale factor `2`).
- Business state: `/tmp/paimind-trace-panel-fix-20260824/02-business-full.jpg` (`2608 x 1461`).
- Technical state: `/tmp/paimind-trace-panel-fix-20260824/03-technical-full.jpg` (`2608 x 1461`).
- Full-view comparison: `/tmp/paimind-trace-panel-fix-20260824/04-full-comparison.jpg` (`5216 x 1461`).
- Focused same-input Trace comparison: `/tmp/paimind-trace-panel-fix-20260824/05-panel-comparison.jpg` (`1118 x 1326`).

The source was downsampled from its Retina capture to the implementation's CSS width, top-cropped to the same `2608 x 1461` state, and then compared beside the browser implementation. The focused comparison uses equal `559 x 1326` Trace-panel crops from the source and implementation.

## Comparison history

1. P1 observed: the Directory intentionally compressed navigation rows to `25px`, fact labels to `7px`, fact values to `8px`, and placed twelve facts into two columns. The panel had enough width, but the hierarchy was illegible.
2. P1 fix: restored `44px` interactive rows, `10px` labels, `11–12px` secondary/body copy, `16–21px` headings, a vertical slide directory, and one-column fact cards at the actual `559px` panel width.
3. P1 observed: Business used `minmax(0,1fr)` to stretch definition cards through the remaining viewport, while Technical compressed rows and hid supporting copy to force everything above the fold.
4. P1 fix: both pages now use content-height cards and let only the content body scroll. The artifact header and Directory/Business/Technical navigation remain fixed.
5. P2 observed: Directory gave all twelve facts equal priority, so the evidence map had no scannable first layer.
6. P2 fix: the initial state now chooses four facts round-robin across business-dimension groups, labels each group, and exposes an explicit `View all 12 facts` / `Show priority facts` interaction.
7. Post-fix external Chrome evidence showed no actionable P0, P1 or P2 issue across Directory, Business and Technical states.

## Required fidelity surfaces

- Fonts and typography: the implementation keeps the native Harness font stack. The visible Trace panel now measures `21px/27px` for the page title, `12px/18px` for field body text, `10px/15px` for field labels, and `11px/15px` for navigation labels.
- Spacing and layout rhythm: the Trace panel remains `559 x 1326` CSS pixels inside the existing three-column workbench. Header (`67px`) and three-page navigation (`65px`) are fixed; the content body owns scrolling. Navigation and fact actions are at least `44px` tall.
- Colors and visual tokens: surfaces, borders, text, success and active states continue to consume Harness theme aliases. The repair strengthens surface separation and spacing without introducing a hard-coded light-only Trace theme.
- Image quality and asset fidelity: this change adds no image assets and leaves the real Bento deck, thumbnails, Paramont branding and artifact rendering untouched.
- Copy and content: all visible Proposal demo copy remains English. Dynamic fact labels, values, sources, formulas, filters and lineage remain sourced from the structured Trace document.

## Verified behavior

- Directory shows four priority facts across `102 · Kids Beauty & Cosmetic Tools` and `410 · Party Favors & Balloons`, then expands to all twelve and collapses again.
- Selecting a priority fact opens Business Trace and focuses the corresponding `$11.10M` deck cell.
- `View technical trace` opens Technical Trace; Back actions and the three fixed page tabs remain functional.
- The content body scrolls independently while the artifact header and three-page navigation retain their viewport positions.
- At `2608 x 1461`, the document has `0px` horizontal overflow. The Trace panel is `559px` wide; responsive one-column rules are applied from the Trace panel's own container, not from the wider Bento workbench.
- External Chrome console contained zero error entries. Informational GenUI output, an upstream LaTeX strict-mode warning from existing transcript content, and two expected connection warnings from the intentional Harness restart remain unrelated to the Trace repair.
- Repository TypeScript typecheck, full build, all `14` presentation-trace tests, and all `371` repository tests passed. The suite retains the known upstream missing `@deepseek-ai/dsh-client-ui-primitives/lib/index.js.map` warning.

## Findings

- P0: none.
- P1: none after restoring readable typography and content-height page layouts.
- P2: none after the responsive one-column directory and progressive fact disclosure.
- P3: Directory intentionally scrolls inside its body when all facts are expanded. This preserves readable cards and fixed navigation instead of recompressing the evidence map.

final result: passed

---

# Proposal Assistant Dark Department Avatars Design QA

## Source visual truth

- Dark Harness palette reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-6213a9ae-8f52-4661-b343-8f451d88479a.png` (`2424 x 752`).
- Department-card reference inside the meeting screenshot: `/tmp/codex-remote-attachments/01a02235-d603-7fa2-99cd-eb6be47193c0/C1850EB8-DF64-4541-B133-B7B006B13316/1-照片-1.jpg` (`590 x 1280`).
- Normalized source card crop: `/tmp/paimind-proposal-dark-departments-20260824/source-dark-card.png` (`1000 x 620`).

## Rendered implementation

- Browser-rendered selected state: `/tmp/paimind-proposal-dark-departments-20260824/department-dark-selected-final-v2.png` (`1864 x 905`, device scale factor `1`).
- Normalized implementation crop: `/tmp/paimind-proposal-dark-departments-20260824/implementation-dark-card-v2.png` (`1000 x 620`).
- Same-input comparison: `/tmp/paimind-proposal-dark-departments-20260824/design-comparison-v2.png` (`2000 x 620`).

The reference crop and implementation crop were normalized to equal `1000 x 620`
regions and reviewed together. The implementation preserves the reference's dark
enterprise decision surface while replacing low-information numbered markers with
real category avatar assets. Department codes remain visible as small metadata so
the business identifier is preserved without becoming the main visual identity.

## Comparison history

1. P1 observed: the live proposal card used a light surface while the selected product direction and earlier Harness reference used a dark enterprise surface.
2. P1 fix: card, header, options, preview panels, controls and selected states now use one dark navy surface hierarchy with restrained blue emphasis.
3. P2 observed: `102`, `140` and `410` occupied the primary visual slot but did not help users distinguish Beauty Care, Stationery and Holiday Events at a glance.
4. P2 fix: generated and installed three category-specific `256 x 256` WebP avatars; each department code moved into a compact `DG ###` metadata pill.
5. P2 observed: the default Deck Type preview focus used nearly the same border emphasis as a confirmed selection, and the narrow action buttons could wrap onto two lines.
6. P2 fix: passive preview focus now uses a quieter surface, while hover, keyboard focus and selected states retain progressively stronger emphasis; navigation and primary actions remain single-line.
7. P2 observed: a real model run enriched option labels with a second em-dash description, which duplicated that description in the visible title and detail.
8. P2 fix: Department presentation parsing now extracts the canonical name for display while preserving the model's exact enriched option label in the native answer returned to the agent.
9. Post-fix browser verification exercised the real AI-driven Customer-to-Department flow and selected 102 plus 410. No actionable P0, P1 or P2 mismatch remained.

## Required fidelity surfaces

- Fonts and typography: the native Harness sans-serif stack, heading hierarchy and compact progress labels are preserved. White primary text and cool-gray secondary text remain legible on the dark card.
- Spacing and layout rhythm: the existing two-column Department grid, `52px` avatar slot, card radius, option padding and action placement are preserved; the identity change does not increase card height.
- Colors and tokens: the live card measured `rgb(16, 25, 37)` with `rgb(238, 243, 249)` text and a restrained `rgba(133, 159, 190, 0.26)` border. Selected rows use blue emphasis without a debug-style hard outline.
- Image quality and asset fidelity: all three avatars decoded successfully at `256 x 256`, use the same navy, steel-blue and champagne-gold art direction, and are rendered as real WebP assets rather than text glyphs, emoji, CSS art or placeholders.
- Copy and content: Beauty Care, Stationery and Holiday Events remain the primary labels. Cosmetics & Cosmetic Tools, Stickers & Creative Crafts and Party Favors & Balloons remain visible descriptions, while exact native answer labels still include 102, 140 and 410.

## Verified behavior

- The model loaded `proposal-assistant-orchestration`, displayed visible Think and Skill activity, asked Customer, consumed Dollar General, and then emitted the native Department question.
- Selecting Beauty Care and Holiday Events produced `aria-checked=true` for their exact model-authored labels; Stationery remained unselected. The renderer also has a regression test for enriched labels such as `102 · Beauty Care — Cosmetics & Cosmetic Tools`, including exact answer preservation.
- The three avatar assets completed with natural size `256 x 256`; no broken-image fallback appeared.
- The live component width was `920px` in an `1864 x 905` external Chrome viewport with device scale factor `1`.
- Document horizontal overflow was `0`.
- Browser logs emitted one informational GenUI compatibility message after the final reload and no new warning or error entries during the accepted flow. The retained tab log still contains expected reconnect warnings and terminal-connection errors from the two intentional isolated Harness restarts performed before that reload.
- Targeted verification passed: `9` proposal-experience tests, package TypeScript typecheck and full repository build.

## Findings

- P0: none.
- P1: none after the dark-surface conversion.
- P2: none after replacing numbered identity blocks with category avatars and demoting codes to metadata.
- P3: the proposal decision card intentionally remains dark when the surrounding Harness shell is light; this is the user-selected branded presentation treatment, not a missing theme fallback.

final result: passed

# Proposal Assistant Slide Rail and Three-page Trace Design QA

## Comparison input

- Slide-rail reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-72fbc608-8df8-498d-afa7-4685b7d04e3d.png` (`119 x 407`).
- Trace-panel reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-98286b5f-dc46-42db-81c7-bcb57fb588c2.png` (`294 x 730`).
- Live implementation: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-trace-directory-uat.png` (`1126 x 866`, device scale factor `1`).
- Business-trace state: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-trace-three-page-uat.png` (`1126 x 866`, device scale factor `1`).
- Same-state rail comparison: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-trace-slide-rail-directory-comparison.png`.
- Trace-panel comparison: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-trace-panel-comparison.png`.

The reference and implementation were reviewed together. The implementation
preserves the reference rail's vertical hierarchy, numbered thumbnails,
selected outline and compact slide count, while replacing static placeholders
with the actual isolated Bento slide source. The old single long trace panel is
replaced by explicit Directory, Business and Technical pages that reuse the
same navy, blue-gray and white enterprise visual system.

## Comparison history

1. P1 observed: all rail thumbnails initially showed slide 1 because the previously generated artifact did not include the new navigation runtime.
2. P1 fix: regenerated the final Bento artifact through the navigation-enabled generator and verified six distinct live slide previews.
3. P1 observed: selecting a fact opened Business Trace, then a same-slide navigation event returned the inspector to Directory.
4. P1 fix: preserved the current drill-down page when the selected slide is unchanged; only a different slide returns to Directory.
5. Post-fix browser QA verified Directory, Business Trace and Technical Trace independently, including both direct fact selection and AI-driven deck selection.

## Findings

- P0: none.
- P1: none after the generated-artifact and same-slide state fixes.
- P2: none; document, workbench and trace inspector each measured zero horizontal overflow at `1126 x 866`.
- P3: the live Paramont thumbnails are visually denser than the light reference thumbnails. This is intentional because each thumbnail is the real deck HTML rather than a decorative image placeholder.

## Required fidelity surfaces

- Typography: consistent with the existing Harness and Paramont Bento system.
- Spacing: `96px` slide rail at the verified viewport, compact slide counter, evenly distributed real thumbnails and one-page trace content.
- Color: navy active state, blue-gray borders and neutral page background retained across all three trace pages.
- Image quality: every rail thumbnail renders the actual isolated slide source at device scale factor `1`; no stretched static assets are used.
- Copy: all user-facing demo copy remains English, with Directory, Business Trace and Technical Trace clearly separated.

## Verified behavior

- The rail shows `Slides 1 / 6` and six distinct, numbered live slide thumbnails.
- Selecting slide 4 updates the main deck, selected thumbnail and Directory state to slide 4.
- Selecting a verified fact opens Business Trace and exposes source, conclusion, method and scope without mixing in implementation lineage.
- `View technical trace` opens Technical Trace with Data Lineage, Calculation Logic and Code & Runtime.
- Back actions move Technical to Business and Business to Directory without rebuilding the generated deck.
- Clicking a traceable block in the deck opens the appropriate Business Trace page through the AI-driven trace contract.
- The live page has zero document, workbench and inspector horizontal overflow.
- A fresh, settled browser session reported zero console warnings and zero console errors.
- The implementation ran only on the isolated `http://127.0.0.1:54047/` Harness runtime; shared port `3080` remained under its existing process.

final result: passed

# Proposal Assistant AI-driven Deck Style Design QA

## Comparison input

- Source visual truth: `packages/proposal-experience/assets/playful-storybook-storyboard.webp` (`1672 x 941`, generated specifically for the horizontal Deck Style preview slot).
- Live Harness implementation: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-style-playful-english-uat.png` (`1920 x 1080`, isolated Harness, English shell, live AI-generated Deck Style question).
- Normalized focused comparison: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-playful-source-vs-implementation.png` (source and implementation normalized to the same `452 x 255` visual slot).
- Additional live states: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-style-paramont-full-uat.png`, `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-style-consulting-full-uat.png`, and `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-style-playful-full-uat.png`.

The live state was produced by the Proposal Assistant after the user confirmed
Dollar General, Merchandising plus Executive Leadership, and Next 12 Months.
The AI recommended Paramont Signature from that context. Playful Storybook was
then selected but deliberately left staged until explicit confirmation.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the three preview systems intentionally use different art direction and density instead of forcing one Paramont retail composition across every option.

## Verified behavior

- Typography, spacing, borders and copy preserve the host conversation hierarchy while giving the active Question Card a clear decision surface.
- Strategy Consulting uses a white, charcoal and cobalt answer-first storyboard; Paramont Signature uses the official Paramont mountain identity with ice-blue brand space; Playful Storybook uses bright cut-paper/gouache family illustration. Their thumbnails, titles, descriptions and full previews remain visibly distinct.
- The focused comparison confirms the Playful Storybook source is preserved without stretching, placeholder art or implementation-time redrawing.
- Selecting a style updates the preview but does not answer the Harness question until `Use this deck style` is pressed.
- `Back to Customer` returned `PAIMIND_PROPOSAL_NAVIGATION:BACK:paimind.proposal.customer/v1` to the Agent. The Agent consumed that Tool Result, invalidated the affected fields and re-issued the canonical Customer question; the renderer did not run a local workflow rewind.
- The Proposal Assistant speaker seat reused the canonical Harness Preset avatar (`project-progress-agent` projection, `ready=true`) and retained the `PA` fallback only when no native image is available.
- The complete flow was driven by real Harness Question Tool Calls. The frontend added no second workflow state, answer store or automatic step progression.
- `1920 x 1080` and `820 x 900` states had zero document horizontal overflow. The narrow state switched to a single-column decision layout and kept the submit action visible.
- The final browser console contained zero Error entries.

## Comparison history

- Pass 1: no P0, P1 or P2 mismatch. The source asset already matched the measured horizontal slot, so no fidelity repair loop was required.

final result: passed — isolated local Harness pre-acceptance; shared-environment Product Acceptance remains pending

---

# Proposal Assistant Rich GenUI Design QA

## Comparison input

- Source visual truth: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b114e855-bbf7-490a-b35d-8ca470de61c0.png` (`2398 x 1996`).
- Browser-rendered implementation: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/.tmp/proposal-visual-qa/deck-style-category-final.png` (`2113 x 1478`).
- Normalized focused source crop: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/.tmp/proposal-visual-qa/reference-component.png` (`1000 x 1000`).
- Normalized focused implementation crop: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/.tmp/proposal-visual-qa/implementation-component.png` (`1000 x 1000`).
- Same-input comparison: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/.tmp/proposal-visual-qa/reference-vs-implementation.png` (`2000 x 1000`).

The reference and implementation were compared in the same Light-theme Deck Style state with Category Growth Strategy selected. The live browser image and component crops were kept at `1x`; only the focused crops were proportionally normalized and top-aligned to a common `1000 x 1000` comparison canvas.

The implementation intentionally uses the native conversation transcript for confirmed prior answers instead of recreating the reference's frontend-owned answer-summary cards. This preserves the accepted runtime boundary: the Agent and Harness Session own workflow context; the plugin renders only the current pending AI question.

## Comparison history

1. Pre-fix: every Deck Style reused the Executive Editorial storyboard and the `210px` preview height made the image secondary.
2. Fix: added distinct `1024 x 1536` Category Intelligence and Assortment Studio storyboard assets, bound each option to its own semantic image and alternative text, widened the desktop component, raised the preview to `330..470px`, and restored the reference's navy / ivory / gold hierarchy.
3. Post-fix: a real Proposal Assistant Session progressed through Customer, Audience and Horizon before the model emitted the Deck Style question. Executive, Category and Assortment selection states each switched title, description, metadata and storyboard while retaining explicit confirmation.
4. Post-fix comparison found no actionable P0, P1 or P2 visual difference in the reusable current-question component.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the live Harness transcript remains visible above the current question and replaces the mock's three completed-answer cards. This is an intentional runtime-ownership decision rather than unresolved visual drift.

## Required fidelity surfaces

- Fonts and typography: native UI sans-serif remains the control and body face; the preview title uses the reference's editorial serif treatment. Heading weights, line height and label tracking preserve the visual hierarchy at the narrower live canvas.
- Spacing and layout rhythm: the card uses the reference's header / progress / two-column workbench structure, larger `22px` radius, stronger section padding, and consistent option gaps. The primary action remains visible without horizontal overflow.
- Colors and visual tokens: navy, warm white, cool slate and restrained gold match the source while continuing to consume Harness label, border and surface tokens where semantic theming matters.
- Image quality and asset fidelity: all three visible storyboards are real WebP raster assets, each sourced at `1024 x 1536`, correctly contained without stretching, placeholder art, CSS drawing or broken-image fallback.
- Copy and content: all user-facing proposal content is English. Labels and descriptions are supplied by the AI tool call; the renderer adds only stable visual guidance and semantic preview metadata.

## Verified behavior

- Agent Center started a native `proposal-assistant` Session; the model, not the frontend, emitted every visible `ask_user_question` call.
- Customer, multi-select Audience and Horizon answers returned through native Tool Results before the model decided to request Deck Style.
- Executive Proposal, Category Growth Strategy and Line Review & Assortment each display a distinct image and preview story.
- Selection stages a choice but does not answer the tool until `Use this deck style` is pressed.
- Keyboard focus and pointer hover use the same preview state path; the package test verifies hover without answering the tool.
- Full repository gate passed: `79` test files / `336` tests, TypeScript build, API snapshot, `34` dry package packs, strict publint, `104` NodeNext public exports, examples, `21` client-plugin framework verification and `92` Markdown documents.
- The only test warning remains the upstream missing `@deepseek-ai/dsh-client-ui-primitives/lib/index.js.map`; it does not fail the suite.

final result: passed

---

# Agent Builder Dual-pane Design QA

## Comparison input

- User reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-8d8c9ecd-87a0-41fd-89ca-89591ae1bce5.png` (`4266 x 2970`; the red annotation identifies the intended form-and-conversation split).
- Live Harness implementation: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-center-dual-pane-delivered-1280x720.png` (`1280 x 720`, live `http://127.0.0.1:3080/`).
- Native-session restoration: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-center-session-restore-1280x720.png`.
- Native Session-tree re-entry: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-authoring-session-click-reopen-1280x720.png` (`1280 x 720`; selected from the normal Harness Session tree after first opening an ordinary Session).

The reference and implementation were reviewed together. The delivered state converts the annotated empty right area into the real Harness conversation while keeping the editable Agent brief on the left; no parallel message renderer, Session store, or shadow Agent identity was added.

## Findings

- P0: none.
- P1: none after the native conversation became visible, interactive, and session-bound in the Builder.
- P2: none after the Builder surface stopped the outer scroll chain and gave the left form its own mouse-wheel scroll region.
- P3: Harness still renders the configuration draft payload in its canonical conversation history; this is intentional runtime ownership rather than duplicated PAIMind chat UI.

## Verified behavior

- At `1280 x 720`, the Builder is a true split surface: left form `x=280..845` (`565px`) and native conversation `x=845..1280` (`435px`). The page has zero horizontal overflow.
- The right pane is the unique native Harness conversation content, marked through the compatibility lease; the PAIMind Builder does not contain another composer.
- The real authoring Session appears immediately in the native Session tree and the connection state reaches `Harness native configuration conversation connected`.
- Selecting an existing canonical `Agent authoring` Session from the native Session tree reopens the same dual-pane Builder and reconstructs the editable brief from real Harness history. Ordinary Sessions do not open Agent Center, and closing the Builder does not loop-open it until the user switches away and selects the authoring Session again.
- A real mouse-wheel gesture changed the left form scroll position from `18` to `538` (`+520px`) without moving or covering the native conversation.
- The native Composer accepted `双屏右侧原生输入联动验收`; closing the Builder restored the prior Session, while `Start conversation` keeps the newly selected Agent Session active.
- Independent authoring Sessions can progress concurrently; duplicate work in the same Session remains guarded.
- Model-proposed Skills are restricted to exact installed Harness Skills, so an uninstalled suggestion no longer aborts the generated brief.
- Browser Console errors: `0`. Targeted Vitest: `2 files / 37 tests` passed. Package TypeScript build, package-only client build, and `git diff --check` passed.

final result: passed

---

# FP-17 PAIMind Visual Experience Design QA

## Comparison input

- Source prototype: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-3ba83237-9a85-4520-b7f4-5ea41e5c9af7.png` (`1611 x 781`, clean PAIMind new-conversation reference).
- Live Harness implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/02-welcome-light-1512x982.png` (`1512 x 982`, System resolving to Light).
- Same-canvas comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-visual-experience-plugin-plan/implementation/reference-implementation-comparison.png` (`2560 x 720`; the source was proportionally normalized and centered on a `1280 x 720` canvas before comparison).
- Dark theme: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/07-welcome-dark-1280x720.png`.
- Native rollback and PAIMind restoration: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/08-native-mode-persisted-after-refresh.png` and `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/09-paimind-restored-after-refresh.png`.
- Workbench density: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/10-workbench-density-better-sidebar.png`.
- Focus density, Task Monitor and real approval: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/18-focus-density-approval-rejection.png`, `19-task-monitor-themed-long-run.png` and `20-real-approval-card.png`.
- Responsive new conversation and picker: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/23-welcome-light-900x720.png`, `04-welcome-light-390x844.png` and `05-agent-picker-bottom-sheet-390x844.png`.
- Source annotation for the sidebar brand and Composer `@` follow-up: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-0fcdd648-6e9e-4e9e-a471-72e0b514be20.png` (`4506 x 2562`).
- Browser-rendered `@` state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/01-composer-at-1280x720.png` (`1280 x 720` CSS viewport and pixels, Light, expanded sidebar) and `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/02-composer-at-390x844.png` (`390 x 844` CSS viewport and pixels, mobile rail).
- Restored expanded brand: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/03-expanded-brand-restored-1280x720.png`.
- Full-view follow-up comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/04-reference-implementation-comparison.png` (`2560 x 720`; the annotated source was proportionally normalized to `1280 x 720` beside the `1280 x 720` implementation).

The prototype and live implementation were compared in the same new-conversation state. The reference image was normalized to the live `1280 x 720` canvas without changing its content hierarchy; the implementation intentionally retains Harness workspace, permission and model controls rather than reproducing prototype mock data.

The follow-up annotation describes a desired interaction region rather than a rendered open-menu target, so a separate pixel-fidelity crop would create false precision. The full-view comparison preserves every annotation, while browser measurements verify the focused Composer and brand geometry directly.

## Iterations

1. Corrected Better Sidebar detection so an empty `data-dsh-sidebar-collapsed` attribute means collapsed rather than open.
2. Made the Agent bridge await the canonical native seat load before reading the roster, preserving the native selector on failure.
3. Replaced trust-based Quick Agent filtering with the native non-broken recommended roster because installed PAIMind official Presets can retain Harness `user` trust provenance.
4. Moved Quick Agents below the main Composer to match the source hierarchy and suppressed them in active conversations.
5. Rechecked the combined reference/implementation image after each layout change.
6. Limited Focus Density to semantically collapsed Think, Tool and Context rows; expanded content, errors and approvals remain full-size.
7. Fixed the `390px` hero selector row so the Agent trigger ends at `372px` instead of overflowing the viewport.
8. Mapped the logical `paimind.visual-experience` namespace to Harness rc.8's native `paimind-visual-experience` key so Native / PAIMind mode survives refresh.
9. Re-anchored the native Harness input overlay above the Composer without replacing its candidate data, draft state, highlight, keyboard behavior or selection route; its height uses measured room above the Composer and restores Quick Agents after dismissal.
10. Added border-box sizing after the first live pass showed the menu's padding extending five pixels past the `866px` viewport; the revised `1280 x 720` and `390 x 844` captures keep the complete menu inside the viewport.
11. Made the expanded Paramont wordmark flex within the native brand seat and verified the mark, official wordmark and `HARNESS` suffix all remain inside the `216 x 24px` host button.
12. Added 96×96 WebP portraits from the frozen prototype and one Paramont brand avatar. The same canonical-Preset resolver now drives `@` Agent candidates, Quick Agents and the visible Preset picker; valid unknown ids receive a deterministic visual projection without creating identity metadata.
13. P2 observed: the first `390 x 844` avatar captures were covered by Better Sidebar, and the first narrow `@` capture exposed native fixed row height that caused name/description overlap. The desktop listbox also allowed the welcome heading to remain visible through the material.
14. P2 fix: closed the right panel before capture, changed narrow candidate rows to auto-height two-row layout with a two-line description clamp, and raised Light/System and Dark listbox backgrounds to solid theme-derived surfaces while retaining blur and shadow.
15. P2 post-fix: `30` proves the unobscured 390px new-conversation Quick Agent and Preset trigger; `31` proves the 390px `@` menu; `32`, `33` and `34` prove System, Light and Dark desktop listbox opacity. All eight visible mobile Agent rows measured `66px`, name-to-description gap `2px`, row/list horizontal overflow `0`, and 96×96 decoded images in 32px circular slots.
16. Release-blocker follow-up: the shared fresh in-app `1280 x 720` matrix found `@` settling with eight Agents and zero Skills, the Settings Native radio not changing its checked or persisted state, and Agent Center managed cards exposing no portrait images.
17. Source-level fix: PAIMind `@ Skill` now delegates candidates and picks to rc.8's resident native `skill` source instead of owning a second `skills.list` Promise cache; the runtime manifest adds the native Skill package as a load-order dependency. The Settings radio owns its complete hit target and the mode controller always reconciles with the committed native Settings snapshot. The avatar presenter consumes Agent Center's semantic `[data-paimind-agent-avatar-seat][data-paimind-agent-id]` contract, defers to any native image, and removes only its own projection on Native or Dispose.
18. Post-fix browser verification is pending because viewport-override tab creation caused the shared in-app Browser control channel to time out and reset for both the owner and Root. Existing `3080` tabs received the new HMR revision, but this infrastructure limitation is not counted as interaction evidence.
19. Post-restart browser verification recovered in fresh in-app tab `14` at `1280 x 720`. The default `Paramont 助手` correctly showed eight Agents and zero Skills because that canonical Preset had no packaged Session Skills. Switching through Quick Agents to `官方技能验证助手` exposed the same `@` listbox with 11 options: eight Agents plus the three native Session Skills `openai-docs`, `skill-creator` and `skill-installer`. Picking `openai-docs` wrote the exact executable draft `/openai-docs `. This verifies native capability-scoped delegation; it does not imply a fixed Skill count for every Agent.
20. Settings rollback passed after the controlled Harness process restart (`PID 72183`). Clicking the real Native radio changed its checked state and `data-paimind-experience` to `native`; Quick Agents, PAIMind avatars, the hero and Composer marker all dropped to zero. Native `@` restored 70 File, Folder and Session reference candidates. Fresh tab `15` persisted Native with every PAIMind surface still absent, and clicking PAIMind restored the experience marker, Quick Agents, avatars, hero and Composer treatment.
21. Agent Center managed-card avatar coverage passed in the same live browser run: My Agents exposed three semantic seats for `agent-center-4e4319`, `genui-163d65` and `my-agent-80ef93`; the resolver projected three distinct assets (`content-expression`, `project-progress`, `technical-expert`), each decoded at its natural `96 x 96` size and reported `ready=true`. Platform Mode cards exposed zero portrait seats and zero injected portrait images, preserving their native mode icons. The post-fix screenshot was visually inspected with no broken image or layout regression.

## Findings

- P0: none after fresh capability-scoped `@` Agent + Skill composition, Settings persistence/rollback and Agent Center managed-card portraits passed in the post-restart browser run.
- P1: none.
- P2: none.
- P3: the implementation keeps a 56px collapsed Harness navigation rail and the canonical workspace / permission / model controls. These are deliberate runtime affordances, not prototype mismatches.
- P3: unknown but valid canonical Presets receive a deterministic portrait from the six-file prototype pool. This is intentionally a visual projection rather than identity metadata; future Harness native avatar metadata has higher priority. Mobile keeps a two-line description clamp instead of removing the explanation.

## Verified behavior

- `1280 x 720` new conversation uses Calm density, has zero document overflow, places Quick Agents 16px below the Composer and shows three current non-broken recommended Presets.
- The desktop Agent picker is grouped into Recommended Agent and Platform Mode, measures `333px` high (below the `360px` limit), updates its explanation on focus and hover, and returns focus to its trigger after Escape.
- Quick Agent selection changed the canonical native Preset to `Paramont 助手`; selecting `极简模式` in the custom picker restored the native staged selection.
- `1512 x 982`, `1280 x 720`, `900 x 720` and `390 x 844` all have zero horizontal overflow. Visible Quick Agents reduce from three to two to one. Mobile uses a bottom-aligned `390 x 483px` Bottom Sheet with a scrim and `22px` top corners.
- Workbench density hides the mountain environment and subtitle, limits Quick Agents to two and does not change the user's Better Sidebar preference. Focus density hides Quick Agents and leaves the collapsed Think row at `24px` while preserving full message content.
- Expanded and compact native navigation both render the Paramont identity; no visible DeepSeek brand remains outside the selected model name.
- Light, Dark and System controls were exercised. System resolved to Light under the current macOS preference; Dark used the optimized dark ridge asset.
- `PAIMind -> Native -> PAIMind` removed and restored the title, theme projection, Quick Agents and custom picker while keeping the settings row. Both Native rollback and restored PAIMind mode persisted after refresh.
- In PAIMind mode the `@` list is anchored above the Composer. At `390 x 844` it occupies `x=83..355`, `y=9..422`; each Agent row is `66px`, retains a clamped two-line explanation and has zero horizontal overflow. The final `1280 x 720` Light/System and Dark captures likewise place the solid theme-derived listbox above the Composer with no welcome-heading bleed-through.
- Post-fix browser result: PAIMind `@` retains the native controller route and scopes `paimind-skill` candidates to the selected canonical Preset's packaged Session Skills. `Paramont 助手` truthfully returned zero Skills; `官方技能验证助手` returned `openai-docs`, `skill-creator` and `skill-installer` alongside eight Agents, and selecting `openai-docs` produced the exact executable draft `/openai-docs `. No fixed Skill count is asserted across Agents.
- Expanded brand geometry is fully visible: mark `x=16..40`, wordmark group `x=48..205.7`, inside the native button `x=16..232`. The follow-up browser console contained zero Error entries.
- Prior FP17 baseline: the earlier follow-up Type Check passed through the direct local TypeScript binary with five focused test files / eight tests. The current Composer/avatar package-local result is recorded separately below; the `pnpm` command wrapper remains blocked by its time-based minimum-release-age policy for the expected Harness rc.8 lockfile entries, not by product code.
- Agent-avatar post-fix evidence: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f49-e994-75f1-ba8d-a00ccf6dd2fb/fp17-composer-audit/30-postfix-avatar-quick-preset-system-390x844.jpg`, `31-postfix-avatar-at-menu-system-390x844.jpg`, `32-postfix-avatar-at-menu-system-1280x720.jpg`, `33-postfix-avatar-at-menu-light-1280x720.jpg`, and `34-postfix-avatar-at-menu-dark-1280x720.jpg`.
- At 390px the document and Composer listbox each had zero horizontal overflow; one Quick Agent, the official Paramont Preset avatar and the `@` Agent portrait set were visible with no broken image or bitmap upscaling. The mobile menu remained inside `x=83..355`, `y=9..422`.
- Post-fix Native rollback: the Settings radio became checked, every PAIMind-only surface and presenter image dropped to zero, and Native `@` restored 70 untouched File/Folder/Session reference candidates. Fresh tab `15` persisted Native; selecting PAIMind restored the experience marker, Quick Agents, avatars, hero and Composer treatment.
- Post-fix Agent Center avatar coverage: three managed-card semantic seats resolved to three distinct 96×96 prototype portraits with `ready=true`; platform Mode cards retained their native mode icons and received no portrait seats or images.
- Current release-blocker package-local gate: 10 package-local files / 40 tests passed; direct local `tsc -b packages/harness-compat/tsconfig.json packages/visual-experience/tsconfig.json` passed; both packages completed isolated esbuild output. Dry pack produced `@paimind/harness-compat` at 89,422 bytes / 22 entries and `@paimind/visual-experience` at 137,690 bytes / 31 entries, including seven 96×96 avatar WebPs totaling 12,908 bytes plus `assets/ASSETS.md`. The `pnpm exec` wrapper remains blocked before test execution by the time-based minimum-release-age policy for the expected rc.8 lockfile entries; the direct installed Vitest runner passed.
- A real out-of-workspace write produced the Harness approval card; rejection restored the conversation without creating the requested Desktop file.
- Final browser log contained zero error entries. The only warnings were expected connection retries from deliberate Harness restarts; GenUI reported its existing informational DOM-channel fallback.
- Final Root-coordinated `pnpm run check:fast` passed: forced Type Check and the single final Root Build passed; full Vitest passed `78` files / `309` tests. Package compliance, all `33` dry packs, strict publint, `101` NodeNext exports, examples, `91` Markdown documents, framework verification and `git diff --check` all passed. The protected API snapshot passed `33` package contracts with SHA-256 `b0afe007e09700ad2bdb7d582aa1d7b9d6c7dba44d53b34a7be76150027b168a`; the shared Build hash is `81dfea4f527e21e30feda5f8b74982325e31f30e8378e031aca9ba37a666179d`. This owner independently reran the read-only API snapshot check after the Ready Signal and received the same protected-baseline pass.
- Exact Harness `0.1.0-rc.8` verification passed Agent Center and Skill Center together, each center independently absent, Native restore and zero upstream source delta. Exact Harness `0.1.0-rc.8` + Better Sidebar `0.12.2` + Office Viewer `0.1.0` composition passed full install/start/remove/restore, independent Visual Experience install/remove and cleanup, Extension Center absence and each key product-plugin absence. The read-only upstream status remains only the pre-existing untracked `ppt-output/` directory.
- Final post-restart `1280 x 720` PAIMind new-conversation check, performed without another viewport override, retained Calm density, the hero, four Quick Agents, four natural `96 x 96` portraits and zero horizontal overflow. The session was returned to `Paramont 助手` with an empty Composer; the earlier `@` Agent/Skill, executable Skill draft, Native persistence/rollback and Agent Center portrait evidence remained valid.

final result: passed — Development Complete after final Root-coordinated shared gates; Product Accepted remains gated by the shared test environment

---

# Agent Center and Skill Center Full-page Design QA

## Comparison input

- Agent Center reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-a6068cd9-4e62-423c-86bc-d148d0652b5f.png`.
- Skill Center reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-fd52808d-21e0-41e7-ac05-6001c7e4b46e.png`.
- Agent Center implementation: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/agent-center-final-1700x850.png`.
- Skill Center implementation: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/skill-center-final-1700x850.png`.
- Same-viewport combined comparison: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/reference-vs-implementation-1700x850.png`.
- Dark theme: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/skill-center-dark-1700x850.png`.
- Narrow single-column layout: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/agent-center-narrow-880x900.png`.

Both references were normalized to the same `1700 x 850` viewport as the live
Harness implementation before comparison. The references define hierarchy,
density and visual language; demo identities, counts, permissions and usage were
intentionally not reproduced.

## Findings

- P0: none.
- P1: none.
- P2: none after fixing surface clipping, collapsed-rail action overflow and the focused-heading outline.
- P3: the implementation keeps the reference's spacious hero, filter hierarchy and card/list-detail rhythm while using only live Harness data and official icons.

## Verified behavior

- Both centers render through `shell.overlay` as body portals and cover the full
  viewport, including Better Sidebar's fixed tool panel.
- Settings contains no Agent Center or Skill Center rows; the native Settings
  surface and Agent Preset advanced configuration remain available.
- Expanded and collapsed sidebar entries both work. Collapsed product actions
  stack vertically inside the native footer rail without horizontal overflow.
- Agent Center search, Platform/My tabs, Builder panel, Escape, mutual switching,
  focus return and real Session start were exercised in the live browser.
- The real personal Agent `官方技能验证助手` created a new native Session,
  selected that Preset and wrote the expected introduction draft.
- Skill Center search, source/status/favorite filters, detail selection and native
  Slash Draft handoff were exercised; `openai-docs` produced `/openai-docs ` in
  the current Harness conversation.
- Light, Dark and System theme controls were exercised. `1700 x 850`, `1024 x 850`
  and `880 x 900` states have zero document horizontal overflow; the `880px`
  state uses one-column cards.
- Browser Console produced zero new warning or error entries after the settled
  final reload. Earlier host-connection retries and one existing Better Sidebar
  `agent-terminals` error occurred while the local server was rebuilding.
- Disposable Harness composition passed with both centers, either center absent,
  both removed, native restoration and zero DeepSeek Harness worktree delta.

final result: passed

---

# Task Monitor Agent Identity Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b26f2a9d-a2f3-49fa-8e96-ab9bd414a702.png` (`1332×1560`, annotated pre-change Task Monitor).
- Implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-icons-hover-1332x1560.png` (`1332×1560`, live Harness with first Subagent tooltip visible).
- Side-by-side comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-reference-vs-implementation.png`.
- Narrow layout: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-560x800.png`.

The reference and implementation were captured at the same pixel dimensions and
the same parent Session with two Subagents. Blue rectangles in the reference are
user annotations, not visual components to reproduce.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the compact `420px` panel intentionally remains denser than the annotated
  reference while preserving the same summary-to-detail hierarchy.

## Verified behavior

- Checklist, Subagent and output summary statistics are icon buttons; clicking
  `2 子代理` focuses the real Subagent group.
- The main Agent has a fixed role icon. Two real Subagents render different
  `browse` and `think` variants from an eight-slot extensible registry.
- Hovering the first avatar shows the exact native name with tooltip opacity `1`.
- Each full row remains clickable and navigates to the correct native child
  Session, where the parent/child breadcrumb is visible.
- Agent, Skill and MCP labels use a consistent library icon language; empty MCP
  evidence stays omitted.
- Desktop and `560×800` states have no document or panel horizontal overflow.
- No Task Monitor Console Error was observed. One existing Better Sidebar
  `agent-terminals` connection error remains outside this plugin's scope.

final result: passed

---

# Task Monitor Agent Resource Group Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-e648292f-0918-44b0-b996-14e0021e356e.png` (`1308×1256`, Retina `2x`; focused source crop `840×1256`, normalized to `420×628`).
- Live desktop implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-v2.png` (`1550×768`, Chrome at the inspected `80%` visual scale).
- Model hover/focus state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-model-tooltip-v2.png`.
- Normalized focused comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-comparison-v2.png` (`840×628`; implementation crop `340×680`, normalized to `420×840` and top-aligned to the source state).
- Narrow Bottom Sheet: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-narrow-v2.png`.

The live state is the same real parent Session with two native Subagents, four
used Skills and no exact used MCP call. Blue rectangles in the source are user
annotations rather than UI components.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the implementation intentionally keeps the existing compact panel rhythm;
  green chips communicate deterministic used state without adding a text suffix.

## Verified behavior

- Typography preserves the host title/body hierarchy; provider and model text is
  removed from the persistent layout and appears only in a compact tooltip.
- Spacing and layout place native child Sessions directly beneath the main Agent
  inside one resource group. The former duplicate child block is absent from
  Task Progress.
- Colors use the existing success token for used Skill and used MCP chips. No
  request-catalog-only MCP row or empty resource placeholder is shown.
- The main Agent keeps the fixed role icon. Subagent rows keep distinct variants
  from the extensible registry, exact-name tooltips and trailing navigation icons.
- Visible copy contains bare Skill names without the redundant `已使用` suffix.
- Clicking `2 子代理` focuses the Agent child group. Keyboard focus on the
  main Agent exposes `aliyun · deepseek-v4-flash-0731`; clicking a child row
  opens the exact native child Session and its parent/child breadcrumb.
- Desktop and the narrow Bottom Sheet both keep content inside the panel with no
  observed horizontal overflow; wrapped Skill chips remain readable.

final result: passed

---

# Bento Toolbar Harmonization Design QA

## Comparison input

- Source visual truth: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-2f93b81b-e0b8-47d5-b823-15f143bf8a7e.png` (1241 x 548, Better Sidebar native HTML Viewer, Light, Preview).
- Rendered implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/bento-toolbar-final.png` (1280 x 720, live Harness at `127.0.0.1:3080`, Light, Preview with Trace hover).
- Focused implementation crop: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/bento-toolbar-focus.png`.
- Side-by-side focused comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/toolbar-comparison.png`.

The comparison uses the host viewer as positional truth: document title first, an independent left-aligned mode toolbar beneath it, and content below the toolbar. Bento intentionally retains its icon-only controls and adds Trace as its third product-specific mode.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: Bento keeps a 40px icon group instead of copying the host's text buttons; this preserves the requested compact visual language while matching the host's information hierarchy.

## Verified behavior

- DOM order is `header -> toolbar -> workbench`; the toolbar is no longer placed at the right side of the title row.
- Live geometry at 1280 x 720: header `y=35..86`, toolbar `y=86..135`, workbench starts at `y=135`; toolbar and title share the same 12px left inset.
- Preview, Edit, and Trace remain icon-only buttons with accessible Chinese labels.
- Hovering Trace exposes only `溯源`; other mode tooltips remain hidden.
- Edit becomes active and shows the editable-copy / locked-fact guidance.
- Trace becomes active and mounts the trace inspector in the same workbench.
- The page has zero horizontal overflow, zero Console Error entries, and the Bento iframe contains zero external `src` / `href` references.
- Repository gates passed with 70 test files / 233 tests; exact Harness 0.1.0-rc.6 + Better Sidebar 0.12.2 + Office Viewer 0.1.0 install, boot, remove and restore composition also passed with zero upstream delta.

final result: passed

---

# Proposal Assistant Four-step Intake Design QA

## Comparison input

- Source visual system: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-style-playful-english-uat.png` (previously accepted Proposal Assistant card, avatar treatment, option list and image-led preview).
- Full-width implementation: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-four-step-deck-type-clean-uat.png` (live isolated Harness, `1440 x 960`).
- Constrained implementation: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-four-step-deck-type-constrained-postfix-uat.png` (right Harness workspace panel expanded).
- Side-by-side comparison: `/private/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/paimind-proposal-user-uat-dsh-home.G0G0w5By/proposal-four-step-source-vs-implementation.png`.

The source and implementation were reviewed together. The comparison preserves
the accepted avatar, editorial typography, pale navy palette, rounded option
cards, left-side selection and right-side preview hierarchy. The structural
differences are intentional: the new flow removes Horizon and Confirm, renames
Audience to Department and introduces a dedicated Deck type application
preview before the image-led Deck style step.

## Iterations

1. Replaced the five-step progress model with Customer, Department, Deck type and Deck style.
2. Added the three meeting-approved Deck type applications and a contextual right-side preview.
3. Retained the three visually distinct style assets: Strategy Consulting, Paramont Signature and Playful Storybook.
4. P2 observed: the initial Deck type preview could be clipped when the Harness workspace panel reduced the available conversation width.
5. P2 fix: added card-owned container responsiveness and rechecked the same live state with the workspace panel expanded.
6. Verified real Agent navigation by returning from Deck type to Department, invalidating the later fields and reissuing the canonical Department question.

## Findings

- P0: none.
- P1: none.
- P2: none after the constrained-layout fix; the live card measured zero section and body horizontal overflow with the workspace panel expanded.
- P3: Deck type uses a text-led application preview while Deck style remains image-led. This is intentional because the two steps communicate different decisions.

## Verified behavior

- The live progress indicator contains exactly four steps: Customer, Department, Deck type and Deck style.
- Horizon and standalone Confirm are absent from the early-stage UI.
- Known Customer and Department context is reused by the Agent, which asks only for the missing Deck type.
- Deck type offers exactly Category Analysis, Internal Kick Off and Line Review Proposal, with one AI-selected recommendation.
- The right-side Deck type preview shows Application, Primary audience and Core story, and updates from the reusable option model.
- Back to Department returned a `PAIMIND_PROPOSAL_NAVIGATION:BACK:` intent to the Agent; the Agent preserved Customer, reset Department and later fields, and rendered Department again.
- Returning the two Department selections to the Agent re-rendered Deck type as Step 3 of 4.
- With the workspace panel expanded, the card body measured `776px` wide with `0px` horizontal overflow; the section also measured `0px` overflow.
- The final style answer is the intake completion action; no separate confirmation step is rendered or requested.
- The live browser remained on the isolated `http://127.0.0.1:54047/` runtime and did not use the shared `3080` service.

final result: passed

---

# Proposal Assistant Live Thumbnails, Trace Polish and Demo Reel Design QA

## Comparison input

- Source problem capture: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-27756e33-ba4a-4ce8-bf75-3f34497f2146.png` (`616 x 674`).
- Same-state implementation capture: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/02-directory-slide-4.png` (`1126 x 866`, CSS viewport `1126 x 866`, device scale factor `1`).
- Normalized side-by-side comparison: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/thumbnail-before-after.png` (`1232 x 714`). The implementation was cropped to the same `616 x 674` workbench region before comparison.
- Business Trace capture: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/03-business-trace.png` (`1126 x 866`).
- Technical Trace capture: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/04-technical-trace.png` (`1126 x 866`).
- Product demo page capture: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/product-demo-page.png` (`1280 x 720`, CSS viewport `1280 x 720`, device scale factor `1`).
- Product demo video: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/proposal-assistant-trace-demo.mp4` (`1280 x 720`, `30 fps`, `14.2 s`).

The source problem and revised implementation were opened together in the
normalized comparison. The source shows each iframe reacting to a thumbnail-
sized viewport and reflowing deck copy into unreadable vertical text. The
revision renders every thumbnail inside a fixed `1280 x 720` desktop canvas and
scales that completed slide into the rail, so the same six real pages remain
visually recognizable.

## Comparison history

1. P1 observed: thumbnail iframes inherited their physical `70px`-class viewport, triggered the Bento responsive layout and collapsed slide copy into unreadable columns.
2. P1 fix: each live thumbnail now owns a measured frame and scales a fixed `1280 x 720` iframe with `ResizeObserver`; navigation and isolated-source behavior remain unchanged.
3. P2 observed: the trace panel was functionally split into three pages but still looked like a dense settings inspector.
4. P2 fix: introduced a stronger Live Evidence header, compact numbered navigation, a current-slide summary card, verified-fact hero, separated evidence cards and a cleaner technical lineage layout.
5. P2 observed: the initial opportunity-action video state exposed a valid but visually weak `Not registered` calculation.
6. P2 fix: the final demo reel uses the traced `$15.2M` sales fact, which visibly demonstrates registered source, `SUM(current_sales_m)`, aggregation and source-field evidence.
7. Post-fix browser comparison and interaction QA found no remaining P0, P1 or P2 issue.

## Required fidelity surfaces

- Fonts and typography: existing Harness UI typography remains in the workbench; the demo page uses the same sans-serif system with a Georgia editorial display face already present in the accepted Paramont visual language.
- Spacing and layout rhythm: rail width increased to `118px`; live thumbnails preserve `16:9`; trace navigation, summary, evidence cards and buttons follow a consistent `6–16px` rhythm with no horizontal overflow.
- Colors and visual tokens: retained Paramont navy, business blue, verified green, white cards and blue-gray borders; no unrelated palette was introduced.
- Image quality and assets: thumbnails use the real isolated Bento HTML at desktop layout, not placeholders or text simulations. The demo page uses the supplied Dollar General mark and the browser-captured product states.
- Copy and content: all demo-facing copy is English. Directory, Business Trace and Technical Trace have distinct questions and evidence depth.

## Verified behavior

- All six thumbnail frames are real Bento pages and remain distinct after the desktop-canvas scaling fix.
- Selecting slide 4 updates its outline, main slide and trace-directory summary.
- Selecting a fact in the main deck opens Business Trace through the runtime selection event.
- Business Trace exposes the verified value, registered source, conclusion definition, formula/method and scope.
- Technical Trace exposes lineage, calculation, aggregation, source fields, join keys and runtime evidence where registered.
- The demo page video reports `readyState=4`, `duration=14.2`, native dimensions approximately `1280 x 720`, and has working live-demo and video-download targets.
- Product demo page horizontal overflow is `0px`; a clean browser pass reported zero warnings and zero errors.
- The live Harness stayed on isolated port `54047`; the standalone demo page stayed on isolated port `55986`; shared port `3080` was not restarted or modified.

## Findings

- P0: none.
- P1: none after the desktop-canvas thumbnail fix.
- P2: none after trace-panel polish and selecting a calculation-complete fact for the reel.
- P3: the main Harness chat remains visible in the video to prove the demo is running in the real product; a future marketing cut could crop it away and add voice-over.

final result: passed

---

# Proposal Assistant Adaptive Trace Theme Design QA

## Comparison input

- User-reported dark-theme problem: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-4730e70b-cc96-42f5-8b42-89dd6de7edf5.png` (`1833 x 920`).
- Updated dark-theme implementation: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-dark-responsive-after.png` (`1280 x 720`).
- Normalized visual comparison: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-theme-responsive-before-after.png` (`2560 x 720`). The problem capture was center-cropped to a `16:9` workbench view and resized to the implementation viewport before comparison.

The problem capture and implementation were reviewed together. The problem
state mixed a hard-coded white trace surface with the dark Harness shell and
allowed the deck viewport to become too short, clipping slide content. The
implementation follows Harness semantic theme tokens and uses the Bento
workbench's measured container width, not the browser viewport, to select its
layout.

## Iterations

1. P1 observed: fixed light surfaces in the Trace panel broke dark-theme continuity across the header, navigation, overview, fact cards and evidence fields.
2. P1 fix: every Trace surface, border, label, active state, success badge and action now resolves from `--dsw-alias-*` semantic tokens with safe fallbacks.
3. P1 observed: viewport media queries never reacted to a narrow right Side Card because the browser itself remained wide.
4. P1 fix: the Bento root is now a named inline-size container; wide panels keep deck and trace side by side, while panels at or below `780px` stack the two complete surfaces in one internally scrollable workbench.
5. P1 observed: the stacked stage inherited a `420px` iframe minimum inside a shorter grid row and clipped the bottom of the `16:9` slide.
6. P1 fix: removed the fixed iframe minimum and assigned two complete `360px` rows in the narrow layout. The workbench scrolls instead of cropping either surface.
7. Directory, Business and Technical pages were re-run in Dark theme; a verified `$15.2M` fact still reverse-focuses the exact Bento object and exposes its registered source, calculation and lineage.

## Verified behavior

- No automatic focus mode or host-sidebar collapse was introduced; the user's existing Harness layout remains under manual control.
- At a live `1280 x 720` viewport, the Bento container measured `732 x 645`; the narrow workbench measured `732 x 545` with `720px` scroll height and deliberate internal scrolling.
- The deck canvas and iframe both measured `636 x 360`; all four cover KPIs, footer and page number remained visible with no slide clipping.
- The stacked trace inspector measured `732 x 360`; Directory, Business and Technical pages remained independently scrollable.
- Document horizontal overflow measured `0px`.
- Dark theme resolved the Trace background to `rgba(29, 40, 59, 0.72)`, raised surfaces to `rgba(20, 29, 45, 0.88)` and primary text to `rgb(237, 243, 251)` from the active Harness semantic tokens.
- Light theme continued to resolve the same component through the light semantic token set.
- Renderer and Trace unit tests passed: `2` files / `9` tests.
- Targeted TypeScript build passed for `@paimind/renderer-bento` and `@paimind/presentation-trace`.
- Repository build passed, and the protected API snapshot passed for `36` package contracts after recording the two intentional client-bundle hashes.
- Live verification used only the isolated `54047` Harness; shared `3080` remained running under its original PID and was not restarted or modified.

## Findings

- P0: none.
- P1: none after semantic-theme and container-responsive fixes.
- P2: none. In a narrow Side Card the deck and Trace surfaces stack and scroll as complete regions; in a wide Side Card they remain side by side.
- P3: the previously generated 14-second video is now obsolete visual evidence and must not be used for product review until a new recording is produced from this corrected Trace state.

final result: passed

---

# Proposal Assistant Single-screen Trace and Shimmer Design QA

## Source visual truth

- Scroll-heavy Business Trace reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-2f0bc9eb-88ad-4cb4-aefe-22a8ef9a1a81.png` (`431 x 744`).
- Codex-style shimmer copy reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-010fbeda-e8cb-4d2a-8ad4-a4ade99bb48e.png` (`305 x 31`).
- The selected-cell problem reference is `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-35f1fbae-e473-46ff-ba29-a1e593300de0.png` (`966 x 487`).

## Rendered implementation

- Directory: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-single-screen-directory-final.png` (`1280 x 720`).
- Business Trace: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-single-screen-business-final.png` (`1280 x 720`).
- Technical Trace: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-single-screen-technical-final.png` (`1280 x 720`).
- Shimmer loading state: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-shimmer-loading-final.png` (`1280 x 720`).
- Sidebar comparison: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-sidebar-before-after-final.png` (`862 x 744`).
- Focused shimmer comparison: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo/proposal-demo-final/demo/trace-shimmer-reference-comparison.png` (`680 x 80`).

The source and implementation were normalized before comparison. The source
sidebar and the implementation inspector were both resized to `431 x 744` for
the full-region comparison. The shimmer references were centered on equal
`340 x 80` canvases. Browser evidence used a `1280 x 720` CSS viewport with
device scale factor `1`, Dark theme, the real isolated Harness session and the
same final traceable Bento artifact.

## Comparison history

1. P1 observed: the original Business Trace used a vertically stacked form with a partially hidden CTA and required scrolling to inspect one result.
2. P1 fix: the sidebar now keeps its header and three-page navigation fixed, combines the verified value with its registered source, uses a two-column evidence grid, and keeps the technical CTA visible in one viewport.
3. P1 observed: the previous `780px` container breakpoint stacked the deck and inspector into two `360px` rows. In the live `732px` Side Card this reduced the trace page to `191px` and produced `800px` of internal overflow.
4. P1 fix: narrow workbenches remain true sidebars with deck and inspector side by side. The verified live workbench is `732 x 545`; the inspector is `322 x 545` and no host surface is hidden.
5. P1 observed after the first compact pass: Directory still exceeded its available page height by `65px`, and Technical Trace exceeded it by `38px`.
6. P1 fix: Directory uses a two-column deck index, one-line business and fact summaries, and a compact current-slide overview. Technical Trace uses a compact lineage row plus two-column calculation and runtime evidence. Both retain all three primary evidence groups.
7. P2 observed: selected facts used a hard, static outline that looked like a debug focus ring and did not communicate that the AI was resolving provenance.
8. P2 fix: selecting a fact now enters a one-shot `Tracing evidence…` state with a Codex-style text shimmer and target glow, then settles into a stable theme-aware selected state. Reduced-motion users skip the animation and receive the final state immediately.

## Required fidelity surfaces

- Fonts and typography: the host font stack is preserved. Labels use small optical weights and tracking, while question and verified-value hierarchy remains readable at `322px` inspector width.
- Spacing and layout rhythm: header, navigation, overview, evidence cards and CTA use a compact `3–12px` rhythm. No Trace page, inspector, workbench or document vertical scrollbar is required at the verified viewport.
- Colors and tokens: all sidebar surfaces continue to resolve from Harness semantic Dark/Light tokens. The shimmer uses the deck's existing ink, accent and accent-secondary variables instead of introducing an unrelated palette.
- Image and asset quality: no visible source asset was replaced. The loading treatment is a native UI state applied to live text and the selected trace target, not a GIF, raster overlay or decorative placeholder.
- Copy and content: `Tracing evidence…` communicates the short-lived provenance lookup. Directory, Business and Technical remain distinct, and Business still foregrounds source file, conclusion, method and scope.

## Verified behavior

- Directory page: `clientHeight=440`, `scrollHeight=440`, `overflow-y=hidden`.
- Business page: `clientHeight=440`, `scrollHeight=440`, `overflow-y=hidden`.
- Technical page: `clientHeight=440`, `scrollHeight=440`, `overflow-y=hidden`.
- Inspector and workbench: `clientHeight=545`, `scrollHeight=545`, `overflow-y=hidden`; document vertical and horizontal overflow are zero.
- At `130ms` after selecting `$15.2M`, the deck reported `Tracing evidence…`, opacity `1`, one pending target and zero selected targets.
- After settlement, the deck reported zero pending targets and one selected target; the AI-driven runtime event opened the matching Business Trace.
- The regenerated artifact remains valid with `resolutionRate=1`, `sourceHashesVerified=true`, `factValuesChanged=false`, and no validation errors.
- Targeted verification passed: `3` test files / `17` tests, TypeScript build, repository build and `36` protected API package contracts.
- Only isolated port `54047` was restarted. Shared port `3080` remained on its original process and was not built, restarted or modified.

## Findings

- P0: none.
- P1: none after the single-screen Directory and Technical compaction.
- P2: none after the one-shot shimmer and stable selection treatment.
- P3: the narrow live deck is intentionally smaller because the user requested a persistent no-scroll Trace sidebar while retaining both the real slide rail and host conversation. No host surface is automatically hidden.

final result: passed
