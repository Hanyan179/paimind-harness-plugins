import { PAIMIND_UI_FOUNDATION_CSS } from '@hansen/ui-foundation'
export const CONTEXT_LIBRARY_CSS =
  PAIMIND_UI_FOUNDATION_CSS +
  `
[data-paimind-product-surface=context-library]{position:absolute;inset:0;z-index:80;overflow:auto;pointer-events:auto;background:var(--dsw-alias-bg-base,#f5f6fa)}
[data-paimind-product-trigger=context-library]{display:flex;align-items:center;gap:8px;border:0;background:none;color:inherit;padding:9px;cursor:pointer;width:100%;font:inherit}
[data-context-library],[data-context-connections],[data-context-session],.cl-dialog,.cl-menu{font:14px/1.5 system-ui;color:var(--paimind-ui-text,var(--dsw-alias-label-primary,#242833))}
[data-context-library]{height:100%;min-height:500px;display:flex;flex-direction:column;background:var(--paimind-ui-panel)}
:is([data-context-library],.cl-dialog,.cl-menu,[data-context-connections],[data-context-session]) :is(button,input,select,textarea){font:inherit;color:inherit;box-sizing:border-box}
:is([data-context-library],.cl-dialog,[data-context-connections],[data-context-session]) button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:7px 12px;border:1px solid var(--paimind-ui-border,#d7dbe4);border-radius:8px;background:var(--paimind-ui-panel,#fff);cursor:pointer;white-space:nowrap}
:is([data-context-library],.cl-dialog,.cl-menu,[data-context-connections]) button:disabled{cursor:default;opacity:.45}
:is([data-context-library],.cl-dialog) button:not(:disabled):hover{background:var(--paimind-ui-subtle)}
:is([data-context-library],.cl-dialog,.cl-menu) svg{flex-shrink:0}
:is([data-context-library],.cl-dialog) button.cl-primary{background:var(--paimind-ui-accent,#3471f5);color:#fff;border-color:transparent}
:is([data-context-library],.cl-dialog) button.cl-primary:not(:disabled):hover{filter:brightness(.94)}
:is([data-context-library],.cl-dialog) button.cl-icon-button{width:36px;padding:7px;border-color:transparent;background:transparent}
:is([data-context-library],.cl-dialog) button.cl-subtle{border-color:transparent;background:transparent;color:var(--paimind-ui-muted)}
[data-context-library] h1,[data-context-library] h2,[data-context-library] h3,.cl-dialog h2{margin:0;line-height:1.35;letter-spacing:-.02em}
[data-context-library] h1{font-size:24px;font-weight:650}
[data-context-library] h2{font-size:21px;font-weight:650}
[data-context-library] h3{font-size:16px;font-weight:600}
[data-context-library] p{margin:8px 0;color:var(--paimind-ui-muted);line-height:1.65}
.cl-page-header{display:flex;align-items:center;justify-content:space-between;padding:25px 30px 21px;border-bottom:1px solid var(--paimind-ui-border);flex-shrink:0}
.cl-page-header p{margin:5px 0 0;font-size:13px}
.cl-layout{display:grid;grid-template-columns:216px minmax(0,1fr);flex:1;min-height:0}
.cl-sidebar{display:flex;flex-direction:column;min-width:0;overflow:auto;padding:24px 14px;background:var(--paimind-ui-canvas);border-right:1px solid var(--paimind-ui-border)}
.cl-sidebar-heading{display:flex;align-items:center;gap:8px;padding:0 10px;margin-bottom:14px;color:var(--paimind-ui-muted)}
.cl-sidebar-heading h2{font-size:12px;font-weight:600;letter-spacing:.04em}
.cl-sidebar-heading>span{font-size:12px}
[data-context-library] .cl-new-collection{justify-content:flex-start;background:transparent;margin:0 0 14px;min-height:38px;border-style:dashed;color:var(--paimind-ui-muted)}
.cl-collections{display:grid;gap:4px}
[data-context-library] .cl-collection{border:0;background:transparent;justify-content:flex-start;text-align:left;min-height:42px;padding:10px;white-space:normal}
.cl-collection span{min-width:0;overflow-wrap:anywhere}
[data-context-library] .cl-collection[aria-current=page]{color:var(--paimind-ui-accent);background:color-mix(in srgb,var(--paimind-ui-accent) 9%,transparent);font-weight:600}
.cl-sidebar-note{margin-top:auto!important;padding:32px 10px 0;font-size:12px}
.cl-content{padding:28px 32px;min-width:0;overflow:auto}
.cl-collection-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:23px}
.cl-collection-heading{display:flex;align-items:center;gap:13px;min-width:0}
.cl-collection-heading>div{min-width:0}
.cl-collection-heading h2{overflow-wrap:anywhere}
.cl-collection-heading p{font-size:13px;margin:4px 0 0;max-width:660px;overflow-wrap:anywhere}
.cl-folder-emblem{width:46px;height:46px;flex:0 0 auto;display:grid;place-items:center;border-radius:11px;color:var(--paimind-ui-accent);background:color-mix(in srgb,var(--paimind-ui-accent) 8%,transparent)}
.cl-tabs{display:flex;gap:24px;border-bottom:1px solid var(--paimind-ui-border);margin-bottom:22px}
[data-context-library] .cl-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:9px 0 13px;color:var(--paimind-ui-muted)}
[data-context-library] .cl-tabs button[aria-current=page]{border-bottom-color:var(--paimind-ui-accent);color:var(--paimind-ui-text);font-weight:600}
.cl-count{font-size:11px;min-width:20px;padding:1px 5px;border-radius:5px;background:var(--paimind-ui-subtle);color:var(--paimind-ui-muted)}
.cl-file-toolbar{display:flex;align-items:center;gap:16px;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap}
.cl-file-actions{display:flex;gap:8px}
.cl-search{display:flex;align-items:center;gap:9px;flex:0 1 370px;min-width:220px;height:38px;padding-left:11px;border:1px solid var(--paimind-ui-border);border-radius:8px;color:var(--paimind-ui-muted);background:var(--paimind-ui-panel)}
.cl-search input{padding:7px 0;min-width:0;width:100%;outline:0;border:0;background:transparent}
.cl-search:focus-within{outline:2px solid var(--paimind-ui-accent);outline-offset:2px}
[data-context-library] .cl-search .cl-search-submit{border:0;border-radius:0 8px 8px 0;background:transparent;min-height:34px;padding:7px 10px;font-size:12px}
.cl-location-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 12px;min-height:28px}
.cl-location-row small{white-space:nowrap;color:var(--paimind-ui-muted);font-size:12px}
.cl-breadcrumbs,.cl-breadcrumbs>span{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap;color:var(--paimind-ui-muted);font-size:12px}
[data-context-library] .cl-breadcrumbs button{padding:2px 0;min-height:26px;border:0;border-radius:0;background:transparent;color:var(--paimind-ui-muted);font-size:12px}
[data-context-library] .cl-breadcrumbs button:disabled{opacity:1;color:var(--paimind-ui-text)}
.cl-breadcrumbs strong{font-weight:500;color:var(--paimind-ui-text);overflow-wrap:anywhere}
.cl-table{width:100%;border-collapse:collapse;text-align:left;table-layout:fixed}
.cl-table th{height:38px;padding:8px 12px;font-size:12px;font-weight:500;color:var(--paimind-ui-muted);background:var(--paimind-ui-canvas);border-top:1px solid var(--paimind-ui-border);border-bottom:1px solid var(--paimind-ui-border)}
.cl-table th:first-child{border-radius:6px 0 0 0}
.cl-table th:last-child{border-radius:0 6px 0 0}
.cl-table td{padding:9px 12px;border-bottom:1px solid var(--paimind-ui-border);font-size:13px;color:var(--paimind-ui-muted);vertical-align:middle;overflow-wrap:anywhere}
.cl-table tr:hover td{background:color-mix(in srgb,var(--paimind-ui-canvas) 55%,transparent)}
.cl-table th:first-child{width:auto}
.cl-table th:nth-child(2){width:105px}
.cl-table th:nth-child(3){width:90px}
.cl-file-table th:last-child{width:50px}
[data-context-library] .cl-filename{display:flex;align-items:center;gap:10px;min-width:0;width:100%;text-align:left;justify-content:flex-start;padding:7px 0;min-height:38px;border:0;background:transparent}
.cl-filename>svg{color:var(--paimind-ui-muted)}
.cl-filename span{display:grid;gap:3px;min-width:0}
.cl-filename strong{color:var(--paimind-ui-text);font-weight:500;white-space:normal;overflow-wrap:anywhere}
.cl-filename small{color:var(--paimind-ui-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-row-actions{text-align:right}
.cl-menu{position:fixed;z-index:1000;width:196px;padding:5px;border:1px solid var(--paimind-ui-border,#d7dbe4);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--paimind-ui-shadow-overlay,0 10px 36px #0002)}
.cl-menu button{display:flex;align-items:center;width:100%;min-height:36px;padding:8px 11px;text-align:left;border:0;border-radius:6px;background:transparent;cursor:pointer}
.cl-menu button:hover,.cl-menu button:focus{background:var(--paimind-ui-subtle);outline:none}
.cl-menu .cl-danger{color:var(--paimind-ui-danger)}
.cl-empty{padding:64px 20px;text-align:center;color:var(--paimind-ui-muted)}
.cl-empty>svg{margin:0 auto 14px;opacity:.7}
.cl-empty h3{color:var(--paimind-ui-text)}
.cl-empty p{font-size:13px;margin:8px 0 20px}
.cl-feedback{padding:10px 13px;margin:12px 0;border:1px solid var(--paimind-ui-border);border-radius:8px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--paimind-ui-muted)}
.cl-error,.cl-dialog [role=alert]{color:var(--paimind-ui-danger);background:color-mix(in srgb,var(--paimind-ui-danger) 6%,var(--paimind-ui-panel))}
.cl-usage>h3{margin:8px 0}
.cl-usage>p{font-size:13px;margin-bottom:22px}
.cl-usage-name{display:flex;align-items:center;gap:10px;color:var(--paimind-ui-text)}
.cl-usage-name strong{font-weight:500}
.cl-usage-name svg{color:var(--paimind-ui-muted)}
.cl-access{display:inline-flex;align-items:center;border:1px solid var(--paimind-ui-border);background:var(--paimind-ui-canvas);border-radius:5px;padding:2px 7px;color:var(--paimind-ui-muted);font-size:12px}
.cl-access-write{background:color-mix(in srgb,var(--paimind-ui-accent) 8%,transparent);color:var(--paimind-ui-accent)}
.cl-results{display:grid;gap:8px}
[data-context-library] .cl-result{width:100%;text-align:left;justify-content:flex-start;align-items:flex-start;white-space:normal;padding:16px;gap:12px}
.cl-result>span{display:grid;gap:4px;flex:1;min-width:0}
.cl-result strong{font-weight:600}
.cl-result small{color:var(--paimind-ui-muted);font-size:12px;overflow-wrap:anywhere}
.cl-result p{font-size:13px;margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.cl-document{border:1px solid var(--paimind-ui-border);border-radius:10px;overflow:hidden}
.cl-document>header{padding:18px 20px;border-bottom:1px solid var(--paimind-ui-border);display:flex;align-items:center;gap:16px;justify-content:space-between}
.cl-document header small{font-size:12px;color:var(--paimind-ui-muted)}
.cl-document-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.cl-document-description{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--paimind-ui-border);font-size:12px;color:var(--paimind-ui-muted)}
.cl-document-description input{flex:1;min-width:0;border:0;background:transparent;padding:5px 0}
.cl-document>textarea{display:block;width:100%;min-height:360px;resize:vertical;border:0;background:var(--paimind-ui-panel);color:var(--paimind-ui-text);font:14px/1.8 ui-monospace,monospace;padding:24px}
.cl-document>p{padding:0 20px}
.cl-document>footer{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--paimind-ui-border);color:var(--paimind-ui-muted);font-size:12px}
.cl-binary{padding:48px 24px;text-align:center;color:var(--paimind-ui-muted)}
.cl-binary>svg{margin:auto auto 16px}
.cl-binary img{max-width:100%;max-height:65vh;object-fit:contain}
.cl-view-hint{font-size:13px;margin-bottom:18px!important}
.cl-dialog{width:min(520px,calc(100vw - 40px));max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--paimind-ui-border,#d7dbe4);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--paimind-ui-shadow-overlay)}
.cl-dialog::backdrop{background:#11182750}
.cl-dialog>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.cl-dialog h2{font-size:19px;font-weight:600}
.cl-dialog label{display:grid;gap:7px;margin:16px 0;font-size:13px;font-weight:500}
.cl-dialog label small{font-weight:400;color:var(--paimind-ui-muted)}
.cl-dialog input,.cl-dialog textarea{width:100%;padding:10px 12px;border:1px solid var(--paimind-ui-border);border-radius:8px;background:var(--paimind-ui-panel)}
.cl-dialog textarea{min-height:94px;resize:vertical}
.cl-dialog footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:24px}
.cl-dialog p{color:var(--paimind-ui-muted);font-size:13px}
.cl-move-path{display:flex;align-items:center;gap:12px;margin:16px 0}
.cl-move-path span{overflow-wrap:anywhere}
.cl-folder-picker{min-height:120px;max-height:260px;overflow:auto;border-block:1px solid var(--paimind-ui-border);padding:8px 0}
.cl-folder-picker button{display:flex;justify-content:flex-start;width:100%;border:0;background:transparent}
.cl-folder-picker p{text-align:center;padding:24px}
.cl-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
[data-context-connections] select{max-width:140px;min-height:36px;padding:6px 10px;border:1px solid var(--paimind-ui-border,#d7dbe4);border-radius:7px;background:var(--paimind-ui-panel,#fff)}
.cl-connection{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--paimind-ui-border,#e5e7eb)}
[data-context-connections] h3{font-size:15px;margin:16px 0 6px}
[data-context-connections] p{font-size:13px;color:var(--dsw-alias-label-secondary,#65718a)}
[data-context-session]{padding:20px}
[data-context-session] article{padding:12px 0;border-bottom:1px solid var(--paimind-ui-border,#d7dbe4)}
@media(max-width:1100px){.cl-layout{grid-template-columns:180px minmax(0,1fr)}.cl-content{padding:22px}.cl-collection-header{flex-wrap:wrap;gap:8px}.cl-collection-header>.cl-subtle{margin-left:59px}.cl-document>header{flex-wrap:wrap}.cl-type-column{display:none}}
@media(max-width:760px){[data-context-library]{height:auto;min-height:100%}.cl-layout{grid-template-columns:1fr}.cl-sidebar{border-right:0;border-bottom:1px solid var(--paimind-ui-border);padding:14px 18px}.cl-sidebar-heading{display:none}.cl-collections{display:flex;overflow:auto}.cl-collection{flex-shrink:0}.cl-new-collection{align-self:flex-start}.cl-sidebar-note{display:none}.cl-page-header{padding:20px}.cl-content{padding:20px 16px}.cl-file-toolbar{gap:12px}.cl-search{flex:1 1 100%}.cl-file-actions{margin-left:auto}.cl-tabs{gap:18px}.cl-document-actions{flex-wrap:wrap}.cl-document-description{align-items:flex-start;flex-direction:column;gap:4px}.cl-document-description input{width:100%}}
`
