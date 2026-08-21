# PAIMind Harness Compatibility Matrix

This file is the single selected-version source for local development, package
gates and real release composition. Historical combinations remain in acceptance
evidence, not in a second active matrix.

<!-- compatibility-data:start -->
```json
{
  "schemaVersion": 1,
  "lastVerified": "2026-08-21",
  "officialHarnessDocsCommit": "141eb6fef83422698aef7a981029e843e8161534",
  "runtime": {
    "package": "@deepseek-ai/dsh",
    "version": "0.1.0-rc.8"
  },
  "cordis": [
    { "package": "@deepseek-ai/cordis", "version": "4.0.1", "purpose": "Harness runtime" },
    { "package": "cordis", "version": "4.0.0-rc.8", "purpose": "External provider compatibility" }
  ],
  "providers": [
    { "package": "dsh-better-sidebar", "version": "0.14.0", "owner": "@paimind/better-sidebar-adapter", "adapterContract": 4 },
    { "package": "@huanlin/dsh-plugin-better-sidebar-plugin-office", "version": "0.1.0", "owner": "external", "knownPeerRisk": "declares dsh-better-sidebar ^0.6.0" }
  ],
  "toolchain": {
    "node": "^22.19.0 || >=24.0.0",
    "pnpm": "11.7.0"
  },
  "verification": {
    "fastGate": "passed",
    "freshInstallAgeGate": "pending-24h",
    "releaseComposition": "pending-provider-upgrade-gate",
    "browser3080": "pending-user-verification",
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

On 2026-08-20 the selected combination passed the full functional gate under a
one-shot release-age override, a disposable real Harness profile with full
install, boot, removal and restoration, isolated feature-removal probes, live
`127.0.0.1:3080` browser checks and upstream source sentinels. The persistent
24-hour package-age policy is restored and intentionally time-gates a fresh
install until the new rc.8 package set ages through that window. Reproducible
details are in
[`../acceptance/R9-harness-0.1.0-rc.8.md`](../acceptance/R9-harness-0.1.0-rc.8.md).
