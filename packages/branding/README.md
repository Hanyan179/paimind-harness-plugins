# `@hansen/branding`

Configurable brand identity for the native Harness shell.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns brand-name and logo slots, the document title,
favicon/manifest, welcome copy and Settings → Branding. The host registers one
durable native Settings namespace, `hansen-branding`. Harness owns persistence;
Visual Experience owns theme and layout.

| Setting | Default | Behavior |
| --- | --- | --- |
| Brand name (`brandName`) | Hansen | Sidebar, accessible labels, tab title and app manifest; up to 80 characters. |
| Logo (`logoUrl`) | Empty | Image URL or uploaded image; empty/broken images use name initials. |
| Dark logo (`darkLogoUrl`) | Empty | Uses the main logo when omitted. |
| Browser icon (`faviconUrl`) | Empty | Uses the main logo, then generated initials when omitted. |
| Welcome (`welcomeZh`, `welcomeEn`) | 从一个想法开始 / Start with an idea | Locale-specific welcome copy; up to 160 characters, empty allowed. |

Save or reset each field independently. Changes apply immediately and survive
refresh/restart. Uploads accept PNG/JPEG/WebP/GIF/ICO up to 250 KB and store image
data in native Settings; no upload server or temporary blob URL is needed.
HTTP(S) and same-origin image paths also work. Configuration applies to the
current Harness profile; its existing access controls determine who can write.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./settings` | `./lib/types/settings.d.ts`, `./lib/settings.js` | Defaults, decoder, image validation and typed brand fields. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@hansen/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`), `react-dom` (`>=18.0.0 <20.0.0`).
- Client services: native slots, locale and Settings Scope. The manifest lists their selected upstream module dependencies. Host activation waits for native Settings through the compatibility facade.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared
injected services. Unload removes the Settings page, subscriptions, styles,
brand slots and hero markers, and restores the native title/favicon/manifest.
Persisted settings remain for reinstall recovery. Unavailable or process-local
Settings are read-only; failed writes never count as saved changes. Invalid
stored values fall back to defaults. Logos render as images, never inline HTML.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/branding/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/branding/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
