# Hansen package namespace and configurable branding acceptance

Date: 2026-09-07. Base: `a654487f51812c579919e043a6f198df5a7d93eb`.
Working branch: `codex/hansen-configurable-branding`. These are local pre-release
results, not a publication or an upgrade of an existing installed profile.

## Delivered behavior

- All 40 workspace package identities, internal dependencies, import paths,
  module manifests, composition patches and build tooling use `@hansen/*`.
  The root package is `hansen-harness-plugins`; build metadata is `hansenBuild`.
- `@hansen/branding` owns Settings → Branding, with native persisted fields for
  brand name, main/dark logo, favicon, Chinese welcome and English welcome.
  Default identity is Hansen with generated initials, without a company logo.
- Each field has save/reset, with committed-value readback before success.
  PNG/JPEG/WebP/GIF/ICO uploads persist as image data and do not expose base64
  strings in the form. Invalid image URLs are rejected; broken rendered images
  fall back to initials.
- Visual Experience uses neutral welcome labeling and a neutral Agent fallback.
  The obsolete company-logo avatar asset is removed. Other client screens use
  feature names instead of fixed company branding.

## Compatibility review

Existing data namespaces, Loader entry ids, feature-pack ids, wire identifiers,
Preset ids and exported TypeScript symbol names remain unchanged. Existing
company-named user records and business-specific presentation templates remain
their original data; this change configures the application shell, not the
content of user assets.

The reviewed API baseline change covers the new package scope/build metadata,
new branding `./settings` subpath, required native settings/locale injections,
host settings registration, configurable branding component props and resulting
declarations/runtime artifacts. Existing public package subpaths are retained.
The selected-version compatibility facade now recognizes a hero mark slot that
contains an image or text instead of requiring inline SVG, and no longer labels
all favicons as SVG. The upstream Harness checkout is not edited.

## Automated verification

- `pnpm run check:fast`: passed, 109 test files / 609 tests, types, build, 40
  package identities, 24 client bundle budgets, protected API baseline, 40
  tarball audits, publint, 128 NodeNext public exports, examples, framework and
  documentation checks.
- Native Settings failure recovery, invalid configuration, image upload,
  cross-surface updates, locale changes, dark-logo switching and reversible
  uninstall are covered by the branding/compatibility tests.
- Logs are retained locally in `.tmp/hansen-check-fast.log` and
  `.tmp/hansen-final-focused.log`. They are intentionally excluded from Git.
- The test runner emits an existing upstream warning about the missing
  `dsh-client-ui-primitives/lib/index.js.map`; it does not fail any test.
- The default machine Node wrapper could not load a native test module because
  its code signature used a different Team ID. Verification used the installed
  `/opt/homebrew/opt/node@24/bin/node` (24.20.0), within the selected engine range,
  without changing system signatures or global configuration.

## Browser verification

Actual selected Harness runtime plus the plugin composition, at
`http://127.0.0.1:3081`, using an isolated `.tmp/hansen-branding-home` profile.
The existing port 3080 instance is a separate checkout and was not restarted.

| Journey | Observed result |
| --- | --- |
| Change name to 远山实验室 | Sidebar, mark labels, preview and browser title updated immediately. |
| Upload main and dark test PNGs | Images saved through the real form and loaded at their natural 64px width. |
| Switch native dark/light appearance | Orange dark fixture / teal light fixture switched across brand marks. |
| Change English and Chinese welcome | The current-locale hero showed the saved copy. |
| Refresh and restart the isolated Host | Name, uploaded logo and Chinese welcome persisted and rendered again. |
| Save an executable icon URL | Inline validation rejected it; stored identity remained unchanged. |
| Long bilingual brand name | Sidebar text truncated with an ellipsis; full name remained available in Settings. |
| 390 × 844 viewport | After native layout transition, the Settings panel fit at 374px with no horizontal overflow; fields/actions remained usable. |
| Reset every modified brand field | Default Hansen identity, initials, empty logo fields and default welcome restored. |

Browser DOM snapshots and light/dark/390px screenshots were captured in the task
tool transcript. Temporary viewport changes were reset. The final preview is
left on the Chinese Brand Settings page with default brand values. No model
credential or model-generated response is required for this configuration flow.

## Real composition verification

The initial isolated install/boot/remove/restore and independent-feature
composition checks passed. One later verification overlapped a rebuilding
workspace and failed to load temporarily absent `lib` files; that run is not
counted as a product regression or a successful acceptance run. The final
composition check ran only after the completed fast gate and passed with exit
code 0: full install/boot/remove/restore, independent Visual Experience and
feature-isolation compositions, and zero upstream checkout delta. Its result is
recorded in `.tmp/hansen-composition-verified.log`.
