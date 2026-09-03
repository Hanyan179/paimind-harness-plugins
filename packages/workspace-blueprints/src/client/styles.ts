export const WORKSPACE_BLUEPRINT_CENTER_STYLE = `
[data-paimind-product-surface='workspace-blueprints']{position:absolute;inset:0;z-index:80;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-layer-1,#f6f8fb);font:inherit}
[data-paimind-workspace-blueprints-trigger]{box-sizing:border-box;width:calc(100% + 8px);min-width:0;min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px;display:flex;align-items:center;justify-content:flex-start;gap:8px;border:0;border-radius:12px;color:var(--dsw-alias-label-primary,#202124);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-workspace-blueprints-trigger]:hover,[data-paimind-workspace-blueprints-trigger]:focus-visible,[data-paimind-workspace-blueprints-trigger][aria-current='page']{color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
[data-paimind-workspace-blueprints-trigger]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3471f5);outline-offset:2px}
[data-paimind-workspace-blueprints-trigger][data-wide='false']{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
div:has(> div > button[data-paimind-product-trigger='workspace-blueprints'][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important;align-items:stretch!important;gap:2px!important}
div:has(> div > button[data-paimind-product-trigger='workspace-blueprints'][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important;align-items:center!important;gap:2px!important}
[data-paimind-workspace-blueprints-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-workspace-blueprints]{--wb-accent:var(--paimind-accent,var(--dsw-alias-state-business-primary,#3471f5));--wb-ink:var(--dsw-alias-label-primary,#17223a);--wb-muted:var(--dsw-alias-label-secondary,#65718a);--wb-faint:var(--dsw-alias-label-tertiary,#8792a6);--wb-line:var(--dsw-alias-border-l1,rgba(100,120,152,.16));--wb-line-strong:var(--dsw-alias-border-l2,rgba(100,120,152,.28));--wb-surface:var(--dsw-alias-bg-layer-2,#fff);display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;background:linear-gradient(180deg,color-mix(in srgb,var(--wb-accent) 4%,var(--dsw-alias-bg-layer-1,#f6f8fb)),var(--dsw-alias-bg-layer-1,#f6f8fb) 280px)}
[data-paimind-workspace-blueprints] *{box-sizing:border-box}
[data-paimind-workspace-blueprints] :is(button,input,textarea,select):focus-visible{outline:2px solid var(--wb-accent);outline-offset:2px}
[data-paimind-workspace-blueprints-header]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:start;padding:25px 30px 18px;border-bottom:1px solid var(--wb-line);background:color-mix(in srgb,var(--wb-surface) 88%,transparent)}
[data-paimind-workspace-blueprints-header-copy]{display:grid;gap:5px;min-width:0}
[data-paimind-workspace-blueprints-eyebrow]{margin:0;color:var(--wb-accent);font-size:11px;line-height:16px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
[data-paimind-workspace-blueprints-header] h1{margin:0;color:var(--wb-ink);font-size:26px;line-height:34px;font-weight:720;letter-spacing:-.035em}
[data-paimind-workspace-blueprints-header] p{max-width:790px;margin:0;color:var(--wb-muted);font-size:13px;line-height:20px}
[data-paimind-workspace-blueprints-head-actions]{display:flex;align-items:center;gap:9px}
[data-paimind-workspace-blueprints-close]{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;padding:0;border:1px solid var(--wb-line);border-radius:11px;color:var(--wb-muted);background:var(--wb-surface);cursor:pointer}
[data-paimind-workspace-blueprints-button]{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:7px 13px;border:1px solid var(--wb-line-strong);border-radius:10px;color:var(--wb-ink);background:var(--wb-surface);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-workspace-blueprints-button][data-primary='true']{border-color:var(--wb-accent);color:#fff;background:var(--wb-accent);font-weight:650}
[data-paimind-workspace-blueprints-button][data-danger='true']{color:#b72f45;border-color:color-mix(in srgb,#d83a52 28%,var(--wb-line));background:color-mix(in srgb,#d83a52 5%,var(--wb-surface))}
[data-paimind-workspace-blueprints-button]:disabled,[data-paimind-workspace-blueprints-close]:disabled{opacity:.52;cursor:not-allowed}
[data-paimind-workspace-blueprints-scopes]{display:flex;gap:18px;padding:0 30px;border-bottom:1px solid var(--wb-line);background:color-mix(in srgb,var(--wb-surface) 70%,transparent)}
[data-paimind-workspace-blueprints-scopes] button{position:relative;min-height:45px;padding:0 2px;border:0;color:var(--wb-muted);background:transparent;font:inherit;font-size:13px;cursor:pointer}
[data-paimind-workspace-blueprints-scopes] button[aria-current='page']{color:var(--wb-accent);font-weight:700}
[data-paimind-workspace-blueprints-scopes] button[aria-current='page']::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--wb-accent);content:''}
[data-paimind-workspace-blueprints-toolbar]{display:grid;grid-template-columns:minmax(220px,440px) minmax(0,1fr);gap:14px;align-items:center;padding:15px 30px 12px}
[data-paimind-workspace-blueprints-search]{position:relative;display:flex;align-items:center;color:var(--wb-faint)}
[data-paimind-workspace-blueprints-search]>svg{position:absolute;left:12px;pointer-events:none}
[data-paimind-workspace-blueprints-search] input{width:100%;height:40px;padding:0 13px 0 38px;border:1px solid var(--wb-line-strong);border-radius:11px;color:var(--wb-ink);background:var(--wb-surface);font:inherit;font-size:13px}
[data-paimind-workspace-blueprints-categories]{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:0;overflow-x:auto;padding:2px}
[data-paimind-workspace-blueprints-filter]{flex:none;min-height:34px;padding:6px 11px;border:1px solid var(--wb-line);border-radius:999px;color:var(--wb-muted);background:var(--wb-surface);font:inherit;font-size:12px;cursor:pointer}
[data-paimind-workspace-blueprints-filter][aria-pressed='true']{border-color:color-mix(in srgb,var(--wb-accent) 42%,var(--wb-line));color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 9%,var(--wb-surface))}
[data-paimind-workspace-blueprints-results]{padding:0 30px 9px;color:var(--wb-faint);font-size:11px;line-height:16px}
[data-paimind-workspace-blueprints-layout]{display:grid;grid-template-columns:minmax(280px,31%) minmax(0,1fr);gap:16px;min-height:0;flex:1;padding:0 30px 28px}
[data-paimind-workspace-blueprints-catalog],[data-paimind-workspace-blueprints-detail]{min-width:0;min-height:0;overflow:auto;border:1px solid var(--wb-line);border-radius:16px;background:color-mix(in srgb,var(--wb-surface) 96%,transparent);box-shadow:0 14px 36px rgba(31,52,85,.05)}
[data-paimind-workspace-blueprints-catalog]{display:grid;align-content:start;gap:8px;padding:10px}
[data-paimind-workspace-blueprints-card]{display:grid;grid-template-columns:auto minmax(0,1fr);gap:11px;width:100%;padding:13px;border:1px solid transparent;border-radius:12px;color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}
[data-paimind-workspace-blueprints-card]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(52,113,245,.06))}
[data-paimind-workspace-blueprints-card][aria-current='true']{border-color:color-mix(in srgb,var(--wb-accent) 35%,var(--wb-line));background:color-mix(in srgb,var(--wb-accent) 8%,var(--wb-surface))}
[data-paimind-workspace-blueprints-card-icon],[data-paimind-workspace-blueprints-detail-icon]{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:11px;color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 10%,var(--wb-surface))}
[data-paimind-workspace-blueprints-card-icon]{width:36px;height:36px}
[data-paimind-workspace-blueprints-card-copy]{display:grid;gap:4px;min-width:0}
[data-paimind-workspace-blueprints-card-copy] strong{overflow:hidden;color:var(--wb-ink);font-size:14px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-workspace-blueprints-card-copy] p{display:-webkit-box;margin:0;overflow:hidden;color:var(--wb-muted);font-size:12px;line-height:18px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
[data-paimind-workspace-blueprints-card-meta],[data-paimind-workspace-blueprints-tags]{display:flex;flex-wrap:wrap;gap:5px;color:var(--wb-faint);font-size:10px;line-height:16px}
[data-paimind-workspace-blueprints-tag]{display:inline-flex;align-items:center;min-height:22px;padding:2px 7px;border:1px solid var(--wb-line);border-radius:999px;background:var(--wb-surface)}
[data-paimind-workspace-blueprints-state]{display:grid;place-items:center;align-content:center;gap:10px;min-height:210px;padding:28px;color:var(--wb-muted);text-align:center}
[data-paimind-workspace-blueprints-state] p{max-width:420px;margin:0;font-size:13px;line-height:20px}
[data-paimind-workspace-blueprints-load-more]{min-height:36px;margin:4px;padding:7px 12px;border:1px solid var(--wb-line);border-radius:9px;color:var(--wb-muted);background:var(--wb-surface);font:inherit;cursor:pointer}
[data-paimind-workspace-blueprints-detail]{padding:22px}
[data-paimind-workspace-blueprints-detail-head]{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:start;padding-bottom:17px;border-bottom:1px solid var(--wb-line)}
[data-paimind-workspace-blueprints-detail-icon]{width:46px;height:46px}
[data-paimind-workspace-blueprints-detail-head] h2{margin:0;color:var(--wb-ink);font-size:21px;line-height:28px;letter-spacing:-.025em}
[data-paimind-workspace-blueprints-detail-head] p{margin:5px 0 7px;color:var(--wb-muted);font-size:13px;line-height:20px}
[data-paimind-workspace-blueprints-sections]{display:grid;gap:20px;padding-top:20px}
[data-paimind-workspace-blueprints-section]{display:grid;gap:9px}
[data-paimind-workspace-blueprints-section-head]{display:flex;align-items:center;justify-content:space-between;gap:12px}
[data-paimind-workspace-blueprints-section] h3{margin:0;color:var(--wb-ink);font-size:13px;line-height:20px}
[data-paimind-workspace-blueprints-section-head]>span{color:var(--wb-faint);font-size:10px}
[data-paimind-workspace-blueprints-link]{padding:0;border:0;color:var(--wb-accent);background:transparent;font:inherit;font-size:11px;cursor:pointer}
[data-paimind-workspace-blueprints-editor]{display:grid;grid-template-columns:minmax(190px,29%) minmax(0,1fr);min-height:360px;overflow:hidden;border:1px solid var(--wb-line);border-radius:12px;background:color-mix(in srgb,var(--wb-surface) 94%,transparent)}
[data-paimind-workspace-blueprints-tree]{display:grid;align-content:start;gap:2px;padding:8px;overflow:auto;border-right:1px solid var(--wb-line)}
[data-paimind-workspace-blueprints-tree]>p{padding:15px;color:var(--wb-muted);font-size:12px}
[data-paimind-workspace-blueprints-tree] button{display:grid;grid-template-columns:13px minmax(0,1fr);gap:6px;width:100%;padding:7px 8px 7px calc(8px + var(--wb-depth,0)*14px);border:0;border-radius:7px;color:var(--wb-muted);background:transparent;text-align:left;cursor:pointer}
[data-paimind-workspace-blueprints-tree] button[data-selected='true']{color:var(--wb-ink);background:color-mix(in srgb,var(--wb-accent) 9%,var(--wb-surface))}
[data-paimind-workspace-blueprints-tree] code{overflow:hidden;font:inherit;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-workspace-blueprints-source]{display:flex;flex-direction:column;min-width:0;min-height:0}
[data-paimind-workspace-blueprints-source-empty]{display:grid;place-items:start;align-content:center;gap:8px;min-height:100%;padding:24px;color:var(--wb-muted);font-size:12px}
[data-paimind-workspace-blueprints-source-empty] p{margin:0;line-height:19px}
[data-paimind-workspace-blueprints-source-head]{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--wb-line);color:var(--wb-faint);font-size:10px}
[data-paimind-workspace-blueprints-source-head] code{overflow:hidden;color:var(--wb-ink);text-overflow:ellipsis;white-space:nowrap}
[data-paimind-workspace-blueprints-source]>textarea{flex:1;min-height:280px;padding:13px;border:0;resize:none;color:var(--wb-ink);background:transparent;font:12px/19px ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}
[data-paimind-workspace-blueprints-source-actions]{display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--wb-line)}
[data-paimind-workspace-blueprints-new-entry]{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}
[data-paimind-workspace-blueprints-new-entry] input{min-width:0;height:38px;padding:0 11px;border:1px solid var(--wb-line-strong);border-radius:9px;color:var(--wb-ink);background:var(--wb-surface);font:inherit;font-size:12px}
[data-paimind-workspace-blueprints-inline-actions]{display:flex;align-items:center;gap:10px}
[data-paimind-workspace-blueprints-bindings]{display:grid;gap:7px}
[data-paimind-workspace-blueprints-binding]{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:10px 11px;border:1px solid var(--wb-line);border-radius:10px;background:color-mix(in srgb,var(--wb-surface) 92%,transparent)}
[data-paimind-workspace-blueprints-binding]>svg{margin-top:1px;color:var(--wb-accent)}
[data-paimind-workspace-blueprints-binding] span{display:grid;gap:2px;min-width:0}
[data-paimind-workspace-blueprints-binding] strong{color:var(--wb-ink);font-size:12px;line-height:18px}
[data-paimind-workspace-blueprints-binding] small{overflow-wrap:anywhere;color:var(--wb-muted);font-size:10px;line-height:16px}
[data-paimind-workspace-blueprints-note]{display:flex;gap:8px;align-items:flex-start;margin:0;padding:10px 11px;border-radius:10px;color:var(--wb-muted);background:color-mix(in srgb,var(--wb-accent) 7%,var(--wb-surface));font-size:11px;line-height:17px}
[data-paimind-workspace-blueprints-note] svg{flex:none;margin-top:1px;color:var(--wb-accent)}
[data-paimind-workspace-blueprints-compact-composition]{display:flex;align-items:center;gap:7px;margin:0;padding:9px 11px;border:1px solid var(--wb-line);border-radius:9px;color:var(--wb-muted);background:color-mix(in srgb,var(--wb-surface) 94%,transparent);font-size:11px;line-height:17px}
[data-paimind-workspace-blueprints-compact-composition] svg{flex:none;color:var(--wb-accent)}
[data-paimind-workspace-blueprints-actions]{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:9px;padding-top:4px}
[data-paimind-workspace-blueprints-copy-hint]{margin:0;color:var(--wb-faint);font-size:10px;line-height:16px;text-align:right}
[data-paimind-workspace-blueprints-feedback]{margin:0;color:var(--wb-muted);font-size:11px;line-height:17px}
[data-paimind-workspace-blueprints-feedback][role='alert']{padding:9px 11px;border:1px solid color-mix(in srgb,#d83a52 32%,var(--wb-line));border-radius:9px;color:#ad2940;background:color-mix(in srgb,#d83a52 7%,var(--wb-surface))}
[data-paimind-workspace-blueprints-feedback][role='status']{padding:9px 11px;border-radius:9px;color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 7%,var(--wb-surface))}
[data-paimind-workspace-blueprints-publish]{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:18px;min-height:0;flex:1;padding:22px 30px 28px;overflow:auto}
[data-paimind-workspace-blueprints-publish-head]{display:flex;justify-content:space-between;gap:18px;align-items:start}
[data-paimind-workspace-blueprints-publish-head] h2{margin:2px 0 4px;font-size:22px;line-height:29px}
[data-paimind-workspace-blueprints-publish-head] p:not([data-paimind-workspace-blueprints-eyebrow]){max-width:760px;margin:0;color:var(--wb-muted);font-size:12px;line-height:19px}
[data-paimind-workspace-blueprints-publish-grid]{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-height:0}
[data-paimind-workspace-blueprints-form],[data-paimind-workspace-blueprints-composer],[data-paimind-workspace-blueprints-composition-editor]{display:grid;align-content:start;gap:14px;padding:20px;border:1px solid var(--wb-line);border-radius:15px;background:var(--wb-surface)}
[data-paimind-workspace-blueprints-form] label,[data-paimind-workspace-blueprints-composer]>label,[data-paimind-workspace-blueprints-composition-editor]>label{display:grid;gap:6px;color:var(--wb-ink);font-size:11px;font-weight:700}
[data-paimind-workspace-blueprints] :is(input,textarea,select){color:var(--wb-ink)}
[data-paimind-workspace-blueprints-form] :is(input,textarea,select),[data-paimind-workspace-blueprints-composer]>label select,[data-paimind-workspace-blueprints-composition-editor]>label select{width:100%;min-height:40px;padding:9px 11px;border:1px solid var(--wb-line-strong);border-radius:9px;background:color-mix(in srgb,var(--wb-surface) 94%,var(--dsw-alias-bg-layer-1,#f6f8fb));font:inherit;font-size:12px;font-weight:400}
[data-paimind-workspace-blueprints-form] textarea{resize:vertical}
[data-paimind-workspace-blueprints-field-row]{display:grid;grid-template-columns:1fr 1fr;gap:10px}
[data-paimind-workspace-blueprints-source-choice]{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:end}
[data-paimind-workspace-blueprints-source-choice]>label{display:grid;gap:6px;color:var(--wb-ink);font-size:11px;font-weight:700}
[data-paimind-workspace-blueprints-source-choice]>span{align-self:center;padding-top:18px;color:var(--wb-faint);font-size:11px}
[data-paimind-workspace-blueprints-advanced]{border-top:1px solid var(--wb-line);padding-top:10px}
[data-paimind-workspace-blueprints-advanced] summary{width:max-content;color:var(--wb-muted);font-size:11px;cursor:pointer}
[data-paimind-workspace-blueprints-advanced]>div{margin-top:12px}
[data-paimind-workspace-blueprints-composer] h3{margin:0;font-size:15px}
[data-paimind-workspace-blueprints-composer]>div>p{margin:4px 0 0;color:var(--wb-muted);font-size:11px;line-height:17px}
[data-paimind-workspace-blueprints-composer][data-collapsed='true']{padding:14px 20px}
[data-paimind-workspace-blueprints-composer-summary]{display:flex;align-items:center;justify-content:space-between;gap:14px}
[data-paimind-workspace-blueprints-composer] fieldset,[data-paimind-workspace-blueprints-composition-editor] fieldset{display:grid;gap:7px;margin:0;padding:12px;border:1px solid var(--wb-line);border-radius:10px}
[data-paimind-workspace-blueprints-composer] legend,[data-paimind-workspace-blueprints-composition-editor] legend{padding:0 4px;color:var(--wb-ink);font-size:11px;font-weight:700}
[data-paimind-workspace-blueprints-choice]{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;padding:7px;border-radius:8px;cursor:pointer}
[data-paimind-workspace-blueprints-choice]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(52,113,245,.06))}
[data-paimind-workspace-blueprints-choice] input{margin-top:3px}
[data-paimind-workspace-blueprints-choice] span{display:grid;gap:1px;min-width:0}
[data-paimind-workspace-blueprints-choice] strong{font-size:11px}
[data-paimind-workspace-blueprints-choice] small{overflow-wrap:anywhere;color:var(--wb-muted);font-size:10px;line-height:15px}
[data-paimind-workspace-blueprints-choice-search]{position:relative;display:flex;align-items:center;color:var(--wb-faint)}
[data-paimind-workspace-blueprints-choice-search]>svg{position:absolute;left:10px;pointer-events:none}
[data-paimind-workspace-blueprints-choice-search] input{width:100%;height:34px;padding:0 10px 0 32px;border:1px solid var(--wb-line);border-radius:8px;color:var(--wb-ink);background:var(--wb-surface);font:inherit;font-size:11px}
[data-paimind-workspace-blueprints-choice-state]{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0;padding:8px 10px;border-radius:8px;color:var(--wb-muted);background:color-mix(in srgb,var(--wb-accent) 6%,var(--wb-surface));font-size:10px;line-height:16px}
[data-paimind-workspace-blueprints-choice-state][role='alert']{color:#ad2940;background:color-mix(in srgb,#d83a52 7%,var(--wb-surface))}
[data-paimind-workspace-blueprints-choice-state] button{flex:none;padding:0;border:0;color:var(--wb-accent);background:transparent;font:inherit;font-weight:650;cursor:pointer}
[data-paimind-workspace-blueprints-publish-actions]{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:end}
@media(max-width:1050px){[data-paimind-workspace-blueprints-layout]{grid-template-columns:minmax(250px,34%) minmax(0,1fr)}[data-paimind-workspace-blueprints-editor]{grid-template-columns:1fr;min-height:0}[data-paimind-workspace-blueprints-tree]{max-height:220px;border-right:0;border-bottom:1px solid var(--wb-line)}[data-paimind-workspace-blueprints-source]{min-height:340px}}
@media(max-width:820px){[data-paimind-workspace-blueprints-header]{padding:18px 18px 15px}[data-paimind-workspace-blueprints-head-actions]{align-items:flex-start;flex-direction:column-reverse}[data-paimind-workspace-blueprints-scopes]{padding:0 18px}[data-paimind-workspace-blueprints-toolbar]{grid-template-columns:1fr;padding:13px 18px}[data-paimind-workspace-blueprints-categories]{justify-content:flex-start}[data-paimind-workspace-blueprints-results]{padding:0 18px 8px}[data-paimind-workspace-blueprints-layout]{grid-template-columns:1fr;padding:0 18px 18px}[data-paimind-workspace-blueprints-catalog]{max-height:34vh}[data-paimind-workspace-blueprints-detail]{min-height:430px}[data-paimind-workspace-blueprints-publish]{padding:18px}[data-paimind-workspace-blueprints-publish-grid]{grid-template-columns:1fr}[data-paimind-workspace-blueprints-field-row],[data-paimind-workspace-blueprints-source-choice]{grid-template-columns:1fr}[data-paimind-workspace-blueprints-source-choice]>span{display:none}[data-paimind-workspace-blueprints-new-entry]{grid-template-columns:1fr}[data-paimind-workspace-blueprints-publish-actions]{grid-template-columns:1fr}[data-paimind-workspace-blueprints-composer-summary]{align-items:flex-start;flex-direction:column}}
`
