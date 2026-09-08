# Hansen package namespace and configurable branding

## Requested outcome

Use `@hansen/*` for workspace package identities. Let users set the shell brand
name, light/dark logo, browser icon and Chinese/English welcome copy in native
Settings, with a neutral Hansen default and immediate persisted updates.

## Ownership and conflict review

| Dimension | Decision |
| --- | --- |
| Product surface | Enhance the existing branding plugin; it owns brand slots, document identity and one Brand Settings section. Visual Experience continues to own theme and layout. |
| Domain entity | One brand identity for the current Harness installation/profile; no tenant or enterprise model is added. |
| Writable state | Branding alone registers and writes `hansen.branding` in native Harness Settings. No browser storage or duplicate registry. |
| Runtime service | Native Settings remains the persistence owner. Branding uses its existing compatibility adapter and scoped client subscriptions. |
| Harness compatibility | Native DOM seat discovery and document-title/icon replacement remain in harness-compat. |
| Failure and unload | Invalid/broken logo inputs fall back to initials; failed writes show errors. Unload restores native title, icons and hero, and removes contributed slots/styles. Saved settings remain for reinstall. |

## Namespace migration boundary

Package manifests, imports, dependencies, bundle module references, build/test
tools, current package registration and documentation use `@hansen/*`. Existing
data namespaces, Loader entry ids, feature-pack ids, protocol identifiers and
exported TypeScript symbol names are retained so existing stored records and
consumer contracts remain readable. This is not a blanket text replacement of
all persisted `paimind` strings. Existing installed profiles must replace their
package/module references together before booting the new bundle; do not load
both scopes simultaneously. Historical acceptance reports retain their original
package names and do not prove acceptance of this revision.

## Verification scope

Run package and dependency gates, types, tests, build, reviewed API baseline,
pack/public-consumer checks, real isolated Harness install/boot/remove/restore,
and browser checks covering custom branding, refresh, dark/light appearance,
narrow layout, failure handling and restoring defaults.
