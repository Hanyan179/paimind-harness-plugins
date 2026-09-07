export const SKILL_CENTER_STYLE = `
button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger]{box-sizing:border-box;width:calc(100% + 8px);min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px;display:flex;align-items:center;gap:8px;border:0;border-radius:12px;color:var(--dsw-alias-label-primary,#202124);background:transparent;font:inherit;font-size:14px;cursor:pointer}
button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger]:hover,button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger]:focus-visible,button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger][aria-current='page']{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger][data-wide='false']{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
button[data-paimind-product-trigger='skill-center'][data-paimind-skill-trigger][data-wide='false']:first-child{margin-top:0}
div:has(> div > button[data-paimind-product-trigger='skill-center'][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important;align-items:stretch!important;gap:2px!important}
div:has(> div > button[data-paimind-product-trigger='skill-center'][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important;align-items:center!important;gap:2px!important}
button[data-paimind-product-trigger='skill-center'] [data-paimind-skill-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-product-surface='skill-center']{--skill-ink:var(--paimind-ink,var(--dsw-alias-label-primary,#17223a));--skill-muted:var(--paimind-muted,var(--dsw-alias-label-secondary,#65718a));--skill-line:var(--paimind-line,var(--dsw-alias-border-l1,rgba(110,128,154,.16)));--skill-accent:var(--paimind-accent,var(--dsw-alias-state-business-primary,#3471f5));--skill-navy:var(--paimind-navy,#18324d);--skill-canvas:var(--paimind-canvas,var(--dsw-alias-bg-base,#f4f7fb));--skill-surface:var(--paimind-glass-strong,var(--dsw-alias-bg-layer-1,#fff));--skill-soft:var(--paimind-glass,var(--dsw-alias-bg-layer-2,rgba(128,128,128,.055)));--skill-shadow:var(--paimind-shadow,0 14px 40px rgba(39,63,102,.08));--skill-radius:var(--paimind-radius,18px);position:absolute;inset:0;z-index:80;box-sizing:border-box;min-width:0;min-height:0;overflow:auto;padding:22px clamp(18px,3vw,48px) 48px;pointer-events:auto;color:var(--skill-ink);background:var(--skill-canvas);font:inherit}
@keyframes paimind-skill-pulse{to{opacity:.3;transform:scale(.72)}}
@scope ([data-paimind-product-surface='skill-center']) {
*{box-sizing:border-box}
[data-paimind-skill-market]{width:min(1440px,100%);min-height:100%;margin:0 auto;color:inherit}
[data-paimind-skill-hero]{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:22px 26px;border:1px solid var(--skill-line);border-radius:calc(var(--skill-radius) + 4px);background:var(--skill-surface);box-shadow:var(--skill-shadow)}
[data-paimind-skill-eyebrow]{display:flex;align-items:center;gap:8px;margin:0 0 7px;color:var(--skill-navy);font-size:10px;font-weight:760;letter-spacing:.13em;text-transform:uppercase}
[data-paimind-skill-hero] h1{margin:0;font-size:clamp(30px,3vw,42px);line-height:1.05;letter-spacing:-.035em;font-weight:760}
[data-paimind-skill-intro]{margin:10px 0 0;max-width:840px;color:var(--skill-muted);font-size:13px;line-height:21px}
[data-paimind-skill-head-actions],[data-paimind-skill-actions],[data-paimind-skill-statuses]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-paimind-skill-center-close]{width:38px;height:38px;padding:0;display:grid;place-items:center;border:1px solid var(--skill-line);border-radius:11px;color:var(--skill-muted);background:var(--skill-surface);font:inherit;cursor:pointer}
[data-paimind-skill-center-close]:hover{color:var(--skill-ink);background:var(--skill-soft)}
[data-paimind-skill-add]{position:relative}
[data-paimind-skill-add-menu]{position:absolute;top:calc(100% + 8px);right:0;z-index:20;width:260px;padding:6px;display:grid;gap:2px;border:1px solid var(--skill-line);border-radius:13px;background:var(--skill-surface);box-shadow:0 18px 48px rgba(23,34,58,.16)}
[data-paimind-skill-add-menu] button{width:100%;min-height:51px;padding:8px 10px;display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;align-items:center;border:0;border-radius:9px;color:var(--skill-muted);background:transparent;font:inherit;text-align:left;cursor:pointer}
[data-paimind-skill-add-menu] button:not(:disabled):hover,[data-paimind-skill-add-menu] button:not(:disabled):focus-visible{color:var(--skill-ink);background:var(--skill-soft)}
[data-paimind-skill-add-menu] button:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-skill-add-menu] button>span{min-width:0;display:grid;gap:1px}
[data-paimind-skill-add-menu] strong{font-size:11px;line-height:16px}
[data-paimind-skill-add-menu] small{color:var(--skill-muted);font-size:9px;line-height:14px}
[data-paimind-skill-button],[data-paimind-skill-filter],[data-paimind-skill-scope-button]{min-height:38px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--skill-line);border-radius:10px;color:var(--skill-muted);background:var(--skill-surface);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
[data-paimind-skill-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--skill-accent);box-shadow:0 6px 16px color-mix(in srgb,var(--skill-accent) 18%,transparent)}
[data-paimind-skill-button][data-danger='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c44848) 28%,var(--skill-line));color:var(--dsw-alias-state-error-primary,#c44848)}
[data-paimind-skill-button]:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}
[data-paimind-skill-feedback]{display:grid;gap:8px;margin-top:12px}
[data-paimind-skill-feedback]:empty{display:none}
[data-paimind-skill-notice]{min-height:40px;padding:9px 12px;display:flex;align-items:center;gap:8px;border:1px solid var(--skill-line);border-radius:11px;color:var(--skill-muted);background:var(--skill-surface);font-size:11px}
[data-paimind-skill-notice]>span:not(:first-child),[data-paimind-skill-notice]>span:only-child{min-width:0;flex:1}
[data-paimind-skill-notice][data-success='true']{color:var(--dsw-alias-state-success-primary,#23875b);border-color:color-mix(in srgb,currentColor 26%,var(--skill-line))}
[data-paimind-skill-notice][data-error='true']{color:var(--dsw-alias-state-error-primary,#c44848);border-color:color-mix(in srgb,currentColor 26%,var(--skill-line))}
[data-paimind-skill-inline-action]{padding:3px 5px;border:0;color:inherit;background:transparent;font:inherit;font-size:11px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;white-space:nowrap}
[data-paimind-skill-workspace]{display:grid;gap:12px;align-items:start;margin-top:16px}
[data-paimind-skill-primary-tabs]{min-height:48px;padding:0 8px;display:flex;align-items:flex-end;gap:24px;border-bottom:1px solid var(--skill-line);background:transparent}
[data-paimind-skill-primary-tabs] button{position:relative;min-height:48px;padding:0 2px;display:inline-flex;align-items:center;gap:7px;border:0;color:var(--skill-muted);background:transparent;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
[data-paimind-skill-primary-tabs] button::after{content:'';position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:transparent}
[data-paimind-skill-primary-tabs] button[aria-selected='true']{color:var(--skill-ink)}
[data-paimind-skill-primary-tabs] button[aria-selected='true']::after{background:var(--skill-accent)}
[data-paimind-skill-primary-tabs] button span{min-width:18px;padding:1px 5px;border-radius:999px;color:var(--skill-muted);background:var(--skill-soft);font-size:9px;line-height:14px;text-align:center}
[data-paimind-skill-scope]{position:sticky;top:0;padding:14px;border:1px solid var(--skill-line);border-radius:var(--skill-radius);background:var(--skill-surface)}
[data-paimind-skill-scope-title]{margin:0 0 9px;color:var(--skill-muted);font-size:9px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
[data-paimind-skill-scope-list]{display:grid;gap:4px}
[data-paimind-skill-scope-button]{width:100%;justify-content:flex-start;border-color:transparent;background:transparent}
[data-paimind-skill-scope-button][aria-selected='true']{color:var(--skill-accent);background:color-mix(in srgb,var(--skill-accent) 9%,var(--skill-surface))}
[data-paimind-skill-scope-count]{min-width:22px;margin-left:auto;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);font-size:10px;text-align:center}
[data-paimind-skill-catalog]{min-width:0;border:1px solid var(--skill-line);border-radius:var(--skill-radius);background:var(--skill-surface);overflow:hidden}
[data-paimind-skill-toolbar]{display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:12px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-search-wrap]{position:relative;display:flex;align-items:center}
[data-paimind-skill-search-icon]{position:absolute;left:13px;color:var(--skill-muted);pointer-events:none}
[data-paimind-skill-toolbar] input[type='search']{width:100%;min-height:42px;padding:9px 12px 9px 39px;border:1px solid var(--skill-line);border-radius:11px;color:inherit;background:var(--skill-soft);font:inherit;outline:none}
[data-paimind-skill-toolbar] input[type='search']:focus{border-color:var(--skill-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--skill-accent) 12%,transparent)}
[data-paimind-skill-filters]{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
[data-paimind-skill-filterbar]{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--skill-line);background:color-mix(in srgb,var(--skill-soft) 68%,var(--skill-surface))}
[data-paimind-skill-select-filter]{min-height:36px;padding:7px 30px 7px 10px;border:1px solid var(--skill-line);border-radius:9px;color:var(--skill-muted);background:var(--skill-surface);font:inherit;font-size:11px}
[data-paimind-skill-filter][aria-pressed='true']{color:var(--skill-accent);background:color-mix(in srgb,currentColor 8%,var(--skill-surface))}
[data-paimind-skill-list-summary]{margin:0;padding:10px 14px;border-bottom:1px solid var(--skill-line);color:var(--skill-muted);font-size:11px;line-height:18px}
[data-paimind-skill-result-count]{color:var(--skill-muted);font-size:11px;white-space:nowrap}
[data-paimind-skill-grid]{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);min-height:470px}
[data-paimind-skill-panel]{min-width:0;background:var(--skill-surface)}
[data-paimind-skill-list]{list-style:none;margin:0;padding:7px;display:grid;align-content:start;gap:3px;max-height:calc(100vh - 308px);min-height:360px;overflow:auto}
[data-paimind-system-list]{list-style:none;margin:0;padding:8px;display:grid;align-content:start;gap:3px}
[data-paimind-system-row]{min-height:64px;padding:11px 13px;display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:11px;align-items:center;border-bottom:1px solid var(--skill-line)}
[data-paimind-system-row]:last-child{border-bottom:0}
[data-paimind-system-control]{display:flex;align-items:center;gap:8px;color:var(--skill-muted);font-size:10px;white-space:nowrap}
[data-paimind-system-control] input[type='checkbox'][role='switch'],[data-paimind-skill-usage-row] input[type='checkbox'][role='switch']{position:relative;width:32px;height:18px;flex:0 0 auto;margin:0;appearance:none;border:1px solid var(--skill-line);border-radius:999px;background:var(--skill-soft);cursor:pointer;transition:background .16s ease,border-color .16s ease}
[data-paimind-system-control] input[type='checkbox'][role='switch']::after,[data-paimind-skill-usage-row] input[type='checkbox'][role='switch']::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--skill-surface);box-shadow:0 1px 4px rgba(23,34,58,.24);transition:transform .16s ease}
[data-paimind-system-control] input[type='checkbox'][role='switch']:checked,[data-paimind-skill-usage-row] input[type='checkbox'][role='switch']:checked{border-color:var(--skill-accent);background:var(--skill-accent)}
[data-paimind-system-control] input[type='checkbox'][role='switch']:checked::after,[data-paimind-skill-usage-row] input[type='checkbox'][role='switch']:checked::after{transform:translateX(14px)}
[data-paimind-system-control] input[type='checkbox'][role='switch']:disabled,[data-paimind-skill-usage-row] input[type='checkbox'][role='switch']:disabled{opacity:.45;cursor:not-allowed}
[data-paimind-skill-row]{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:center;padding:9px;border:1px solid transparent;border-radius:12px}
[data-paimind-skill-row][data-selected='true']{border-color:color-mix(in srgb,var(--skill-accent) 20%,transparent);background:color-mix(in srgb,var(--skill-accent) 7%,var(--skill-surface))}
[data-paimind-skill-select]{min-width:0;padding:0;display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;border:0;color:inherit;background:transparent;font:inherit;cursor:pointer}
[data-paimind-skill-row-icon]{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;color:var(--skill-accent);background:color-mix(in srgb,var(--skill-accent) 9%,var(--skill-surface))}
[data-paimind-skill-row-copy]{min-width:0}
[data-paimind-skill-name]{display:block;font-size:13px;font-weight:700;line-height:19px;overflow-wrap:anywhere}
[data-paimind-skill-description]{display:-webkit-box;margin-top:1px;overflow:hidden;color:var(--skill-muted);font-size:11px;line-height:16px;-webkit-line-clamp:1;-webkit-box-orient:vertical}
[data-paimind-skill-row-badges]{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}
[data-paimind-skill-category]{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;color:var(--skill-navy);background:color-mix(in srgb,var(--skill-navy) 7%,var(--skill-surface));font-size:9px;line-height:14px;white-space:nowrap}
[data-paimind-skill-policy]{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;color:var(--skill-accent);background:color-mix(in srgb,currentColor 9%,var(--skill-surface));font-size:9px;line-height:14px;white-space:normal}
[data-paimind-skill-policy][data-warning='true']{color:var(--dsw-alias-state-warning-primary,#a66b1a)}
[data-paimind-skill-load-more]{padding:13px 9px 8px;display:flex;justify-content:center;border-top:1px solid var(--skill-line)}
[data-paimind-skill-load-more] [data-paimind-skill-button]{min-width:180px}
[data-paimind-skill-detail]{position:relative;display:grid;align-content:start;gap:13px;padding:22px;border-left:1px solid var(--skill-line);background:color-mix(in srgb,var(--skill-soft) 50%,var(--skill-surface))}
[data-paimind-skill-detail-icon]{width:50px;height:50px;display:grid;place-items:center;border-radius:14px;color:var(--skill-accent);background:color-mix(in srgb,var(--skill-accent) 10%,var(--skill-surface))}
[data-paimind-skill-detail] h2,[data-paimind-skill-dialog] h2{margin:0;font-size:20px;line-height:27px;overflow-wrap:anywhere}
[data-paimind-skill-detail] p,[data-paimind-skill-dialog] p{margin:0;color:var(--skill-muted);font-size:12px;line-height:19px;overflow-wrap:anywhere}
[data-paimind-skill-detail-subtitle]{margin-top:3px!important}
[data-paimind-skill-usage]{display:grid;border:1px solid var(--skill-line);border-radius:13px;background:var(--skill-surface);overflow:hidden}
[data-paimind-skill-usage-head],[data-paimind-skill-usage-row]{padding:11px 12px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-usage-head]>div,[data-paimind-skill-usage-row]>span{min-width:0;display:grid;gap:2px}
[data-paimind-skill-usage-head] strong,[data-paimind-skill-usage-row] strong{color:var(--skill-ink);font-size:11px;line-height:17px}
[data-paimind-skill-usage-head] small,[data-paimind-skill-usage-row] small{color:var(--skill-muted);font-size:9px;line-height:15px}
[data-paimind-skill-session-scope]{background:color-mix(in srgb,var(--skill-accent) 3%,var(--skill-surface))}
[data-paimind-skill-session-state]{max-width:360px}
[data-paimind-skill-usage-row] [data-paimind-skill-button]{min-height:31px;padding:5px 9px;font-size:9px}
[data-paimind-skill-contract-note]{margin:0!important;padding:10px 12px;display:flex;align-items:flex-start;gap:7px;color:var(--dsw-alias-state-warning-primary,#a66b1a)!important;background:color-mix(in srgb,currentColor 5%,var(--skill-surface));font-size:9px!important;line-height:15px!important}
[data-paimind-skill-usage]>*:last-child{border-bottom:0}
[data-paimind-skill-disclosure]{border-top:1px solid var(--skill-line);border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-disclosure] summary{padding:11px 0;color:var(--skill-muted);font-size:11px;font-weight:700;cursor:pointer}
[data-paimind-skill-meta]{display:grid;gap:7px;margin:0 0 12px;padding:12px;border:1px solid var(--skill-line);border-radius:11px;background:var(--skill-surface)}
[data-paimind-skill-meta-row]{display:grid;grid-template-columns:66px minmax(0,1fr);gap:9px;font-size:10px;line-height:16px}
[data-paimind-skill-meta-row] dt{color:var(--skill-muted)}
[data-paimind-skill-meta-row] dd{margin:0;color:var(--skill-ink);overflow-wrap:anywhere}
[data-paimind-skill-mobile-close]{display:none;position:absolute;top:12px;right:12px;width:38px;height:38px;border:1px solid var(--skill-line);border-radius:50%;color:var(--skill-muted);background:var(--skill-surface);cursor:pointer}
[data-paimind-skill-state]{min-height:260px;padding:48px 20px;display:grid;place-items:center;align-content:center;gap:12px;color:var(--skill-muted);font-size:12px;line-height:19px;text-align:center}
[data-paimind-skill-state] p{margin:0}
[data-paimind-skill-state][data-error='true']{color:var(--dsw-alias-state-error-primary,#c44848)}
[data-paimind-skill-contract-state]{max-width:660px;margin:0 auto;padding-block:72px}
[data-paimind-skill-contract-state] h2{margin:4px 0 0;color:var(--skill-ink);font-size:19px;line-height:27px}
[data-paimind-skill-contract-state] small{max-width:560px;color:var(--skill-muted);font-size:10px;line-height:17px}
[data-paimind-skill-loading-dot]{width:8px;height:8px;border-radius:50%;background:var(--skill-accent);animation:paimind-skill-pulse 1s ease-in-out infinite alternate}
[data-paimind-skill-dialog-backdrop]{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:rgba(10,19,31,.48);backdrop-filter:blur(6px)}
[data-paimind-skill-dialog]{width:min(560px,100%);max-height:min(760px,calc(100vh - 40px));overflow:auto;padding:24px;display:grid;gap:15px;border:1px solid var(--skill-line);border-radius:calc(var(--skill-radius) + 2px);color:var(--skill-ink);background:var(--skill-surface);box-shadow:0 24px 80px rgba(10,19,31,.24)}
[data-paimind-skill-dialog-head]{display:flex;align-items:center;gap:12px}
[data-paimind-skill-dialog-head] [data-paimind-skill-eyebrow]{margin-bottom:3px}
[data-paimind-skill-dialog-head][data-danger='true'] [data-paimind-skill-detail-icon]{color:var(--dsw-alias-state-error-primary,#c44848);background:color-mix(in srgb,currentColor 10%,var(--skill-surface))}
[data-paimind-skill-review-grid]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0}
[data-paimind-skill-review-grid]>div{padding:11px;border:1px solid var(--skill-line);border-radius:10px;background:var(--skill-soft)}
[data-paimind-skill-review-grid] dt{color:var(--skill-muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}
[data-paimind-skill-review-grid] dd{margin:4px 0 0;font-size:12px;font-weight:700;overflow-wrap:anywhere}
[data-paimind-skill-import-formats]{display:grid;grid-template-columns:1fr 1fr;gap:9px}[data-paimind-skill-import-formats] section{padding:13px;border:1px solid var(--skill-line);border-radius:11px;background:var(--skill-soft)}[data-paimind-skill-import-formats] strong{display:block;margin-bottom:4px;color:var(--skill-ink);font-size:12px}[data-paimind-skill-import-formats] p{font-size:10px;line-height:17px}
[data-paimind-skill-import-tree]{padding:13px 15px;border:1px solid color-mix(in srgb,var(--skill-accent) 22%,var(--skill-line));border-radius:11px;background:color-mix(in srgb,var(--skill-accent) 5%,var(--skill-soft))}[data-paimind-skill-import-tree] code{color:var(--skill-ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:19px}[data-paimind-skill-import-tree] b{color:var(--dsw-alias-state-success-primary,#238c55);font-weight:700}[data-paimind-skill-import-tree] i{color:var(--skill-muted);font-style:normal}
[data-paimind-skill-import-rules]{display:grid;gap:6px;margin:0;padding:0 0 0 18px;color:var(--skill-muted);font-size:10px;line-height:17px}
[data-paimind-skill-safe-copy]{padding:11px;border-left:3px solid var(--skill-accent);background:color-mix(in srgb,var(--skill-accent) 6%,var(--skill-surface))}
[data-paimind-skill-warning]{display:flex;align-items:flex-start;gap:7px;color:var(--dsw-alias-state-warning-primary,#a66b1a)!important}
[data-paimind-skill-dialog-actions]{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding-top:3px}
[data-paimind-skill-editor]{margin-top:16px;padding:24px;display:grid;gap:22px;border:1px solid var(--skill-line);border-radius:var(--skill-radius);background:var(--skill-surface);box-shadow:var(--skill-shadow)}
[data-paimind-skill-editor-head]{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-editor-head] h2{margin:0;font-size:24px;line-height:31px}
[data-paimind-skill-editor-head] p:not([data-paimind-skill-eyebrow]){margin:5px 0 0;color:var(--skill-muted);font-size:12px;line-height:19px}
[data-paimind-skill-editor-form]{display:grid;gap:18px;max-width:980px}
[data-paimind-skill-editor-form] label{display:grid;gap:7px;color:var(--skill-ink);font-size:12px;font-weight:700}
[data-paimind-skill-editor-form] small{color:var(--skill-muted);font-size:10px;font-weight:400;line-height:16px}
[data-paimind-skill-editor-form] :is(input,textarea){width:100%;padding:11px 13px;border:1px solid var(--skill-line);border-radius:11px;color:var(--skill-ink);background:var(--skill-soft);font:inherit;font-size:12px;font-weight:400;line-height:19px;outline:none;resize:vertical}
[data-paimind-skill-editor-form] input{min-height:44px}
[data-paimind-skill-editor-form] textarea[aria-label$='instructions'],[data-paimind-skill-editor-form] textarea[aria-label$='执行说明']{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
[data-paimind-skill-editor-form] :is(input,textarea):focus{border-color:var(--skill-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--skill-accent) 12%,transparent)}
[data-paimind-skill-editor-form] :is(input,textarea):disabled{opacity:.65;cursor:not-allowed}
[data-paimind-skill-editor-actions]{display:flex;justify-content:flex-end;gap:9px;padding-top:4px}
[data-paimind-skill-package-editor]{display:grid;grid-template-columns:minmax(230px,28%) minmax(0,1fr);min-height:560px;border:1px solid var(--skill-line);border-radius:14px;overflow:hidden;background:var(--skill-soft)}
[data-paimind-skill-package-tree]{display:grid;grid-template-rows:auto auto minmax(0,1fr);min-width:0;border-right:1px solid var(--skill-line);background:var(--skill-surface)}
[data-paimind-skill-package-tree-head]{display:grid;gap:3px;padding:14px 15px 11px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-package-tree-head] strong{font-size:12px}[data-paimind-skill-package-tree-head] small{color:var(--skill-muted);font-size:9px;line-height:15px}
[data-paimind-skill-package-create]{display:grid;gap:9px;padding:10px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-package-create] label{display:grid;gap:4px;color:var(--skill-muted);font-size:9px;font-weight:700}
[data-paimind-skill-package-create] label>span:last-child{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}
[data-paimind-skill-package-create] input{min-width:0;padding:9px 10px;border:1px solid var(--skill-line);border-radius:9px;background:var(--skill-soft);color:var(--skill-ink);font:inherit;font-size:10px;outline:none}
[data-paimind-skill-package-create] input:focus{border-color:var(--skill-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--skill-accent) 12%,transparent)}
[data-paimind-skill-package-tree-rows]{min-height:0;padding:7px 5px 12px;overflow:auto}
[data-paimind-skill-package-folder],[data-paimind-skill-package-file],[data-paimind-skill-package-more]{width:100%;min-height:31px;display:flex;align-items:center;gap:6px;padding:5px 8px 5px calc(8px + var(--skill-tree-depth,0) * 15px);border:0;border-radius:7px;background:transparent;color:var(--skill-ink);font:inherit;font-size:10px;text-align:left;cursor:pointer}
[data-paimind-skill-package-folder]:hover,[data-paimind-skill-package-file]:hover,[data-paimind-skill-package-more]:hover{background:var(--skill-soft)}
[data-paimind-skill-package-folder]>span:first-child,[data-paimind-skill-package-file]>span:first-child{width:12px;flex:0 0 12px;color:var(--skill-muted);text-align:center}
[data-paimind-skill-package-folder][data-selected='true']{background:color-mix(in srgb,var(--skill-accent) 10%,var(--skill-soft));color:var(--skill-accent);font-weight:700}
[data-paimind-skill-package-file][data-selected='true']{background:color-mix(in srgb,var(--skill-accent) 10%,var(--skill-soft));color:var(--skill-accent);font-weight:700}
[data-paimind-skill-package-file][data-binary='true']{color:var(--skill-muted)}
[data-paimind-skill-package-more]{padding-left:calc(26px + var(--skill-tree-depth,0) * 15px);color:var(--skill-accent)}
[data-paimind-skill-package-workbench]{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;background:var(--skill-surface)}
[data-paimind-skill-package-path]{min-height:66px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid var(--skill-line)}
[data-paimind-skill-package-path]>div{min-width:0;display:grid;gap:3px}[data-paimind-skill-package-path] strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}[data-paimind-skill-package-path] small{color:var(--skill-muted);font-size:9px}
[data-paimind-skill-package-source]{width:100%;height:100%;min-height:490px;padding:18px;border:0;resize:none;outline:none;background:var(--skill-surface);color:var(--skill-ink);font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}
[data-paimind-skill-package-empty]{display:grid;place-content:center;gap:8px;padding:28px;color:var(--skill-muted);text-align:center}[data-paimind-skill-package-empty] strong{color:var(--skill-ink);font-size:13px}[data-paimind-skill-package-empty] p{max-width:520px;margin:0;font-size:10px;line-height:18px}
:scope :is(button,input,textarea,select,summary):focus-visible{outline:2px solid var(--skill-accent);outline-offset:2px}
@media(max-width:1100px){[data-paimind-skill-workspace]{grid-template-columns:1fr}[data-paimind-skill-scope]{position:static;padding:9px}[data-paimind-skill-scope-title]{position:absolute;clip:rect(0 0 0 0);clip-path:inset(50%);width:1px;height:1px;overflow:hidden}[data-paimind-skill-scope-list]{grid-template-columns:repeat(3,minmax(0,1fr))}[data-paimind-skill-grid]{grid-template-columns:minmax(0,1fr) minmax(280px,360px)}}
@media(max-width:760px){:scope{padding:10px 10px 28px}[data-paimind-skill-hero]{grid-template-columns:1fr;padding:16px;border-radius:16px;gap:14px}[data-paimind-skill-hero]>div:first-child{padding-right:42px}[data-paimind-skill-hero] h1{font-size:30px}[data-paimind-skill-intro]{font-size:12px;line-height:19px}[data-paimind-skill-head-actions]{justify-content:flex-start}[data-paimind-skill-center-close]{position:absolute;top:14px;right:14px}[data-paimind-skill-button],[data-paimind-skill-filter],[data-paimind-skill-scope-button],[data-paimind-skill-select-filter]{min-height:44px}[data-paimind-skill-editor]{margin-top:10px;padding:17px;gap:16px}[data-paimind-skill-editor-head]{display:grid;gap:10px}[data-paimind-skill-editor-actions]{display:grid;grid-template-columns:1fr}[data-paimind-skill-package-editor]{grid-template-columns:1fr;min-height:0}[data-paimind-skill-package-tree]{max-height:300px;border-right:0;border-bottom:1px solid var(--skill-line)}[data-paimind-skill-package-source]{min-height:420px}[data-paimind-skill-workspace]{margin-top:10px;gap:10px}[data-paimind-skill-scope]{overflow:auto}[data-paimind-skill-scope-list]{display:flex;min-width:max-content}[data-paimind-skill-scope-button]{width:auto;min-width:112px}[data-paimind-skill-toolbar]{grid-template-columns:1fr;padding:10px}[data-paimind-skill-filterbar]{align-items:flex-start;flex-direction:column;padding:9px 10px}[data-paimind-skill-filters]{width:100%}[data-paimind-skill-select-filter]{min-width:0;flex:1}[data-paimind-skill-grid]{display:block;min-height:0}[data-paimind-skill-list]{max-height:none;min-height:0}[data-paimind-skill-row]{padding:8px 4px}[data-paimind-system-row]{grid-template-columns:38px minmax(0,1fr);padding:10px 8px}[data-paimind-system-row]>:last-child{grid-column:2;justify-self:start}[data-paimind-skill-select]{grid-template-columns:38px minmax(0,1fr) auto}[data-paimind-skill-row-badges]>[data-paimind-skill-policy]{display:none}[data-paimind-skill-detail]{position:absolute;inset:0;z-index:95;display:none;padding:22px 18px 40px;border:0;overflow:auto;background:var(--skill-canvas)}[data-paimind-skill-detail][data-mobile-open='true']{display:grid}[data-paimind-skill-mobile-close]{display:grid;place-items:center}[data-paimind-skill-dialog-backdrop]{padding:10px}[data-paimind-skill-dialog]{padding:19px;border-radius:16px}[data-paimind-skill-review-grid]{grid-template-columns:1fr}[data-paimind-skill-dialog-actions]{display:grid;grid-template-columns:1fr}[data-paimind-skill-dialog-actions] [data-paimind-skill-button]{width:100%}}
@media(max-width:420px){[data-paimind-skill-scope]{scrollbar-width:none}[data-paimind-skill-scope]::-webkit-scrollbar{display:none}[data-paimind-skill-scope-button]{min-width:98px}[data-paimind-skill-filters]{display:grid;grid-template-columns:1fr;width:100%}[data-paimind-skill-select-filter]{width:100%}}
@media(max-width:560px){[data-paimind-skill-import-formats]{grid-template-columns:1fr}}
@media(max-width:760px){[data-paimind-skill-primary-tabs]{gap:18px;overflow:auto}[data-paimind-skill-primary-tabs] button{min-width:max-content}}
@media(prefers-reduced-motion:reduce){[data-paimind-skill-loading-dot]{animation:none}}
}
`
