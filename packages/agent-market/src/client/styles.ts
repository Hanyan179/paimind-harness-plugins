export const AGENT_CENTER_STYLE = `
[data-paimind-agent-trigger]{box-sizing:border-box;width:calc(100% + 8px);min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px;display:flex;align-items:center;gap:8px;border:0;border-radius:12px;color:var(--dsw-alias-label-primary,#202124);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-agent-trigger]:hover,[data-paimind-agent-trigger]:focus-visible,[data-paimind-agent-trigger][aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
[data-paimind-agent-trigger][data-wide='false']{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
[data-paimind-agent-trigger][data-wide='false']:first-child{margin-top:0}
div:has(> div > button[data-paimind-product-trigger][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important;align-items:stretch!important;gap:2px!important}
div:has(> div > button[data-paimind-product-trigger][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important;align-items:center!important;gap:2px!important}
[data-paimind-agent-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
[data-paimind-product-body]{min-height:0;overflow:auto;padding:38px clamp(24px,4vw,68px) 64px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 3%,var(--dsw-alias-bg-base,#f4f7fb))}
[data-paimind-agent-center]{width:min(1480px,100%);min-height:100%;margin:0 auto}
[data-paimind-agent-hero]{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.68fr);gap:36px;align-items:end;padding:44px clamp(28px,4vw,56px);border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:30px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv1,0 14px 44px rgba(39,63,102,.06))}
[data-paimind-agent-eyebrow]{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:#0f365f;font-size:12px;font-weight:760;letter-spacing:.18em;text-transform:uppercase}
[data-paimind-agent-hero] h1{margin:0;font-size:clamp(40px,5vw,68px);line-height:1;letter-spacing:-.055em;font-weight:780}
[data-paimind-agent-hero-copy]{margin:18px 0 0;max-width:760px;color:var(--dsw-alias-label-secondary,#65718a);font-size:15px;line-height:24px}
[data-paimind-agent-hero-actions]{display:grid;gap:12px}
[data-paimind-agent-search-wrap]{position:relative;display:flex;align-items:center}
[data-paimind-agent-search-icon]{position:absolute;left:17px;color:var(--dsw-alias-label-tertiary,#8290a8);pointer-events:none}
[data-paimind-agent-search]{width:100%;min-height:52px;padding:12px 16px 12px 48px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:16px;color:inherit;background:var(--dsw-alias-bg-base,#f7f9fc);font:inherit;font-size:14px;outline:none}
[data-paimind-agent-search]:focus{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 14%,transparent)}
[data-paimind-agent-hero-buttons],[data-paimind-agent-actions],[data-paimind-agent-skills]{display:flex;gap:8px;flex-wrap:wrap}
[data-paimind-agent-button],[data-paimind-agent-tab]{min-height:38px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:11px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-agent-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 8px 20px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 20%,transparent)}
[data-paimind-agent-button][data-danger='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-agent-button]:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
[data-paimind-agent-tabs-shell]{display:flex;align-items:center;gap:10px;margin:26px 0;padding:8px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-agent-tabs]{display:flex;gap:5px}
[data-paimind-agent-tab]{min-height:44px;padding:9px 18px;border-color:transparent;background:transparent;font-size:13px;font-weight:650}
[data-paimind-agent-tab][aria-selected='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 9%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-count]{min-width:22px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);font-size:10px;text-align:center}
[data-paimind-agent-taxonomy]{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 26px;padding:8px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14));border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-agent-platform-views]{display:flex;gap:5px;min-width:0}
[data-paimind-agent-platform-views] button{min-height:42px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:11px;color:var(--dsw-alias-label-secondary,#65718a);background:transparent;font:inherit;font-size:12px;font-weight:650;cursor:pointer}
[data-paimind-agent-platform-views] button small{min-width:21px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 9%,transparent);font-size:9px;text-align:center}
[data-paimind-agent-platform-views] button[aria-selected='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 9%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-business-filter]{display:flex;align-items:center;gap:9px;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:10px;font-weight:600}
[data-paimind-agent-business-filter] select{min-width:220px;min-height:40px;padding:8px 34px 8px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:11px;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-base,#f7f9fc);font:inherit;font-size:11px;outline:none}
[data-paimind-agent-business-filter] select:focus{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 12%,transparent)}
[data-paimind-agent-section-head]{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 16px}
[data-paimind-agent-section-actions]{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}
[data-paimind-agent-section-head] h2{margin:0;font-size:25px;line-height:32px;letter-spacing:-.025em}
[data-paimind-agent-section-head] p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:12px;line-height:19px}
[data-paimind-agent-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;padding:0;margin:0;list-style:none}
[data-paimind-agent-card]{display:grid;grid-template-rows:auto auto minmax(54px,1fr) auto auto;gap:14px;min-width:0;min-height:264px;padding:24px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.15));border-radius:22px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 34px rgba(39,63,102,.045);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
[data-paimind-agent-card]:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 25%,transparent);box-shadow:0 18px 42px rgba(39,63,102,.08)}
[data-paimind-agent-card][data-broken='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d04444) 45%,transparent)}
[data-paimind-agent-card-head]{display:flex;align-items:flex-start;gap:13px}
[data-paimind-agent-card-icon]{flex:none;width:48px;height:48px;display:grid;place-items:center;border-radius:15px;color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 10%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-card-title]{min-width:0;flex:1}
[data-paimind-agent-card] h3{margin:0;font-size:18px;line-height:25px;letter-spacing:-.015em;overflow-wrap:anywhere}
[data-paimind-agent-card-kicker]{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:10px;line-height:16px}
[data-paimind-agent-card] p{margin:0;color:var(--dsw-alias-label-secondary,#65718a);font-size:12px;line-height:20px;overflow-wrap:anywhere}
[data-paimind-agent-badges]{display:flex;gap:6px;flex-wrap:wrap}
[data-paimind-agent-badge]{padding:4px 9px;border-radius:999px;background:var(--dsw-alias-bg-base,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#65718a);font-size:10px;line-height:16px}
[data-paimind-agent-badge][data-category='true']{color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-agent-badge][data-success='true']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-agent-profile-meta]{display:grid;gap:7px;margin:0;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-base,rgba(128,128,128,.06))}
[data-paimind-agent-profile-meta] div{display:grid;grid-template-columns:44px minmax(0,1fr);gap:9px}
[data-paimind-agent-profile-meta] dt{color:var(--dsw-alias-label-tertiary,#8290a8);font-size:10px;line-height:17px}
[data-paimind-agent-profile-meta] dd{margin:0;color:var(--dsw-alias-label-secondary,#65718a);font-size:10px;line-height:17px;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-paimind-agent-card] [data-paimind-agent-actions]{align-items:center;justify-content:flex-end;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.12))}
[data-paimind-agent-card] [data-paimind-agent-button][data-primary='true']{margin-left:auto}
[data-paimind-agent-status]{padding:72px 16px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,128,154,.24));border-radius:22px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font-size:13px;line-height:20px;text-align:center}
[data-paimind-agent-error]{margin:0 0 16px;padding:12px 14px;border-radius:12px;color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 8%,transparent);font-size:12px;line-height:18px;overflow-wrap:anywhere}
[data-paimind-agent-note]{margin:0 0 16px;padding:11px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#65718a);font-size:12px;line-height:18px}
[data-paimind-agent-builder-layer]{position:absolute;inset:64px 0 0;z-index:5;display:flex;justify-content:flex-end}
[data-paimind-agent-builder-mask]{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.28));backdrop-filter:blur(3px)}
[data-paimind-agent-form]{position:relative;width:min(660px,100vw);height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.15));box-shadow:-24px 0 64px rgba(21,37,63,.17)}
[data-paimind-agent-form-head]{display:flex;align-items:flex-start;gap:12px;padding:24px 26px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13))}
[data-paimind-agent-form-head]>div{min-width:0;flex:1}
[data-paimind-agent-form] h2{margin:0;font-size:23px;line-height:30px}
[data-paimind-agent-form-head] p{margin:5px 0 0;color:var(--dsw-alias-label-secondary,#65718a);font-size:12px;line-height:19px}
[data-paimind-agent-builder-close]{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:50%;color:inherit;background:transparent;cursor:pointer}
[data-paimind-agent-builder-close]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
[data-paimind-agent-fields]{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:16px;padding:22px 26px 34px}
[data-paimind-agent-field]{display:grid;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary,#65718a);font-size:11px;font-weight:600}
[data-paimind-agent-field][data-wide='true']{grid-column:1/-1}
[data-paimind-agent-field] :is(input,select,textarea){width:100%;min-width:0;padding:10px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:11px;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-base,#f7f9fc);font:inherit;font-size:12px;outline:none}
[data-paimind-agent-field] :is(input,select,textarea):focus{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 12%,transparent)}
[data-paimind-agent-field]>small{color:var(--dsw-alias-label-tertiary,#8290a8);font-size:9px;font-weight:450;line-height:15px}
[data-paimind-agent-field] textarea{min-height:94px;resize:vertical;line-height:19px}
[data-paimind-agent-skill-picker]{min-width:0;margin:0;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.16));border-radius:15px;background:var(--dsw-alias-bg-base,#f7f9fc)}
[data-paimind-agent-skill-picker] legend{padding:0 6px;color:var(--dsw-alias-label-primary,#17223a);font-size:12px;font-weight:700}
[data-paimind-agent-skill-picker]:disabled{opacity:.72}
[data-paimind-agent-skill-policy]{margin:0!important;padding:10px 12px;border-radius:10px;color:var(--dsw-alias-label-secondary,#65718a)!important;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 7%,var(--dsw-alias-bg-layer-1,#fff));font-size:10px!important;line-height:17px!important}
[data-paimind-agent-skill-toolbar]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
[data-paimind-agent-skill-search]{position:relative;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary,#8290a8)}
[data-paimind-agent-skill-search]>svg{position:absolute;left:11px;pointer-events:none}
[data-paimind-agent-field] [data-paimind-agent-skill-search]>input{min-height:40px;padding-left:34px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-agent-skill-selected]{min-height:40px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:10px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:10px;font-weight:650;cursor:pointer}
[data-paimind-agent-skill-selected][aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary,#3471f5);color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 7%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-skill-categories]{display:flex;gap:6px;overflow:auto;padding:1px 0 3px;scrollbar-width:thin}
[data-paimind-agent-skill-categories] button{flex:none;min-height:32px;padding:5px 9px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.16));border-radius:9px;color:var(--dsw-alias-label-secondary,#65718a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:9px;cursor:pointer}
[data-paimind-agent-skill-categories] button small{min-width:17px;padding:1px 4px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent);font-size:8px;text-align:center}
[data-paimind-agent-skill-categories] button[aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary,#3471f5);color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 7%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-skill-summary]{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:9px;font-weight:500}
[data-paimind-agent-skill-results]{max-height:290px;overflow:auto;display:grid;gap:7px;padding-right:3px;scrollbar-width:thin}
[data-paimind-agent-skill]{content-visibility:auto;contain-intrinsic-size:64px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:flex-start;gap:9px;padding:10px;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.16));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);font-weight:500;cursor:pointer}
[data-paimind-agent-skill][data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 5%,var(--dsw-alias-bg-layer-1,#fff))}
[data-paimind-agent-field] [data-paimind-agent-skill]>input[type='checkbox']{width:16px;height:16px;margin:2px 0 0;padding:0;box-shadow:none;accent-color:var(--dsw-alias-state-business-primary,#3471f5)}
[data-paimind-agent-skill]>span{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px}
[data-paimind-agent-skill] strong{min-width:0;color:var(--dsw-alias-label-primary,#17223a);font-size:10px;line-height:16px;overflow-wrap:anywhere}
[data-paimind-agent-skill] small{padding:1px 6px;border-radius:999px;color:var(--dsw-alias-state-business-primary,#3471f5);background:color-mix(in srgb,currentColor 8%,transparent);font-size:8px;line-height:14px;font-weight:600}
[data-paimind-agent-skill] em{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:9px;line-height:15px;font-style:normal;font-weight:450;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-paimind-agent-skill-empty]{padding:20px 12px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,128,154,.22));border-radius:10px;color:var(--dsw-alias-label-tertiary,#8290a8);font-size:10px;font-weight:500;text-align:center}
[data-paimind-agent-form-actions]{display:flex;justify-content:flex-end;gap:8px;padding:16px 26px;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.13));background:var(--dsw-alias-bg-layer-1,#fff)}
@media(max-width:900px){[data-paimind-agent-hero]{grid-template-columns:1fr;align-items:start}[data-paimind-agent-taxonomy]{flex-wrap:wrap}[data-paimind-agent-grid]{grid-template-columns:1fr}[data-paimind-product-body]{padding:24px 20px 48px}}
@media(max-width:640px){[data-paimind-product-bar]{padding:0 12px;gap:8px}[data-paimind-product-brand] span,[data-paimind-product-switch] span,[data-paimind-product-return] span{display:none}[data-paimind-product-switcher]{margin-left:0}[data-paimind-product-switch]{width:36px;padding:0;justify-content:center}[data-paimind-product-return]{width:36px;padding:0}[data-paimind-product-body]{padding:14px 12px 32px}[data-paimind-agent-hero]{padding:28px 20px;border-radius:22px}[data-paimind-agent-hero] h1{font-size:39px}[data-paimind-agent-tabs-shell]{overflow:auto}[data-paimind-agent-tabs],[data-paimind-agent-platform-views]{min-width:max-content}[data-paimind-agent-taxonomy]{display:grid;overflow:auto}[data-paimind-agent-business-filter]{display:grid;gap:5px}[data-paimind-agent-business-filter] select{min-width:0;width:100%}[data-paimind-agent-card]{padding:19px}[data-paimind-agent-fields]{grid-template-columns:1fr;padding:18px 18px 28px}[data-paimind-agent-field][data-wide='true']{grid-column:auto}[data-paimind-agent-form-head],[data-paimind-agent-form-actions]{padding-left:18px;padding-right:18px}[data-paimind-agent-skill-toolbar]{grid-template-columns:1fr}[data-paimind-agent-skill-summary]{display:grid;gap:3px}}
`
