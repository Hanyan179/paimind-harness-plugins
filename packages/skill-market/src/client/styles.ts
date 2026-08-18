export const SKILL_CENTER_STYLE = `
[data-paimind-skill-trigger]{box-sizing:border-box;width:calc(100% + 8px);min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px;display:flex;align-items:center;gap:8px;border:0;border-radius:12px;color:var(--dsw-alias-label-primary,#202124);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-skill-trigger]:hover,[data-paimind-skill-trigger]:focus-visible,[data-paimind-skill-trigger][aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
[data-paimind-skill-trigger][data-wide='false']{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
[data-paimind-skill-trigger][data-wide='false']:first-child{margin-top:0}
div:has(> div > button[data-paimind-product-trigger][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important;align-items:stretch!important;gap:2px!important}
div:has(> div > button[data-paimind-product-trigger][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important;align-items:center!important;gap:2px!important}
[data-paimind-skill-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-product-surface]{position:fixed;inset:0;z-index:80;display:grid;grid-template-rows:64px minmax(0,1fr);pointer-events:auto;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-base,#f4f7fb);font:inherit}
[data-paimind-product-surface] *{box-sizing:border-box}
[data-paimind-product-initial-focus]:focus{outline:none}
[data-paimind-product-bar]{display:flex;align-items:center;gap:18px;min-width:0;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.15));background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-product-brand]{display:flex;align-items:center;gap:9px;min-width:0;font-size:12px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
[data-paimind-product-brand-icon]{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:#fff;background:var(--dsw-alias-state-business-primary,#3471f5)}
[data-paimind-product-switcher]{display:flex;align-items:center;gap:4px;margin-left:18px;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07))}
[data-paimind-product-switch]{min-height:34px;padding:6px 12px;display:inline-flex;align-items:center;gap:7px;border:0;border-radius:9px;color:var(--dsw-alias-label-secondary,#65718a);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-product-switch][aria-current='page']{color:var(--dsw-alias-state-business-primary,#3471f5);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 3px rgba(31,49,79,.08)}
[data-paimind-product-switch]:disabled{opacity:.42;cursor:not-allowed}
[data-paimind-product-bar-actions]{display:flex;align-items:center;gap:8px;margin-left:auto}
[data-paimind-product-return],[data-paimind-product-close]{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.2));color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;cursor:pointer}
[data-paimind-product-return]{min-height:36px;padding:7px 12px;border-radius:10px;font-size:12px}
[data-paimind-product-close]{width:36px;height:36px;padding:0;border-radius:50%}
[data-paimind-product-return]:hover,[data-paimind-product-close]:hover{color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09))}
[data-paimind-product-body]{min-height:0;overflow:auto;padding:34px clamp(24px,4vw,68px) 64px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 3%,var(--dsw-alias-bg-base,#f4f7fb))}
[data-paimind-skill-market]{width:min(1540px,100%);min-height:100%;margin:0 auto;color:inherit}
[data-paimind-skill-hero]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;padding:38px clamp(28px,4vw,52px);border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:28px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv1,0 14px 44px rgba(39,63,102,.06))}
[data-paimind-skill-eyebrow]{display:flex;align-items:center;gap:8px;margin:0 0 11px;color:#0f365f;font-size:12px;font-weight:760;letter-spacing:.18em;text-transform:uppercase}
[data-paimind-skill-hero] h1{margin:0;font-size:clamp(40px,4.4vw,62px);line-height:1;letter-spacing:-.05em;font-weight:780}
[data-paimind-skill-intro]{margin:16px 0 0;max-width:800px;color:var(--dsw-alias-label-secondary,#65718a);font-size:14px;line-height:23px}
[data-paimind-skill-head-actions]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
[data-paimind-skill-button],[data-paimind-skill-tab],[data-paimind-skill-filter],[data-paimind-skill-scope-button]{min-height:38px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:11px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-skill-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 8px 20px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 20%,transparent)}
[data-paimind-skill-button][data-danger='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-skill-button]:disabled{opacity:.46;cursor:not-allowed;box-shadow:none}
[data-paimind-skill-workspace]{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px;align-items:start;margin-top:24px}
[data-paimind-skill-scope]{position:sticky;top:0;padding:18px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:20px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-skill-scope-title]{margin:0 0 12px;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
[data-paimind-skill-scope-list]{display:grid;gap:6px}
[data-paimind-skill-scope-button]{width:100%;justify-content:flex-start;border-color:transparent;background:transparent;font-size:12px}
[data-paimind-skill-scope-button][aria-pressed='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 9%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-scope-count]{min-width:22px;margin-left:auto;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);font-size:10px;text-align:center}
[data-paimind-skill-catalog]{min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:20px;background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden}
[data-paimind-skill-toolbar]{display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:12px;align-items:center;padding:16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13))}
[data-paimind-skill-search-wrap]{position:relative;display:flex;align-items:center}
[data-paimind-skill-search-icon]{position:absolute;left:15px;color:var(--dsw-alias-label-tertiary,#8290a8);pointer-events:none}
[data-paimind-skill-toolbar] input[type='search']{width:100%;min-height:46px;padding:10px 13px 10px 43px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:14px;color:inherit;background:var(--dsw-alias-bg-base,#f7f9fc);font:inherit;outline:none}
[data-paimind-skill-toolbar] input[type='search']:focus{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 12%,transparent)}
[data-paimind-skill-tabs],[data-paimind-skill-filters],[data-paimind-skill-actions]{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
[data-paimind-skill-tabs]{padding:7px;border-radius:14px;background:var(--dsw-alias-bg-base,#f7f9fc)}
[data-paimind-skill-tab]{border-color:transparent;background:transparent;font-weight:650}
[data-paimind-skill-tab][aria-selected='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 2px 7px rgba(39,63,102,.07)}
[data-paimind-skill-filterbar]{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13));background:color-mix(in srgb,var(--dsw-alias-bg-base,#f7f9fc) 72%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-filters]{min-width:0}
[data-paimind-skill-select-filter]{min-height:38px;padding:7px 32px 7px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.2));border-radius:10px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:11px}
[data-paimind-skill-filter][aria-pressed='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 8%,transparent)}
[data-paimind-skill-result-count]{color:var(--dsw-alias-label-tertiary,#8290a8);font-size:11px;white-space:nowrap}
[data-paimind-skill-grid]{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(300px,.82fr);min-height:520px}
[data-paimind-skill-panel]{min-width:0;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-skill-list]{list-style:none;margin:0;padding:8px;display:grid;align-content:start;gap:5px;max-height:640px;overflow:auto}
[data-paimind-skill-row]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:13px;border:1px solid transparent;border-radius:14px}
[data-paimind-skill-row][data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 20%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 7%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-select]{min-width:0;padding:0;display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:11px;align-items:center;text-align:left;border:0;color:inherit;background:transparent;font:inherit;cursor:pointer}
[data-paimind-skill-row-icon]{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 9%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-row-copy]{min-width:0}
[data-paimind-skill-name]{display:block;font-size:13px;font-weight:700;line-height:20px;overflow-wrap:anywhere}
[data-paimind-skill-description]{display:-webkit-box;margin-top:2px;overflow:hidden;color:var(--dsw-alias-label-secondary,#65718a);font-size:11px;line-height:17px;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-paimind-skill-policy]{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:3px 8px;border-radius:999px;color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 9%,transparent);font-size:9px;line-height:15px}
[data-paimind-skill-favorite]{width:34px;height:34px;padding:0;display:grid;place-items:center;border:0;border-radius:9px;color:var(--dsw-alias-label-tertiary,#8290a8);background:transparent;cursor:pointer}
[data-paimind-skill-favorite][aria-pressed='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-skill-detail]{display:grid;align-content:start;gap:15px;padding:25px;border-left:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13));background:color-mix(in srgb,var(--dsw-alias-bg-base,#f7f9fc) 54%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-detail-icon]{width:54px;height:54px;display:grid;place-items:center;border-radius:16px;color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 10%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-detail] h2{margin:0;font-size:22px;line-height:29px;overflow-wrap:anywhere}
[data-paimind-skill-detail] p{margin:0;color:var(--dsw-alias-label-secondary,#65718a);font-size:12px;line-height:20px;overflow-wrap:anywhere}
[data-paimind-skill-meta]{display:grid;gap:8px;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13));border-radius:13px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-skill-meta-row]{display:grid;grid-template-columns:68px minmax(0,1fr);gap:10px;font-size:10px;line-height:17px}
[data-paimind-skill-meta-row] dt{color:var(--dsw-alias-label-tertiary,#8290a8)}
[data-paimind-skill-meta-row] dd{margin:0;color:var(--dsw-alias-label-secondary,#65718a);overflow-wrap:anywhere}
[data-paimind-skill-state]{padding:58px 20px;color:var(--dsw-alias-label-secondary,#65718a);font-size:12px;line-height:19px;text-align:center}
[data-paimind-skill-state][data-error='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-skill-preview]{margin:18px 0 0;padding:17px 18px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 38%,transparent);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 6%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-skill-preview-head]{display:flex;align-items:flex-start;gap:10px}
[data-paimind-skill-preview-head]>div{min-width:0;flex:1}
[data-paimind-skill-preview] h2{margin:0 0 4px;font-size:16px}
[data-paimind-skill-preview] p{margin:3px 0;color:var(--dsw-alias-label-secondary,#65718a);font-size:11px;line-height:18px}
[data-paimind-skill-warning]{display:flex;align-items:flex-start;gap:6px;color:var(--dsw-alias-state-warning-primary,#b7791f)!important}
[data-paimind-skill-installed]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;list-style:none;margin:0;padding:18px}
[data-paimind-skill-installed] li{display:grid;align-content:start;gap:10px;min-width:0;min-height:220px;padding:20px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.15));border-radius:17px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-skill-installed-card-head]{display:flex;align-items:center;gap:10px}
[data-paimind-skill-installed] h2{margin:0;font-size:15px;line-height:22px;overflow-wrap:anywhere}
[data-paimind-skill-installed] p{margin:0;color:var(--dsw-alias-label-secondary,#65718a);font-size:11px;line-height:18px}
[data-paimind-skill-installed] [data-paimind-skill-actions]{margin-top:auto;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.12))}
@media(max-width:1100px){[data-paimind-skill-workspace]{grid-template-columns:1fr}[data-paimind-skill-scope]{position:static}[data-paimind-skill-scope-list]{grid-template-columns:repeat(3,minmax(0,1fr))}[data-paimind-skill-grid]{grid-template-columns:1fr}[data-paimind-skill-detail]{border-top:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13));border-left:0}}
@media(max-width:760px){[data-paimind-product-bar]{padding:0 12px;gap:8px}[data-paimind-product-brand] span,[data-paimind-product-switch] span,[data-paimind-product-return] span{display:none}[data-paimind-product-switcher]{margin-left:0}[data-paimind-product-switch]{width:36px;padding:0;justify-content:center}[data-paimind-product-return]{width:36px;padding:0}[data-paimind-product-body]{padding:14px 12px 32px}[data-paimind-skill-hero]{grid-template-columns:1fr;padding:28px 20px;border-radius:22px}[data-paimind-skill-hero] h1{font-size:39px}[data-paimind-skill-head-actions]{justify-content:flex-start}[data-paimind-skill-toolbar]{grid-template-columns:1fr}[data-paimind-skill-filterbar]{align-items:flex-start;flex-direction:column}[data-paimind-skill-installed]{grid-template-columns:1fr;padding:12px}[data-paimind-skill-scope-list]{grid-template-columns:1fr}[data-paimind-skill-select]{grid-template-columns:38px minmax(0,1fr)}[data-paimind-skill-select]>[data-paimind-skill-policy]{display:none}}
`
