# Morphing resource navigation preview

Reference: https://x.com/renzobianchi_/status/2097400239162351924

Approved scope: evolve the existing resource navigation into a compact capsule with expanding labels and a connected resource/search panel. Use existing product icons, colors, source actions and pins. Preview on an isolated Harness home and port; main and 3080 remain the baseline.

## Ownership and conflict review

| Dimension | Decision |
| --- | --- |
| Product surface | Visual Experience retains its existing sidebar.footer.action contribution and resource dialog. |
| Domain entity | Read existing navigation contributions; source plugins retain entity and action ownership. |
| Writable state | Retain the existing single optional pin preference. Open, search and hover state are ephemeral. |
| Runtime service | No new runtime service or package. |
| Harness compatibility | Reuse harness-compat navigation bridge; no new host DOM selectors in the feature. |
| Failure and unload | Existing boundary and effect disposal restore native source buttons and remove styles/listeners. |

## Acceptance

Real source navigation, search and no results, pin replacement, Escape and focus return, rapid open/close, keyboard focus, narrow sidebar and 390px viewport, motion preference, uninstall/restore. No notification-domain changes in this slice.

## Reviewed implementation and validation

The one changed runtime snapshot hash is the rebuilt Visual Experience client bundle. The snapshot generator hashes full exported JavaScript content, including client implementation; manifest/export metadata, generated declarations, export counts and bundle patch hashes remain identical. The client-content hash was refreshed only after this comparison, with no public signature change.

Validation records: project-root `design-qa.md`; local `.tmp/morph-tests.log`, `.tmp/morph-fast.log`, `.tmp/morph-retest.log`, `.tmp/morph-build.log`, `.tmp/morph-gates.log`.

The full suite initially passed 772 of 773 tests with one existing Skill installer large-directory test timing out at five seconds. Retesting that file and navigation at two workers passed 36/36, including the new rapid-reopen test. No unrelated test or timeout setting was modified.
