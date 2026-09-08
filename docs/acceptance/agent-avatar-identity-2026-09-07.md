# Agent portrait and conversation identity acceptance

Implemented in the existing Agent Market, Task Monitor, Visual Experience and
Harness Compat packages. The original full local Harness web profile remains on
`http://127.0.0.1:3080/`; no upstream source changes or new persistent registry.

## Result

- Active conversations show a compact portrait and readable Agent name in the
  existing Task Monitor header contribution; clicking it opens the summary.
- The header and summary use the native Session's preset id and the source-owned
  Agent Profile's chosen avatar. A late response from another Session is ignored.
- Eighteen selectable portraits, including twelve generated fictional characters.
  The picker scrolls within a bounded height. Existing automatic assignments use
  the unchanged original six-portrait pool.
- Agent Market publishes the same transient avatar projection while its Center
  is closed. Compat shares this projection across independently bundled clients
  in the current document. Source unload removes the contribution. Failed images
  reveal the native icon without a repeated image-request loop.

## Browser evidence

Evidence directory (outside Git):
`/Users/hansen/.codex/visualizations/2026/09/07/01a079c7-204f-7d50-8b82-a65499caeda5/agent-avatars/`.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Original writer history, without opening Agent Center | Header and summary both identify `0907-21fcf6` as 飞书写作助手 0907, with loaded `content-expression-agent` portrait | `final-writer-header-summary.png` |
| Another historical Session | Name changes to Proposal Assistant and portrait to `project-progress-agent` | `historical-agent-switch.png` |
| Expanded picker | 18 buttons and 18 successfully loaded images; 研究伙伴 selectable | `avatar-picker-18.png` |
| Save and reload | 通用连接验收助手 0907 saved `research-partner`; card image loads at 128px and editor still marks it selected after reload | `avatar-saved-after-reload.png` |
| Leave Center and start native conversation | Native preset picker shows 通用连接验收助手 0907 with `research-partner` after the Center closes | `new-chat-avatar-after-center-close.png` |
| Narrow viewport | At 720×800, document width remains 720px and identity button stays inside viewport; long name truncates | `writer-header-720.png` |
| Disable/re-enable Visual Experience | Basic mode has zero owned portrait images and zero ready seats, with native icon and Agent name retained; standard mode restores loaded portrait | `native-fallback.png`, final screenshot |

The temporary avatar change on the existing connection acceptance Agent was
restored through the UI to `standard` / `technical-expert-agent` and read back.
The writer's chosen avatar, skills and tool connections were not changed. No
business document write or model turn was needed for this presentation check.
The user's writer history is left open with the summary visible.

## Engineering checks

- Full suite: **126 files, 687 tests passed**.
- Type check, production build, package compliance, bundle budget, API snapshot,
  package packing, publint, NodeNext consumer, examples, framework and docs passed.
- Real Harness composition passed full install/boot/remove/restore, independent
  Visual Experience install/remove and optional feature absence checks, with zero
  upstream worktree delta. Matrix versions: Harness 0.1.1-rc.2, Better Sidebar
  0.17.1, Office Viewer 0.1.2.
- New regression coverage: independent Compat module copies share and revoke the
  same avatar projection; closed Center retains it until unload; exact preset id
  mapping; stale Session reads; reused portrait seats and image failure fallback.
- Reviewed API baseline changes are implementation hashes for the four affected
  packages, the additive optional resource `avatars` map and optional
  `onProfilesLoaded` presentation callback, and private presenter state. No
  manifest/export removal, runtime invocation API or ownership change.
- Existing upstream missing source-map warning remains non-fatal in Vitest.

Log files are copied into the evidence directory. Image assets and exact prompts
are recorded in [avatar provenance](../../packages/visual-experience/assets/ASSETS.md)
and [generation manifest](../../packages/visual-experience/assets/generated-avatars-2026-09-07.json).
