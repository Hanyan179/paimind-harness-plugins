# Paramont Harness Branding Acceptance

## Scope

`@paimind/branding` changes only the visible product identity. Harness remains the runtime shell and continues to own Theme, Sidebar layout, Session navigation, Settings, and conversation behavior.

## Surfaces

- Expanded Sidebar: the official Paramont mountain geometry and original `PARAMONT` vector wordmark, followed by the `HARNESS` product suffix.
- New-session Hero: the native whale and `探索未至之境` / `Into the Unknown` headline are reversibly replaced by the official Paramont mountain and `共攀高山之巅` / `Reach New Heights`; Harness retains ownership of the Preview badge.
- Agent Preset: the local development Profile keeps the stable `paimind` preset id while its visible name is `Paramont 助手`.
- Collapsed Sidebar: the official Paramont mountain/snow-line geometry in a compact monochrome treatment.
- Browser title: live Session prefix plus `Paramont Harness` suffix.
- Browser favicon and installable-app manifest: Paramont identity.
- Extension Center: one Experience capability with the App shell surface.

## Acceptance

1. Open `http://127.0.0.1:3080/`.
2. Confirm the expanded Sidebar shows `PARAMONT HARNESS` while existing theme colors remain unchanged.
3. Open a blank new Session and confirm the Hero shows the official mountain, `共攀高山之巅`, and the native `预览版` badge.
4. Confirm the Hero Agent Preset chip reads `Paramont 助手`.
5. Collapse the Sidebar and confirm only the compact Paramont mark is visible.
6. Open a Session and confirm its title remains intact while the browser product suffix reads `Paramont Harness`.
7. Switch Light/Dark Theme and confirm the mark inherits the native foreground color rather than applying a PAIMind theme.
8. Disable or uninstall `@paimind/branding`; the native Harness logo, Hero, title suffix, favicon, and manifest must return.

## Failure isolation

If the RC6 brand seat cannot be located, the native artwork stays visible. The plugin never replaces the Sidebar owner and cannot block native conversation rendering.

## Verified evidence — 2026-08-15

- `pnpm run check`: 62 test files and 191 tests passed; typecheck, production client build and framework boundaries passed.
- Real composition: Harness `0.1.0-rc.6`, Better Sidebar `0.12.1` and Office Viewer `0.1.0` passed full install/boot/remove/restore plus independent-feature isolation.
- Browser at `http://127.0.0.1:3080/`: collapsed mark measured `24 × 24`; expanded wordmark measured `182 × 24`; the native artwork was hidden only while the plugin portal was present.
- Browser title preserved `验证Skill定义精确验证句` and rendered the product suffix as `Paramont Harness`.
- Favicon was an SVG data resource and the manifest decoded to `name: Paramont Harness`, `short_name: Paramont`.
- The inspected dark-theme DOM retained the native theme owner; branding introduced one scoped style and no theme selector or theme state mutation.

## Correction — 2026-08-15

The first browser delivery incorrectly used a newly drawn generic mountain. It was rejected and removed. The accepted implementation must reuse the official `paramont-group.svg` mountain coordinates and the eight original `PARAMONT` vector letter paths; only the `HARNESS` suffix is newly typeset.

The new-session Hero correction passed the focused compatibility and client suites (`2` files, `4` tests), including live Chinese-to-English copy switching. The real Harness page reported a `42 × 34` official mountain seat, hid exactly the two native whale/headline nodes, preserved the native Preview badge, and exposed `Paramont 助手` from the native Preset object.

The subsequent Goal A completion audit passed the current full gate: `64` test
files / `194` tests, Type Check, Production Build, `20` client plugins,
framework boundaries and exact selected-runtime composition.
