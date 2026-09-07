# Compact resource navigation

Approved scope: replace the growing sidebar entry list with an Agent shortcut,
one optional pinned resource, a searchable resource library, and one utility row.
Retain the current theme and each existing product page.

## Ownership and conflict review

| Boundary | Decision |
| --- | --- |
| Product surface | Visual Experience owns the compact sidebar presentation and library popover. Source plugins keep their original native footer contributions and page controllers. |
| Domain entities | No Agent, Skill, connection or template is copied or changed. Navigation projects only live source buttons and activates their existing actions. |
| Writable state | Visual Experience owns one browser-local optional shortcut preference. It contains only a surface id, never domain configuration. |
| Runtime service | No runtime service, registry or invocation API is added. |
| Compatibility | Harness Compat alone resolves native footer/settings anchors and applies reversible layout markers. |
| Failure and unload | Unmounting the presentation restores original source controls and native layout. Removing a source removes its discovery entry; unknown source ids remain discoverable through metadata. |

## Acceptance

- Default three rows; at most four with an optional shortcut.
- Search, grouped discovery, source-page navigation, current-page indication,
  shortcut replacement/removal and keyboard dismissal work.
- Existing notification state and native Settings remain owned by their source.
- Collapsed sidebar and constrained viewport remain usable.
- Targeted lifecycle/navigation tests, typecheck, build, package gates, real
  Harness composition and browser evidence; no upstream source changes.
