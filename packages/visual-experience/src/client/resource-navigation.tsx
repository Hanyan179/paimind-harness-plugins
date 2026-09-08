import { Component, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { PaimindTooltip, installPaimindCompactNavigation, type PaimindNavigationEntry } from '@paimind/harness-compat/client-surface'
import { markHarnessClientStyle, type PaimindLocaleSource } from '@paimind/harness-compat'
import { PaimindAgentIcon, PaimindSkillIcon, PaimindConnectionIcon, PaimindTemplateIcon,
  PaimindExtensionIcon, PaimindSearchIcon, PaimindCloseIcon, PaimindChevronRightIcon,
  PaimindPlusIcon, PaimindCheckIcon } from '@paimind/harness-compat/client-icons'
import type { PaimindExperienceModeController } from './index.js'

const PIN_KEY = 'paimind.visual-experience.navigation.pinned.v1'
const STYLE = `
[data-paimind-resource-navigation]{grid-column:1/-1;grid-row:1;width:100%;min-width:0;position:relative;color:var(--dsw-alias-label-primary,#202124)}
[data-paimind-resource-navigation] *{box-sizing:border-box}
[data-paimind-resource-navigation] button{color:inherit;font:inherit;border:0;background:transparent;cursor:pointer}
[data-paimind-resource-navigation] button:disabled{opacity:.45;cursor:default}
[data-paimind-resource-navigation] button:focus-visible,[data-paimind-resource-navigation] input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#447bf0);outline-offset:2px}
[data-paimind-navigation-row]{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 10px;margin:2px 0;border-radius:10px;text-align:left;font-size:14px!important}
[data-paimind-navigation-row]:hover,[data-paimind-navigation-row][aria-current=page],[data-paimind-navigation-row][aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.10))!important}
[data-paimind-navigation-row]>span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-resource-navigation][data-wide=false] [data-paimind-navigation-row]{width:36px;padding:0;justify-content:center}
[data-paimind-resource-popover]{position:fixed;z-index:1200;width:340px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:18px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:18px;box-shadow:0 16px 50px rgba(16,32,56,.18);text-align:left;overflow:auto;overscroll-behavior:contain}
[data-paimind-resource-heading]{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
[data-paimind-resource-heading] h2{font-size:16px;margin:0;font-weight:650}
[data-paimind-resource-heading] button{display:grid;place-items:center;width:26px;height:26px;border-radius:7px}
[data-paimind-resource-search]{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:10px;padding:9px 10px;margin-bottom:16px;color:var(--dsw-alias-label-secondary,#7c8797)}
[data-paimind-resource-search] input{width:100%;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,#202124);font:inherit;font-size:13px;outline:none}
[data-paimind-resource-search]:focus-within{outline:2px solid var(--dsw-alias-state-business-primary,#447bf0);outline-offset:2px}
[data-paimind-resource-navigation] [data-paimind-resource-search] input:focus-visible{outline:none}
[data-paimind-resource-group]{margin:14px 0 6px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#7c8797)}
[data-paimind-resource-item]{display:flex;align-items:center;border-radius:11px;gap:4px;margin:3px -6px;padding:2px 6px}
[data-paimind-resource-item]:hover,[data-paimind-resource-item][data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
[data-paimind-resource-open]{display:flex;align-items:center;gap:12px;text-align:left;flex:1;min-width:0;padding:10px 2px}
[data-paimind-resource-icon]{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-resource-copy]{display:flex;flex-direction:column;min-width:0;gap:4px}
[data-paimind-resource-copy] strong{font-size:13px;font-weight:550}
[data-paimind-resource-copy] small{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary,#7c8797)}
[data-paimind-resource-pin]{display:grid;place-items:center;width:28px;height:28px;flex-shrink:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))!important}
[data-paimind-resource-pin][aria-pressed=true]{color:var(--dsw-alias-state-business-primary,#447bf0)!important;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))!important}
[data-paimind-resource-hint]{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#7c8797);margin:14px 0 0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}
[data-paimind-resource-empty]{padding:18px 0;color:var(--dsw-alias-label-secondary,#7c8797);font-size:13px}
`

function ResourceIcon({ id }: { readonly id: string }): React.JSX.Element {
  const Icon = id === 'agent-center' ? PaimindAgentIcon : id === 'skill-center' ? PaimindSkillIcon
    : id === 'mcp-center' ? PaimindConnectionIcon : id === 'workspace-blueprints' ? PaimindTemplateIcon : PaimindExtensionIcon
  return <Icon size={17} />
}

function readPin(): string | null {
  try { return window.localStorage.getItem(PIN_KEY) } catch { return null }
}

export function ResourceNavigation({ wide, locale }: {
  readonly wide: boolean; readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const language = useSyncExternalStore(locale.subscribe.bind(locale), () => locale.getLocale().active)
  const zh = language.startsWith('zh')
  const [entries, setEntries] = useState<readonly PaimindNavigationEntry[]>([])
  const [pin, setPin] = useState(readPin)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<CSSProperties>({ left: 12, bottom: 60 })
  const root = useRef<HTMLDivElement>(null)
  const library = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const bridge = useRef<ReturnType<typeof installPaimindCompactNavigation> | null>(null)
  useEffect(() => {
    if (!root.current) return
    const installed = installPaimindCompactNavigation(root.current, setEntries)
    bridge.current = installed
    const style = document.createElement('style'); style.textContent = STYLE; markHarnessClientStyle(style, '@paimind/visual-experience'); document.head.append(style)
    const syncPin = (event: StorageEvent): void => { if (event.key === PIN_KEY || event.key === null) setPin(readPin()) }
    window.addEventListener('storage', syncPin)
    return () => { installed.dispose(); bridge.current = null; style.remove(); window.removeEventListener('storage', syncPin) }
  }, [])
  const close = (): void => { setOpen(false); library.current?.focus() }
  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = library.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(340, window.innerWidth - 24)
      const beside = rect.right + 12 + width <= window.innerWidth - 12
      const bottom = Math.max(12, window.innerHeight - (beside ? rect.bottom : rect.top - 8))
      setPosition({ left: beside ? rect.right + 12 : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        bottom, maxHeight: Math.max(80, window.innerHeight - bottom - 12) })
    }
    place(); search.current?.focus()
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    window.addEventListener('resize', place); document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside) }
  }, [open, wide])
  const activate = (entry: PaimindNavigationEntry): void => {
    if (bridge.current?.activate(entry.id)) { setOpen(false); library.current?.focus() }
  }
  const togglePin = (id: string): void => {
    const next = pin === id ? null : id
    setPin(next)
    try { if (next === null) window.localStorage.removeItem(PIN_KEY); else window.localStorage.setItem(PIN_KEY, next) } catch { /* Current-tab preference still works. */ }
  }
  const shortcuts = entries.filter(entry => entry.id === 'agent-center' || entry.id === pin)
    .sort((a, b) => Number(b.id === 'agent-center') - Number(a.id === 'agent-center')).slice(0, 2)
  const visible = entries.filter(entry => `${entry.label} ${entry.description} ${entry.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [...new Set(visible.map(entry => entry.group || (zh ? '更多功能' : 'More')))]
  return <div ref={root} data-paimind-resource-navigation data-wide={wide}>
    {shortcuts.map(entry => <PaimindTooltip key={entry.id} label={entry.label} side="right" delayMs={300} disabled={wide}><button type="button" data-paimind-navigation-row data-paimind-navigation-target={entry.id}
      aria-label={entry.label} aria-current={entry.active ? 'page' : undefined} disabled={entry.disabled} onClick={() => { activate(entry) }}>
      <ResourceIcon id={entry.id} />{wide && <span>{entry.label}</span>}
    </button></PaimindTooltip>)}
    <PaimindTooltip label={zh ? '资源库' : 'Library'} side="right" delayMs={300} disabled={wide || open}><button ref={library} type="button" data-paimind-navigation-row data-paimind-resource-library-trigger aria-label={zh ? '资源库' : 'Library'}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? 'paimind-resource-library' : undefined}
      aria-current={entries.some(entry => entry.active && !shortcuts.includes(entry)) ? 'page' : undefined}
      onClick={() => { setQuery(''); setOpen(!open) }}>
      <PaimindExtensionIcon size={17} />{wide && <><span>{zh ? '资源库' : 'Library'}</span><PaimindChevronRightIcon size={12} /></>}
    </button></PaimindTooltip>
    {open && <div ref={panel} id="paimind-resource-library" role="dialog" aria-label={zh ? '资源库' : 'Library'} data-paimind-resource-popover style={position}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])]
          const first = controls[0]; const last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header data-paimind-resource-heading><h2>{zh ? '资源库' : 'Library'}</h2><button type="button" aria-label={zh ? '关闭资源库' : 'Close library'} onClick={close}><PaimindCloseIcon size={14} /></button></header>
      <label data-paimind-resource-search><PaimindSearchIcon size={15} /><input ref={search} type="search" aria-label={zh ? '搜索资源入口' : 'Search resources'} placeholder={zh ? '搜索技能、连接、模板…' : 'Search skills, connections, templates…'} value={query} onChange={event => { setQuery(event.target.value) }} /></label>
      {groups.map(group => <section key={group} aria-label={group}><h3 data-paimind-resource-group>{group}</h3>
        {visible.filter(entry => (entry.group || (zh ? '更多功能' : 'More')) === group).map(entry => <div key={entry.id} data-paimind-resource-item data-active={entry.active}>
          <button type="button" data-paimind-resource-open disabled={entry.disabled} aria-label={`${zh ? '打开' : 'Open '}${entry.label}`} onClick={() => { activate(entry) }}>
            <span data-paimind-resource-icon><ResourceIcon id={entry.id} /></span><span data-paimind-resource-copy><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </button>
          {entry.id !== 'agent-center' && <button type="button" data-paimind-resource-pin aria-pressed={pin === entry.id} aria-label={pin === entry.id ? (zh ? `取消固定${entry.label}` : `Unpin ${entry.label}`) : (zh ? `固定${entry.label}到侧边栏` : `Pin ${entry.label} to sidebar`)} title={pin === entry.id ? (zh ? '取消固定' : 'Unpin') : (zh ? '固定为常用入口' : 'Pin shortcut')} onClick={() => { togglePin(entry.id) }}>{pin === entry.id ? <PaimindCheckIcon size={13} /> : <PaimindPlusIcon size={13} />}</button>}
        </div>)}
      </section>)}
      {visible.length === 0 && <p data-paimind-resource-empty>{zh ? '没有找到匹配的入口' : 'No matching resources'}</p>}
      <p data-paimind-resource-hint>{zh ? '智能体常驻侧边栏，还可以固定一个常用入口。' : 'Agents stay in the sidebar. Pin one more shortcut here.'}</p>
    </div>}
  </div>
}

class NavigationBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function ResourceNavigationSlot(props: { readonly wide: boolean; readonly locale: PaimindLocaleSource; readonly mode: PaimindExperienceModeController }): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(props.mode.subscribe, props.mode.getSnapshot)
  return snapshot.mode === 'paimind' ? <NavigationBoundary><ResourceNavigation wide={props.wide} locale={props.locale} /></NavigationBoundary> : null
}
