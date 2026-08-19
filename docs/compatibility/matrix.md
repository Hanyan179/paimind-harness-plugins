# PAIMind Harness Compatibility Matrix

This file is the single selected-version source for local development, package
gates and real release composition. Historical combinations remain in acceptance
evidence, not in a second active matrix.

<!-- compatibility-data:start -->
```json
{
  "schemaVersion": 1,
  "lastVerified": "2026-08-16",
  "officialHarnessDocsCommit": "47f943859bef60e4160492346772ded9b24f765a",
  "runtime": {
    "package": "@deepseek-ai/dsh",
    "version": "0.1.0-rc.6"
  },
  "cordis": [
    { "package": "@deepseek-ai/cordis", "version": "4.0.1", "purpose": "Harness runtime" },
    { "package": "cordis", "version": "4.0.0-rc.8", "purpose": "External provider compatibility" }
  ],
  "providers": [
    { "package": "dsh-better-sidebar", "version": "0.12.2", "owner": "@paimind/better-sidebar-adapter", "adapterContract": 4 },
    { "package": "@huanlin/dsh-plugin-better-sidebar-plugin-office", "version": "0.1.0", "owner": "external", "knownPeerRisk": "declares dsh-better-sidebar ^0.6.0" }
  ],
  "toolchain": {
    "node": "^22.19.0 || >=24.0.0",
    "pnpm": "11.7.0"
  },
  "verification": {
    "fastGate": "passed",
    "releaseComposition": "passed",
    "browser3080": "passed",
    "upstreamDelta": "zero"
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

On 2026-08-16 the selected combination passed `pnpm check`, a disposable real
Harness profile with full install, boot, removal and restoration, isolated
feature-removal probes, live `127.0.0.1:3080` browser checks and upstream source
sentinels. Reproducible details are in
[`../acceptance/baseline-remediation/2026-08-16-final.md`](../acceptance/baseline-remediation/2026-08-16-final.md).
