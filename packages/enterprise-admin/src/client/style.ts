import { PAIMIND_UI_FOUNDATION_CSS } from '@paimind/ui-foundation'

const STYLE_ID = '@paimind/enterprise-admin'
const CSS = `${PAIMIND_UI_FOUNDATION_CSS}
[data-paimind-enterprise]{padding:0;max-width:100%;font:inherit;container-type:inline-size}
[data-paimind-enterprise] h2{margin:0 0 6px;font-size:16px;line-height:24px;font-weight:600}
[data-paimind-enterprise] h3{margin:0;font-size:14px;line-height:22px;font-weight:500}
[data-paimind-enterprise] p{margin:6px 0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
[data-paimind-enterprise] header{margin-bottom:16px}
[data-paimind-enterprise] form{display:grid;gap:12px;margin:16px 0}
[data-paimind-enterprise] label{display:grid;gap:6px;font-size:13px}
[data-paimind-enterprise] input,[data-paimind-enterprise] textarea,[data-paimind-enterprise] select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:36px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,var(--paimind-ui-border));border-radius:var(--paimind-ui-radius-sm);background:var(--paimind-ui-panel);color:inherit;font:inherit}
[data-paimind-enterprise] [data-enterprise-source]{white-space:pre-wrap}
[data-paimind-enterprise] fieldset{border:0;margin:0;padding:0;display:grid;gap:12px}
[data-paimind-enterprise] [data-enterprise-checkbox]{display:flex;align-items:flex-start;gap:8px;overflow-wrap:anywhere}
[data-paimind-enterprise] [data-enterprise-checkbox] input{flex:none;width:18px;height:18px;min-height:18px;padding:0;margin:2px 0;accent-color:var(--paimind-ui-accent)}
[data-paimind-enterprise] button{display:inline-flex;align-items:center;justify-content:center;gap:6px;justify-self:start;border-radius:999px;color:var(--paimind-ui-text)}
[data-paimind-enterprise] [role=alert]{color:var(--paimind-ui-danger)}
[data-paimind-enterprise] [data-enterprise-row]{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--paimind-ui-border);overflow-wrap:anywhere}
[data-paimind-enterprise] [data-enterprise-row]>div{min-width:0}
[data-paimind-enterprise] [data-enterprise-list]{list-style:none;padding:0;margin:16px 0}
[data-paimind-enterprise] [data-enterprise-form]{padding:16px 0;border-block:1px solid var(--paimind-ui-border)}
[data-paimind-enterprise] legend{font-size:14px;font-weight:500;margin-bottom:12px}
[data-paimind-enterprise] [data-enterprise-actions]{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
[data-paimind-enterprise] [data-enterprise-toolbar]{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
[data-paimind-enterprise] [data-enterprise-toolbar] [data-enterprise-actions]{margin:0}
[data-paimind-enterprise] [data-enterprise-navigation]{margin:0 0 20px}
[data-paimind-enterprise] [data-enterprise-navigation] button{border-color:transparent;background:transparent;color:var(--paimind-ui-muted)}
[data-paimind-enterprise] [data-enterprise-navigation] button[aria-pressed=true]{background:var(--dsw-specific-sidebar-nav-item-active,var(--paimind-ui-subtle));color:var(--paimind-ui-text);font-weight:600}
[data-paimind-enterprise] [data-enterprise-feedback]:empty{display:none}
[data-paimind-enterprise] [data-enterprise-audit]{display:grid;gap:4px;padding:12px 0;border-bottom:1px solid var(--paimind-ui-border);font-size:12px;overflow-wrap:anywhere}
[data-paimind-enterprise] summary{cursor:pointer;font-size:12px}
[data-paimind-enterprise] summary:focus-visible{outline:2px solid var(--paimind-ui-accent);outline-offset:2px}
@container(max-width:360px){[data-paimind-enterprise] [data-enterprise-row]{align-items:flex-start;flex-direction:column}}
`
export function installStyle(): () => void {
  // Own only the node acquired by this activation; never remove a peer's style.
  if (document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID; style.dataset.paimindPlugin = STYLE_ID; style.textContent = CSS
  document.head.append(style)
  return () => style.remove()
}
