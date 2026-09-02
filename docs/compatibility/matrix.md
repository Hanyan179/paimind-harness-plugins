# PAIMind Harness Compatibility Matrix

This file is the single selected-version source for local development, package
gates and real release composition. Historical combinations remain in acceptance
evidence, not in a second active matrix.

<!-- compatibility-data:start -->
```json
{
  "schemaVersion": 1,
  "lastVerified": "2026-09-02",
  "officialHarnessDocsCommit": "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
  "runtime": {
    "package": "@deepseek-ai/dsh",
    "version": "0.1.1-rc.2"
  },
  "cordis": [
    { "package": "@deepseek-ai/cordis", "version": "4.0.1", "purpose": "Harness runtime" },
    { "package": "cordis", "version": "4.0.0-rc.8", "purpose": "External provider compatibility" }
  ],
  "providers": [
    { "package": "dsh-better-sidebar", "version": "0.17.1", "owner": "@paimind/better-sidebar-adapter", "adapterContract": 4 },
    { "package": "@huanlin/dsh-plugin-better-sidebar-plugin-office", "version": "0.1.2", "owner": "external", "knownPeerRisk": "declares stale optional peers for dsh-client-runtime and dsh-better-sidebar" }
  ],
  "toolchain": {
    "node": "^22.22.2 || ^24.15.0 || >=26.0.0",
    "pnpm": "11.7.0"
  },
  "verification": {
    "fastGate": "passed",
    "freshInstallAgeGate": "passed",
    "releaseComposition": "passed",
    "browser3080": "passed-with-upstream-warning",
    "upstreamDelta": "passed"
  }
}
```
<!-- compatibility-data:end -->

## Promotion rule

A new runtime or provider version starts as a candidate. It becomes selected
only after metadata, adapter contract, package gates, real isolated profile,
install/boot/remove/restore, browser regression and upstream-sentinel checks all
pass. The bundle uses exact provider versions; feature packages do not encode
provider versions.

The Office Viewer package currently declares a stale Better Sidebar peer range.
The exact selected combination is retained because it passed real composition;
the metadata mismatch remains a release risk and must be retested on either
provider upgrade.

## Current verification

On 2026-08-27 the selected combination passed the full functional gate, the
persistent 24-hour package-age policy, a disposable real Harness profile with
full install/boot/remove/restore, all required missing-dependency probes,
browser checks at `127.0.0.1:3080`, five-format Artifact viewing and upstream
source sentinels. The live browser retains provider-owned Better Sidebar
WebSocket reconnect errors, an Office Viewer narrow-layout error and an official
Harness cleanup error after leaving a workbook tab. They do not prevent the
verified navigation or viewing flows, but the console is not clean enough for
final Product Acceptance. Current promotion and exception details are in
[`../acceptance/R10-harness-0.1.1-rc.2.md`](../acceptance/R10-harness-0.1.1-rc.2.md).

The rc.2 compatibility boundary includes its current Session Projection shape:
`stateSchema` for persisted state and `wire.viewSchema`/`wire.view` for the
client-visible projection. The live Bento regression check must assert the
isolated `data-paimind-bento` workbench and an enabled Trace action; merely
opening the `.html` bytes through Better Sidebar is not sufficient evidence.
Edit and Trace are mutually exclusive modes: only the current object selection
may cross the boundary. Edit must never render `trace-pending`,
`Tracing evidence…` or the Trace inspector; switching away from Trace cancels
pending trace feedback while preserving the selected object. The renderer
applies this contract read-only to legacy Bento documents, while newly generated
documents declare `data-paimind-mode-contract="exclusive-selection-v1"`.
Preview is a standalone slideshow surface: it obtains page identity and titles
from the Bento runtime's `paimind:bento-manifest`, hides the thumbnail rail and
all selection/trace feedback, and renders Previous, position and Next controls.
It must not depend on the Trace inspector being activated. Edit and Trace may
use the thumbnail rail as a workbench navigation aid.
