export const AGENT_CENTER_STYLE: string = `
[data-paimind-agent-trigger]{box-sizing:border-box;width:calc(100% + 8px);min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px;display:flex;align-items:center;gap:8px;border:0;border-radius:12px;color:var(--paimind-ink,var(--dsw-alias-label-primary,#202124));background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-agent-trigger]:hover,[data-paimind-agent-trigger]:focus-visible,[data-paimind-agent-trigger][aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
[data-paimind-agent-trigger][data-wide='false']{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
div:has(> div > button[data-paimind-product-trigger][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important;align-items:stretch!important;gap:2px!important}
div:has(> div > button[data-paimind-product-trigger][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important;align-items:center!important;gap:2px!important}
[data-paimind-agent-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-product-surface]{position:fixed;inset:0;z-index:80;display:grid;grid-template-rows:62px minmax(0,1fr);color:var(--paimind-ink,var(--dsw-alias-label-primary,#17223a));background:var(--paimind-canvas,var(--dsw-alias-bg-base,#f4f7fb));font:inherit}
[data-paimind-product-surface] *{box-sizing:border-box}
[data-paimind-product-initial-focus]:focus{outline:none}
[data-paimind-product-surface] :is(button,input,select,textarea):focus-visible{outline:2px solid var(--paimind-accent,var(--dsw-alias-state-business-primary,#3471f5));outline-offset:2px}
[data-paimind-product-bar]{display:flex;align-items:center;gap:16px;min-width:0;padding:0 22px;border-bottom:1px solid var(--paimind-line,var(--dsw-alias-border-l1,rgba(110,128,154,.15)));background:var(--paimind-glass-strong,var(--dsw-alias-bg-layer-1,#fff));backdrop-filter:saturate(140%) blur(18px)}
[data-paimind-product-brand]{display:flex;align-items:center;gap:9px;min-width:0;color:var(--paimind-deep,var(--paimind-ink,#17223a));font-size:12px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}
[data-paimind-product-brand-icon]{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:#fff;background:var(--paimind-navy,var(--dsw-alias-state-business-primary,#3471f5))}
[data-paimind-product-switcher]{display:flex;gap:3px;margin-left:8px;padding:3px;border:1px solid var(--paimind-line,transparent);border-radius:11px;background:var(--paimind-glass,var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07)))}
[data-paimind-product-switch]{min-height:34px;padding:6px 11px;display:inline-flex;align-items:center;gap:7px;border:0;border-radius:8px;color:var(--paimind-muted,#65718a);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-product-switch][aria-current='page']{color:var(--paimind-navy,#3471f5);background:var(--paimind-glass-strong,#fff);box-shadow:0 1px 2px rgba(31,49,79,.08)}
[data-paimind-product-switch]:disabled{opacity:.42;cursor:not-allowed}
[data-paimind-product-bar-actions]{display:flex;align-items:center;gap:8px;margin-left:auto}
[data-paimind-product-return],[data-paimind-product-close]{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--paimind-line,rgba(110,128,154,.2));color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff);font:inherit;cursor:pointer}
[data-paimind-product-return]{min-height:36px;padding:7px 12px;border-radius:10px;font-size:12px}
[data-paimind-product-close]{width:36px;height:36px;padding:0;border-radius:50%}
[data-paimind-product-return]:hover,[data-paimind-product-close]:hover{color:var(--paimind-ink,#17223a);background:var(--paimind-warm,rgba(128,128,128,.09))}
[data-paimind-product-body]{min-width:0;min-height:0;overflow:auto;padding:30px clamp(20px,4vw,56px) 54px;background:var(--paimind-canvas,#f4f7fb)}
[data-paimind-agent-center]{width:min(1240px,100%);min-width:0;min-height:100%;margin:0 auto}
[data-paimind-agent-hero]{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,430px);gap:30px;align-items:center;padding:28px clamp(24px,3.2vw,40px);border:1px solid var(--paimind-line,rgba(110,128,154,.14));border-radius:var(--paimind-radius,22px);background:var(--paimind-glass-strong,#fff);box-shadow:var(--paimind-shadow,0 14px 40px rgba(39,63,102,.06))}
[data-paimind-agent-eyebrow]{display:flex;align-items:center;gap:8px;margin:0 0 9px;color:var(--paimind-navy,#3471f5);font-size:11px;font-weight:740;letter-spacing:.12em;text-transform:uppercase}
[data-paimind-agent-hero] h1{margin:0;font-size:clamp(34px,4vw,48px);line-height:1.04;letter-spacing:-.045em;font-weight:760}
[data-paimind-agent-hero-copy]{margin:12px 0 0;max-width:680px;color:var(--paimind-muted,#65718a);font-size:14px;line-height:22px}
[data-paimind-agent-hero-actions]{display:grid;gap:10px}
[data-paimind-agent-search-wrap]{position:relative;display:flex;align-items:center}
[data-paimind-agent-search-icon]{position:absolute;left:14px;color:var(--paimind-muted,#8290a8);pointer-events:none}
[data-paimind-agent-search]{width:100%;min-height:46px;padding:10px 14px 10px 42px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:13px;color:var(--paimind-ink,inherit);background:var(--paimind-canvas,#f7f9fc);font:inherit;font-size:13px;outline:none}
[data-paimind-agent-search]:focus{border-color:var(--paimind-accent,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--paimind-accent,#3471f5) 13%,transparent)}
[data-paimind-agent-hero-buttons],[data-paimind-agent-actions]{display:flex;gap:7px;flex-wrap:wrap}
[data-paimind-agent-button],[data-paimind-agent-tab]{min-height:40px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease}
[data-paimind-agent-button]:hover:not(:disabled){border-color:color-mix(in srgb,var(--paimind-accent,#3471f5) 34%,var(--paimind-line,transparent));color:var(--paimind-ink,#17223a)}
[data-paimind-agent-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--paimind-navy,#3471f5);box-shadow:0 7px 18px color-mix(in srgb,var(--paimind-navy,#3471f5) 18%,transparent)}
[data-paimind-agent-button][data-danger='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-agent-button][data-quiet='true']{border-color:transparent;background:transparent}
[data-paimind-agent-button][data-icon-only='true']{width:40px;padding:0}
[data-paimind-agent-button]:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
[data-paimind-agent-tabs-shell]{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:20px 0 26px;padding:6px;border:1px solid var(--paimind-line,rgba(110,128,154,.14));border-radius:15px;background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-tabs]{display:flex;gap:3px;min-width:0}
[data-paimind-agent-tab]{min-height:42px;padding:8px 15px;border-color:transparent;background:transparent;font-size:12px;font-weight:650;white-space:nowrap}
[data-paimind-agent-tab][aria-selected='true']{color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 9%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-count]{min-width:21px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);font-size:9px;text-align:center}
[data-paimind-agent-business-filter]{display:flex;align-items:center;gap:8px;color:var(--paimind-muted,#8290a8);font-size:10px;font-weight:600;white-space:nowrap}
[data-paimind-agent-business-filter] select{min-width:210px;min-height:38px;padding:7px 32px 7px 10px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-ink,#17223a);background:var(--paimind-canvas,#f7f9fc);font:inherit;font-size:11px}
[data-paimind-agent-section-head]{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 14px}
[data-paimind-agent-section-actions]{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}
[data-paimind-agent-section-head] h2{margin:0;font-size:24px;line-height:31px;letter-spacing:-.025em}
[data-paimind-agent-section-head] p{margin:4px 0 0;max-width:680px;color:var(--paimind-muted,#8290a8);font-size:12px;line-height:19px}
[data-paimind-agent-result-count]{color:var(--paimind-muted,#65718a);font-size:11px;white-space:nowrap}
[data-paimind-agent-grid],[data-paimind-agent-loading-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:0;margin:0;list-style:none}
[data-paimind-agent-card]{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:224px;padding:20px;border:1px solid var(--paimind-line,rgba(110,128,154,.15));border-radius:calc(var(--paimind-radius,20px) - 2px);background:var(--paimind-glass-strong,#fff);box-shadow:0 9px 26px rgba(39,63,102,.035);transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
[data-paimind-agent-card]:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--paimind-accent,#3471f5) 24%,var(--paimind-line,transparent));box-shadow:0 13px 30px rgba(39,63,102,.07)}
[data-paimind-agent-card][data-broken='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d04444) 42%,var(--paimind-line,transparent))}
[data-paimind-agent-card-head]{display:flex;align-items:flex-start;gap:12px}
[data-paimind-agent-card-icon]{flex:none;width:42px;height:42px;display:grid;place-items:center;border-radius:13px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 10%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-avatar-seat]{position:relative;overflow:hidden;isolation:isolate}
[data-paimind-agent-avatar-fallback]{width:100%;height:100%;display:grid;place-items:center;transition:opacity .14s ease}
[data-paimind-agent-avatar-seat]>[data-paimind-agent-avatar]{position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;object-fit:cover;object-position:center;border-radius:inherit}
[data-paimind-agent-avatar-seat][data-paimind-agent-avatar-ready='true']>[data-paimind-agent-avatar-fallback],[data-paimind-agent-avatar-seat]:has(>[data-paimind-agent-avatar])>[data-paimind-agent-avatar-fallback]{opacity:0}
[data-paimind-agent-card-title]{min-width:0;flex:1}
[data-paimind-agent-card] h3{margin:0;font-size:16px;line-height:23px;letter-spacing:-.01em;overflow-wrap:anywhere}
[data-paimind-agent-card-kicker]{display:block;margin-top:2px;color:var(--paimind-muted,#8290a8);font-size:10px;line-height:16px}
[data-paimind-agent-card]>p{margin:0;min-height:40px;color:var(--paimind-muted,#65718a);font-size:12px;line-height:20px;overflow-wrap:anywhere;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-paimind-agent-badges]{display:flex;gap:5px;flex-wrap:wrap}
[data-paimind-agent-badge]{padding:3px 8px;border-radius:999px;background:var(--paimind-canvas,rgba(128,128,128,.08));color:var(--paimind-muted,#65718a);font-size:9px;line-height:15px}
[data-paimind-agent-badge][data-category='true']{color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-agent-badge][data-success='true']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-agent-card-context]{display:flex;justify-content:space-between;gap:10px;color:var(--paimind-muted,#65718a);font-size:10px;line-height:17px}
[data-paimind-agent-card-context] span{display:inline-flex;align-items:center;gap:5px}
[data-paimind-agent-card-alert]{min-height:0!important;color:var(--dsw-alias-state-error-primary,#d04444)!important}
[data-paimind-agent-card] [data-paimind-agent-actions]{align-items:center;margin-top:auto;padding-top:12px;border-top:1px solid var(--paimind-line,rgba(110,128,154,.12))}
[data-paimind-agent-card] [data-paimind-agent-button][data-primary='true']{order:-1;margin-right:auto}
[data-paimind-agent-status]{min-height:250px;padding:46px 18px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--paimind-line,rgba(110,128,154,.24));border-radius:var(--paimind-radius,20px);color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff);font-size:12px;line-height:19px;text-align:center}
[data-paimind-agent-status-icon]{width:46px;height:46px;margin-bottom:12px;display:grid;place-items:center;border-radius:14px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 9%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-status] strong{color:var(--paimind-ink,#17223a);font-size:15px}
[data-paimind-agent-status] p{max-width:540px;margin:5px 0 14px;overflow-wrap:anywhere}
[data-paimind-agent-loading-card]{min-height:224px;padding:20px;display:grid;align-content:start;gap:13px;border:1px solid var(--paimind-line,rgba(110,128,154,.14));border-radius:18px;background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-loading-card] :is(span,strong,i){display:block;border-radius:9px;background:linear-gradient(90deg,var(--paimind-canvas,#eef2f7),color-mix(in srgb,var(--paimind-canvas,#eef2f7) 60%,var(--paimind-glass-strong,#fff)),var(--paimind-canvas,#eef2f7));background-size:220% 100%;animation:paimind-agent-loading 1.3s ease-in-out infinite}
[data-paimind-agent-loading-card] span{width:42px;height:42px;border-radius:13px}[data-paimind-agent-loading-card] strong{width:46%;height:16px}[data-paimind-agent-loading-card] i{width:82%;height:58px}
@keyframes paimind-agent-loading{to{background-position:-220% 0}}
[data-paimind-agent-error],[data-paimind-agent-note]{margin:0 0 14px;padding:11px 13px;border:1px solid var(--paimind-line,transparent);border-radius:11px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
[data-paimind-agent-error]{color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 7%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-note]{color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-starter-backdrop]{position:absolute;inset:62px 0 0;z-index:7;display:grid;place-items:center;padding:24px;background:rgba(10,24,44,.34);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
[data-paimind-agent-starter]{width:min(520px,100%);display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;padding:26px;border:1px solid var(--paimind-line,rgba(110,128,154,.18));border-radius:22px;color:var(--paimind-ink,#17223a);background:var(--paimind-glass-strong,#fff);box-shadow:0 28px 80px rgba(19,36,62,.24)}
[data-paimind-agent-starter-icon]{width:52px;height:52px;display:grid;place-items:center;border-radius:16px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 10%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-starter-copy]{min-width:0}[data-paimind-agent-starter-copy] h2{margin:0;font-size:23px;line-height:30px;letter-spacing:-.02em}[data-paimind-agent-starter-copy]>p:last-child{margin:6px 0 0;color:var(--paimind-muted,#65718a);font-size:12px;line-height:19px}
[data-paimind-agent-starter-fields],[data-paimind-agent-starter-note],[data-paimind-agent-starter-error],[data-paimind-agent-starter-actions]{grid-column:1/-1}
[data-paimind-agent-starter-fields]{display:grid;grid-template-columns:1fr 1fr;gap:12px}
[data-paimind-agent-starter-note]{display:flex;align-items:flex-start;gap:8px;padding:11px 12px;border-radius:11px;color:var(--paimind-muted,#65718a);background:var(--paimind-canvas,#f7f9fc);font-size:10px;line-height:17px}[data-paimind-agent-starter-note] svg{flex:none;color:var(--paimind-navy,#3471f5)}
[data-paimind-agent-starter-error]{margin:0;padding:9px 11px;border-radius:10px;color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 7%,var(--paimind-glass-strong,#fff));font-size:11px}
[data-paimind-agent-starter-actions]{display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
[data-paimind-agent-builder-layer]{position:absolute;inset:62px 0 0;z-index:5;min-width:0;background:var(--paimind-canvas,#f4f7fb)}
[data-paimind-agent-form]{height:100%;min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;color:var(--paimind-ink,#17223a);background:var(--paimind-canvas,#f4f7fb)}
[data-paimind-agent-form-head]{display:flex;align-items:flex-start;gap:18px;padding:22px max(24px,calc((100vw - 1240px)/2));border-bottom:1px solid var(--paimind-line,rgba(110,128,154,.13));background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-form-head]>div{min-width:0;flex:1}
[data-paimind-agent-form-kicker]{margin:0 0 4px!important;color:var(--paimind-navy,#3471f5)!important;font-size:10px!important;font-weight:720;letter-spacing:.1em;text-transform:uppercase}
[data-paimind-agent-form] h2{margin:0;font-size:25px;line-height:31px;letter-spacing:-.025em}
[data-paimind-agent-form-head] p{margin:5px 0 0;max-width:760px;color:var(--paimind-muted,#65718a);font-size:12px;line-height:19px}
[data-paimind-agent-builder-close]{flex:none;width:40px;height:40px;display:grid;place-items:center;border:1px solid var(--paimind-line,transparent);border-radius:50%;color:var(--paimind-muted,inherit);background:transparent;cursor:pointer}
[data-paimind-agent-builder-close]:hover{background:var(--paimind-warm,rgba(128,128,128,.1))}
[data-paimind-agent-form-message]{min-height:0;overflow:hidden}
[data-paimind-agent-form-error]{margin:0;padding:10px max(24px,calc((100vw - 1240px)/2));color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 7%,var(--paimind-glass-strong,#fff));font-size:11px;line-height:18px}
[data-paimind-agent-form-body]{min-height:0;overflow:auto;width:100%;display:grid;grid-template-columns:minmax(0,1.12fr) minmax(340px,.88fr);gap:16px;padding:20px max(24px,calc((100vw - 1240px)/2)) 32px}
[data-paimind-agent-form-column]{min-width:0;display:grid;align-content:start;gap:16px}
[data-paimind-agent-form-panel]{min-width:0;padding:20px;border:1px solid var(--paimind-line,rgba(110,128,154,.14));border-radius:calc(var(--paimind-radius,20px) - 2px);background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-conversation]{min-width:0;display:grid;grid-template-rows:auto minmax(150px,1fr) auto auto auto;overflow:hidden;border:1px solid color-mix(in srgb,var(--paimind-accent,#3471f5) 24%,var(--paimind-line,transparent));border-radius:18px;background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-conversation-head]{display:flex;align-items:flex-start;gap:10px;padding:16px 17px;border-bottom:1px solid var(--paimind-line,rgba(110,128,154,.13))}[data-paimind-agent-conversation-head]>span{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 9%,transparent)}[data-paimind-agent-conversation-head] h3{margin:0;font-size:13px;line-height:19px}[data-paimind-agent-conversation-head] p{margin:2px 0 0;color:var(--paimind-muted,#65718a);font-size:9px;line-height:15px}
[data-paimind-agent-conversation-messages]{min-height:150px;max-height:300px;overflow:auto;display:grid;align-content:start;gap:12px;padding:15px;scrollbar-width:thin}
[data-paimind-agent-message]{display:flex;align-items:flex-start;gap:8px;max-width:92%}[data-paimind-agent-message][data-role='user']{justify-self:end;flex-direction:row-reverse}[data-paimind-agent-message]>span{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 10%,transparent);font-size:8px;font-weight:760}[data-paimind-agent-message]>div{min-width:0;padding:8px 10px;border-radius:4px 12px 12px;color:var(--paimind-muted,#65718a);background:var(--paimind-canvas,#f7f9fc)}[data-paimind-agent-message][data-role='user']>div{border-radius:12px 4px 12px 12px;color:var(--paimind-ink,#17223a);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 9%,var(--paimind-glass-strong,#fff))}[data-paimind-agent-message] p{margin:0;font-size:10px;line-height:17px;overflow-wrap:anywhere}[data-paimind-agent-message] small{display:block;margin-top:5px;color:var(--paimind-navy,#3471f5);font-size:8px;line-height:14px}
[data-paimind-agent-conversation-suggestions]{display:flex;gap:6px;overflow:auto;padding:0 15px 9px}[data-paimind-agent-conversation-suggestions] button{flex:none;padding:5px 8px;border:1px solid var(--paimind-line,rgba(110,128,154,.18));border-radius:999px;color:var(--paimind-muted,#65718a);background:transparent;font:inherit;font-size:8px;cursor:pointer}
[data-paimind-agent-conversation-composer]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:12px 15px 4px;border-top:1px solid var(--paimind-line,rgba(110,128,154,.12))}[data-paimind-agent-conversation-composer] textarea{min-width:0;min-height:64px;max-height:130px;resize:vertical;padding:9px 10px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-ink,#17223a);background:var(--paimind-canvas,#f7f9fc);font:inherit;font-size:10px;line-height:17px;outline:none}[data-paimind-agent-conversation-composer] textarea:focus{border-color:var(--paimind-accent,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--paimind-accent,#3471f5) 11%,transparent)}[data-paimind-agent-conversation-composer] button{align-self:end}
[data-paimind-agent-conversation-hint]{padding:0 15px 11px;color:var(--paimind-muted,#8290a8);font-size:8px;line-height:13px}
[data-paimind-agent-panel-head]{display:flex;align-items:flex-start;gap:10px;margin-bottom:16px}
[data-paimind-agent-panel-head]>span{flex:none;width:28px;height:28px;display:grid;place-items:center;border-radius:9px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 9%,var(--paimind-glass-strong,#fff));font-size:9px;font-weight:760}
[data-paimind-agent-panel-head] h3{margin:1px 0 0;font-size:14px;line-height:20px}[data-paimind-agent-panel-head] p{margin:2px 0 0;color:var(--paimind-muted,#65718a);font-size:10px;line-height:16px}
[data-paimind-agent-fields]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:14px}
[data-paimind-agent-field]{display:grid;gap:6px;min-width:0;color:var(--paimind-muted,#65718a);font-size:11px;font-weight:620}
[data-paimind-agent-field][data-wide='true']{grid-column:1/-1}
[data-paimind-agent-field] :is(input,select,textarea){width:100%;min-width:0;padding:10px 11px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-ink,#17223a);background:var(--paimind-canvas,#f7f9fc);font:inherit;font-size:12px;outline:none}
[data-paimind-agent-field] :is(input,select,textarea):focus{border-color:var(--paimind-accent,#3471f5);box-shadow:0 0 0 3px color-mix(in srgb,var(--paimind-accent,#3471f5) 11%,transparent)}
[data-paimind-agent-field] textarea{min-height:92px;resize:vertical;line-height:19px}
[data-paimind-agent-runtime-proof]{display:flex;gap:12px;padding:16px;border:1px solid color-mix(in srgb,var(--paimind-accent,#3471f5) 24%,var(--paimind-line,transparent));border-radius:18px;background:color-mix(in srgb,var(--paimind-accent,#3471f5) 7%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-runtime-proof]>span{flex:none;width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:var(--paimind-navy,#3471f5);background:var(--paimind-glass-strong,#fff)}
[data-paimind-agent-runtime-proof] strong{font-size:12px}[data-paimind-agent-runtime-proof] p{margin:3px 0 0;color:var(--paimind-muted,#65718a);font-size:10px;line-height:17px}
[data-paimind-agent-skill-picker]{min-width:0;margin:0;padding:0;border:0;background:transparent}
[data-paimind-agent-skill-picker] legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
[data-paimind-agent-skill-picker]:disabled{opacity:.68}
[data-paimind-agent-skill-policy]{margin:0 0 12px!important;padding:10px 11px;border-radius:10px;color:var(--paimind-muted,#65718a)!important;background:var(--paimind-canvas,#f7f9fc);font-size:10px!important;line-height:17px!important;font-weight:500!important}
[data-paimind-agent-skill-toolbar]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}
[data-paimind-agent-skill-search]{position:relative;display:flex;align-items:center;color:var(--paimind-muted,#8290a8)}[data-paimind-agent-skill-search]>svg{position:absolute;left:11px;pointer-events:none}
[data-paimind-agent-field] [data-paimind-agent-skill-search]>input{min-height:40px;padding-left:34px;background:var(--paimind-canvas,#f7f9fc)}
[data-paimind-agent-skill-selected]{min-height:40px;padding:8px 11px;border:1px solid var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff);font:inherit;font-size:10px;font-weight:650;cursor:pointer}
[data-paimind-agent-skill-selected][aria-pressed='true']{border-color:var(--paimind-accent,#3471f5);color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 7%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-skill-categories]{display:flex;gap:5px;overflow:auto;margin-top:10px;padding:1px 0 4px;scrollbar-width:thin}
[data-paimind-agent-skill-categories] button{flex:none;min-height:32px;padding:5px 8px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--paimind-line,rgba(110,128,154,.16));border-radius:9px;color:var(--paimind-muted,#65718a);background:var(--paimind-glass-strong,#fff);font:inherit;font-size:9px;cursor:pointer}
[data-paimind-agent-skill-categories] button small{min-width:17px;padding:1px 4px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent);font-size:8px}
[data-paimind-agent-skill-categories] button[aria-pressed='true']{border-color:var(--paimind-accent,#3471f5);color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,var(--paimind-accent,#3471f5) 7%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-skill-summary]{display:flex;justify-content:space-between;gap:10px;margin:10px 0 7px;color:var(--paimind-muted,#8290a8);font-size:9px}
[data-paimind-agent-skill-results]{max-height:378px;overflow:auto;display:grid;gap:7px;padding-right:3px;scrollbar-width:thin}
[data-paimind-agent-skill]{content-visibility:auto;contain-intrinsic-size:64px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;padding:10px;border:1px solid var(--paimind-line,rgba(110,128,154,.16));border-radius:10px;background:var(--paimind-canvas,#f7f9fc);font-weight:500;cursor:pointer}
[data-paimind-agent-skill][data-selected='true']{border-color:color-mix(in srgb,var(--paimind-accent,#3471f5) 42%,var(--paimind-line,transparent));background:color-mix(in srgb,var(--paimind-accent,#3471f5) 5%,var(--paimind-glass-strong,#fff))}
[data-paimind-agent-field] [data-paimind-agent-skill]>input[type='checkbox']{width:16px;height:16px;margin:2px 0 0;padding:0;box-shadow:none;accent-color:var(--paimind-accent,#3471f5)}
[data-paimind-agent-skill]>span{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px}
[data-paimind-agent-skill] strong{min-width:0;color:var(--paimind-ink,#17223a);font-size:10px;line-height:16px;overflow-wrap:anywhere}
[data-paimind-agent-skill] small{padding:1px 6px;border-radius:999px;color:var(--paimind-navy,#3471f5);background:color-mix(in srgb,currentColor 8%,transparent);font-size:8px;line-height:14px}
[data-paimind-agent-skill] em{grid-column:1/-1;color:var(--paimind-muted,#8290a8);font-size:9px;line-height:15px;font-style:normal;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-paimind-agent-skill-empty]{padding:20px 12px;border:1px dashed var(--paimind-line,rgba(110,128,154,.22));border-radius:10px;color:var(--paimind-muted,#8290a8);font-size:10px;text-align:center}
[data-paimind-agent-form-actions]{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px max(24px,calc((100vw - 1240px)/2));border-top:1px solid var(--paimind-line,rgba(110,128,154,.13));background:var(--paimind-glass-strong,#fff);box-shadow:0 -8px 24px rgba(31,49,79,.035)}
[data-paimind-agent-form-actions]>p{margin:0;color:var(--paimind-muted,#65718a);font-size:10px;line-height:16px}[data-paimind-agent-form-actions]>div{display:flex;gap:8px}
@media(max-width:900px){[data-paimind-agent-hero]{grid-template-columns:1fr;gap:20px}[data-paimind-agent-grid],[data-paimind-agent-loading-grid]{grid-template-columns:1fr}[data-paimind-product-body]{padding:22px 18px 44px}[data-paimind-agent-form-body]{grid-template-columns:1fr}[data-paimind-agent-skill-results]{max-height:320px}}
@media(max-width:680px){[data-paimind-product-bar]{padding:0 11px;gap:7px}[data-paimind-product-brand] span,[data-paimind-product-switch] span,[data-paimind-product-return] span{display:none}[data-paimind-product-switcher]{margin-left:0}[data-paimind-product-switch]{width:36px;padding:0;justify-content:center}[data-paimind-product-return]{width:36px;padding:0}[data-paimind-product-body]{padding:12px 10px 28px}[data-paimind-agent-hero]{padding:22px 18px;border-radius:17px}[data-paimind-agent-hero] h1{font-size:34px}[data-paimind-agent-tabs-shell]{display:grid;overflow:hidden}[data-paimind-agent-tabs]{overflow:auto;scrollbar-width:thin}[data-paimind-agent-business-filter]{display:grid;gap:5px;padding:0 4px 3px}[data-paimind-agent-business-filter] select{min-width:0;width:100%}[data-paimind-agent-section-head]{align-items:flex-start;flex-direction:column}[data-paimind-agent-section-actions]{width:100%;justify-content:space-between}[data-paimind-agent-card]{padding:17px}[data-paimind-agent-card-context]{align-items:flex-start;flex-direction:column}[data-paimind-agent-card] [data-paimind-agent-actions]{display:grid;grid-template-columns:1fr 1fr}[data-paimind-agent-card] [data-paimind-agent-button][data-primary='true']{margin:0}[data-paimind-agent-card] [data-paimind-agent-button][data-icon-only='true']{width:100%}[data-paimind-agent-form-head],[data-paimind-agent-form-error],[data-paimind-agent-form-body],[data-paimind-agent-form-actions]{padding-left:14px;padding-right:14px}[data-paimind-agent-form-panel]{padding:16px}[data-paimind-agent-fields]{grid-template-columns:1fr}[data-paimind-agent-field][data-wide='true']{grid-column:auto}[data-paimind-agent-skill-toolbar]{grid-template-columns:1fr}[data-paimind-agent-skill-summary]{display:grid;gap:3px}[data-paimind-agent-form-actions]{align-items:stretch;flex-direction:column}[data-paimind-agent-form-actions]>div{display:grid;grid-template-columns:1fr 1fr}}
@media(max-width:680px){[data-paimind-agent-starter-backdrop]{padding:12px}[data-paimind-agent-starter]{grid-template-columns:1fr;padding:20px}[data-paimind-agent-starter-icon]{width:44px;height:44px}[data-paimind-agent-starter-copy],[data-paimind-agent-starter-fields],[data-paimind-agent-starter-note],[data-paimind-agent-starter-error],[data-paimind-agent-starter-actions]{grid-column:1}[data-paimind-agent-starter-fields]{grid-template-columns:1fr}[data-paimind-agent-starter-actions]{display:grid;grid-template-columns:1fr 1fr}[data-paimind-agent-conversation-composer]{grid-template-columns:1fr}[data-paimind-agent-conversation-composer] button{width:100%}}
@media(prefers-reduced-motion:reduce){[data-paimind-agent-card],[data-paimind-agent-button]{transition:none}[data-paimind-agent-loading-card] :is(span,strong,i){animation:none}}
@media(forced-colors:active){[data-paimind-agent-button],[data-paimind-agent-tab],[data-paimind-agent-card],[data-paimind-agent-form-panel]{forced-color-adjust:auto}}
`
