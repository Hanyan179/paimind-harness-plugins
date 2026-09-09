import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { PaimindTooltip, installPaimindCompactNavigation, type PaimindNavigationEntry } from '@hansen/harness-compat/client-surface'
import { markHarnessClientStyle, type PaimindLocaleSource } from '@hansen/harness-compat'
import { PaimindAgentIcon, PaimindSkillIcon, PaimindConnectionIcon, PaimindTemplateIcon,
  PaimindMoreIcon, PaimindAttachmentIcon, PaimindSearchIcon, PaimindCloseIcon } from '@hansen/harness-compat/client-icons'
import type { PaimindExperienceModeController } from './index.js'

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
[data-paimind-resource-group]{margin:14px 0 6px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#7c8797)}
[data-paimind-resource-item]{display:flex;align-items:center;border-radius:11px;gap:4px;margin:3px -6px;padding:2px 6px}
[data-paimind-resource-item]:hover,[data-paimind-resource-item][data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
[data-paimind-resource-open]{display:flex;align-items:center;gap:12px;text-align:left;flex:1;min-width:0;padding:10px 2px}
[data-paimind-resource-icon]{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-resource-copy]{display:flex;flex-direction:column;min-width:0;gap:4px}
[data-paimind-resource-copy] strong{font-size:13px;font-weight:550}
[data-paimind-resource-copy] small{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary,#7c8797)}
[data-paimind-resource-empty]{padding:18px 0;color:var(--dsw-alias-label-secondary,#7c8797);font-size:13px}
[data-paimind-resource-navigation]{height:54px;isolation:isolate;z-index:20}
[data-paimind-resource-shell]{position:absolute;bottom:0;left:0;width:100%;max-width:calc(100vw - 24px);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:27px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,transparent);box-shadow:0 4px 16px rgba(16,32,56,.07),inset 0 1px 0 rgba(255,255,255,.15);backdrop-filter:blur(24px) saturate(1.2);-webkit-backdrop-filter:blur(24px) saturate(1.2);display:flex;flex-direction:column-reverse;transition:width var(--paimind-motion-slow,280ms) cubic-bezier(.22,1,.36,1),left var(--paimind-motion-slow,280ms) ease,box-shadow var(--paimind-motion-slow,280ms) ease}
[data-paimind-resource-navigation][data-open=true] [data-paimind-resource-shell]{position:fixed;bottom:var(--resource-bottom,48px);left:var(--resource-left,12px);width:var(--resource-width,360px);box-shadow:0 18px 56px rgba(16,32,56,.18)}
[data-paimind-morph-rail]{display:flex;align-items:center;gap:3px;padding:6px;min-height:50px}
[data-paimind-resource-navigation] [data-paimind-navigation-row]{display:flex;justify-content:center;gap:0;flex:1 1 36px;width:auto;min-width:30px;height:36px;margin:0;padding:0 7px;border-radius:20px;font-size:12px!important;transition:background var(--paimind-motion-fast,160ms) ease,flex var(--paimind-motion-slow,280ms) ease}
[data-paimind-navigation-row] svg{flex-shrink:0}
[data-paimind-resource-navigation] [data-paimind-navigation-row]>[data-paimind-morph-label]{flex:0 1 auto;max-width:0;opacity:0;white-space:nowrap;overflow:hidden;transition:max-width var(--paimind-motion-slow,280ms) cubic-bezier(.22,1,.36,1),opacity var(--paimind-motion-fast,160ms) ease,margin var(--paimind-motion-slow,280ms) ease}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-navigation-row][data-morph-selected=true]{flex-grow:2;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.10))}
[data-paimind-resource-navigation][data-wide=true] [data-morph-selected=true]>[data-paimind-morph-label]{max-width:48px;opacity:1;margin-left:6px}
[data-paimind-morph-search-trigger]{display:grid;place-items:center;flex:0 0 34px;width:34px;height:36px;border-radius:20px}
[data-paimind-morph-search-trigger]:hover,[data-paimind-morph-search-trigger][aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.10))}
[data-paimind-morph-reveal]{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows var(--paimind-motion-slow,280ms) cubic-bezier(.22,1,.36,1),opacity var(--paimind-motion-enter,180ms) ease,visibility var(--paimind-motion-slow,280ms)}
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-reveal]{grid-template-rows:1fr;opacity:1;visibility:visible}
[data-paimind-morph-clip]{min-height:0;overflow:hidden}
[data-paimind-resource-navigation] [data-paimind-resource-popover]{position:static;width:100%;max-width:none;max-height:min(560px,var(--resource-height,60vh));padding:20px 18px 10px;background:transparent;border:0;border-radius:25px 25px 0 0;box-shadow:none;overflow:auto}
[data-paimind-resource-heading]{margin-bottom:16px}
[data-paimind-resource-item]{transition:background var(--paimind-motion-fast,160ms) ease}
[data-paimind-resource-navigation][data-wide=false]{height:210px;width:36px}
[data-paimind-resource-navigation][data-wide=false]:not([data-open=true]) [data-paimind-resource-shell]{width:48px;left:-6px}
[data-paimind-resource-navigation][data-wide=false] [data-paimind-morph-rail]{flex-direction:column}
[data-paimind-resource-navigation][data-wide=false][data-open=true] [data-paimind-resource-shell]{width:var(--resource-width,360px)}
[data-paimind-resource-navigation][data-wide=false][data-open=true] [data-paimind-morph-rail]{flex-direction:row}


[data-paimind-morph-search]{display:flex;align-items:center;flex:0 0 34px;min-width:34px;border-radius:20px;transition:flex var(--paimind-motion-slow,240ms) cubic-bezier(.22,1,.36,1),background var(--paimind-motion-enter,180ms) ease}
[data-paimind-morph-search][data-expanded=true]{flex:1 1 160px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
[data-paimind-morph-input]{display:grid;grid-template-columns:0fr;min-width:0;width:0;opacity:0;visibility:hidden;transition:opacity var(--paimind-motion-enter,180ms) ease}
[data-paimind-morph-search][data-expanded=true] [data-paimind-morph-input]{display:block;flex:1;width:auto;opacity:1;visibility:visible}
[data-paimind-morph-input] input{display:block;min-width:0;width:100%;height:36px;padding:0 10px 0 0;background:transparent;border:0;outline:none;color:inherit;font:inherit;font-size:12px}
[data-paimind-resource-navigation] [data-paimind-morph-input] input:focus-visible{outline:none}
[data-paimind-morph-search]:focus-within{outline:2px solid var(--dsw-alias-state-business-primary,#447bf0);outline-offset:2px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-navigation-row][data-morph-selected]{flex:0 0 36px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-navigation-row]>[data-paimind-morph-label]{max-width:0;opacity:0;margin-left:0}
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail]{border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.10));margin:0 8px;padding:10px 0}

[data-paimind-utility]{position:relative;flex:0 0 34px!important}
[data-paimind-resource-navigation] [data-paimind-navigation-row]>[data-paimind-utility-icon]{display:grid;place-items:center;flex:none;overflow:visible}
[data-paimind-utility-icon] svg{width:17px;height:17px}
[data-paimind-utility-badge]{position:absolute;right:6px;top:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#447bf0)}

[data-paimind-resource-shell]{margin:0;padding:0;overflow:visible;top:auto;right:auto;color:inherit}
[data-paimind-resource-shell]::backdrop{background:transparent;pointer-events:none}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-navigation-row],
[data-paimind-resource-navigation][data-open=true] [data-paimind-navigation-row]{flex:1 0 auto!important;padding:0 2px;min-width:0}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-navigation-row]>[data-paimind-morph-label],
[data-paimind-resource-navigation][data-open=true] [data-paimind-navigation-row]>[data-paimind-morph-label]{max-width:60px;opacity:1;margin-left:4px}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-navigation-row][data-morph-selected=true]{background:transparent}
[data-paimind-resource-navigation][data-wide=false]{height:174px}
[data-paimind-utility-icon]{order:-1}
[data-paimind-library-search]{display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
[data-paimind-library-search] input{width:100%;min-width:0;height:38px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;outline:none}
[data-paimind-resource-navigation] [data-paimind-library-search] input:focus-visible{outline:none}
[data-paimind-library-search]:focus-within{outline:2px solid var(--dsw-alias-state-business-primary,#447bf0);outline-offset:2px}
/* Compact white capsule aligns with the sidebar content inset. */
[data-paimind-resource-navigation][data-open=false]{height:52px}
[data-paimind-resource-navigation][data-open=false] [data-paimind-resource-shell]{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:24px;box-shadow:0 2px 8px rgba(16,32,56,.045);backdrop-filter:none;-webkit-backdrop-filter:none;bottom:4px}
[data-paimind-resource-navigation][data-open=false] [data-paimind-morph-rail]{padding:5px 8px;gap:6px;min-height:46px}
[data-paimind-resource-navigation][data-open=false] [data-paimind-navigation-row]{height:36px;border-radius:9px;color:var(--dsw-alias-label-secondary,#687b90);flex:1 1 0!important}
[data-paimind-resource-navigation][data-open=false] [data-paimind-navigation-row]>[data-paimind-morph-label]{max-width:0;opacity:0;margin:0}
[data-paimind-resource-navigation][data-open=false] [data-paimind-navigation-row]:hover{color:var(--dsw-alias-label-primary,#202124)}
[data-paimind-resource-navigation][data-open=false] [data-paimind-navigation-row] svg{width:19px;height:19px}
[data-paimind-resource-navigation][data-wide=false][data-open=false]{height:174px}
[data-paimind-resource-navigation][data-wide=false][data-open=false] [data-paimind-resource-shell]{width:44px;left:-4px}
[data-paimind-resource-navigation][data-wide=false][data-open=false] [data-paimind-morph-rail]{padding:5px 3px;gap:4px}
[data-paimind-resource-navigation][data-wide=false][data-open=false] [data-paimind-navigation-row]{flex:0 0 36px!important}
[data-paimind-resource-navigation][data-open=true] [data-paimind-resource-shell]{border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 30px rgba(16,32,56,.12)}

/* A single wide launcher opens the menu; compact mode exposes the vertical rail. */
[data-paimind-resource-navigation]{transition:height var(--paimind-motion-slow,280ms) ease,width var(--paimind-motion-slow,280ms) ease}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-navigation-target]{display:none}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-resource-library-trigger]{justify-content:flex-start;padding:0 12px!important;gap:10px}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-resource-library-trigger]>[data-paimind-morph-label]{max-width:180px;opacity:1;margin:0;font-size:13px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail]{flex-direction:column;align-items:stretch;gap:2px;padding:8px 0;margin:0 14px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail] [data-paimind-resource-library-trigger],
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail] [data-paimind-navigation-target=agent-center]{display:none}
[data-paimind-resource-navigation][data-open=true] [data-paimind-navigation-row]{flex:0 0 38px!important;width:100%;justify-content:flex-start;padding:0 10px!important;border-radius:9px;gap:8px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-resource-popover]{max-height:min(510px,calc(var(--resource-height,60vh) - 50px))}

[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-copy] small{display:block;font-size:11px;line-height:1.3}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-icon]{width:24px;height:24px;border:0;background:transparent}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-open]{padding:6px 2px}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-group]{margin:8px 0 4px}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-popover]{padding:16px 18px 8px}

[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail]{flex-direction:row;gap:8px}
[data-paimind-resource-navigation][data-open=true] [data-paimind-morph-rail] [data-paimind-utility]{flex:1 1 0!important;justify-content:center;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-heading]{margin-bottom:12px}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-copy]{gap:2px}
[data-paimind-resource-navigation][data-wide=true] [data-paimind-resource-group]{margin:6px 0 2px;font-size:10px}

[data-paimind-launcher-identity],[data-paimind-launcher-chevron]{display:none}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-resource-library-trigger]{padding:0 6px!important;color:var(--dsw-alias-label-primary,#202124)}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-resource-library-trigger]>svg,
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-resource-library-trigger]>[data-paimind-morph-label]{display:none}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-launcher-identity]{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
[data-paimind-launcher-avatar]{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));color:inherit;font-size:10px;font-weight:500}
[data-paimind-launcher-name]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}
[data-paimind-resource-navigation][data-wide=true][data-open=false] [data-paimind-launcher-chevron]{display:block;flex:0 0 20px;color:var(--dsw-alias-label-secondary,#687b90);font-size:18px;text-align:center}

`

function ResourceIcon({ id }: { readonly id: string }): React.JSX.Element {
  const Icon = id === 'agent-center' ? PaimindAgentIcon : id === 'skill-center' ? PaimindSkillIcon
    : id === 'mcp-center' ? PaimindConnectionIcon : id === 'workspace-blueprints' ? PaimindTemplateIcon : PaimindAttachmentIcon
  return <Icon size={17} />
}


export function ResourceNavigation({ wide, locale }: {
  readonly wide: boolean; readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const language = useSyncExternalStore(locale.subscribe.bind(locale), () => locale.getLocale().active)
  const zh = language.startsWith('zh')
  const [entries, setEntries] = useState<readonly PaimindNavigationEntry[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const root = useRef<HTMLDivElement>(null)
  const library = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const bridge = useRef<ReturnType<typeof installPaimindCompactNavigation> | null>(null)
  useEffect(() => {
    if (!root.current) return
    const installed = installPaimindCompactNavigation(root.current, setEntries)
    bridge.current = installed
    const style = document.createElement('style'); style.textContent = STYLE; markHarnessClientStyle(style, '@hansen/visual-experience'); document.head.append(style)
    return () => { installed.dispose(); bridge.current = null; style.remove() }
  }, [])
  useLayoutEffect(() => {
    const shell = panel.current
    if (!shell || !open || typeof shell.showPopover !== 'function') return
    shell.setAttribute('popover', 'manual')
    shell.showPopover()
    return () => { shell.hidePopover(); shell.removeAttribute('popover') }
  }, [open])
  useEffect(() => { setOpen(false) }, [wide])
  const close = (): void => { setOpen(false); library.current?.focus() }
  useEffect(() => {
    const place = (): void => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(wide ? 320 : 360, window.innerWidth - 24)
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
      setPosition({ '--resource-width': `${width}px`, '--resource-left': `${open ? left : rect.left}px`, '--resource-bottom': `${window.innerHeight - rect.bottom}px`,
        '--resource-height': `${Math.max(100, rect.bottom - 80)}px` } as CSSProperties)
    }
    place()
    let frame = 0
    let focusFrame = 0
    if (open) {
      search.current?.focus({ preventScroll: true })
      frame = requestAnimationFrame(() => { focusFrame = requestAnimationFrame(() => { search.current?.focus({ preventScroll: true }) }) })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (root.current) observer?.observe(root.current)
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    window.addEventListener('resize', place); document.addEventListener('pointerdown', outside)
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); observer?.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside) }
  }, [open, wide])
  const activate = (entry: PaimindNavigationEntry): void => {
    if (bridge.current?.activate(entry.id)) { setOpen(false); library.current?.focus() }
  }
  const shortcuts = entries.filter(entry => entry.id === 'agent-center')
  const utilities = entries.filter(entry => entry.utility)
  const visible = entries.filter(entry => !entry.utility && `${entry.label} ${entry.description} ${entry.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [...new Set(visible.map(entry => entry.group || (zh ? '更多功能' : 'More')))]
  return <div ref={root} data-paimind-resource-navigation data-paimind-motion-scope data-wide={wide} data-open={open}>
    <div ref={panel} data-paimind-resource-shell style={position} id="paimind-resource-library" role={open ? "dialog" : undefined} aria-label={open ? (zh ? "资源库" : "Library") : undefined}
      onKeyDown={event => {
        if (!open) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])]
          const visibleControls = controls.filter(control => control.getClientRects().length > 0)
          const first = visibleControls[0]; const last = visibleControls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
    <div data-paimind-morph-rail onMouseLeave={() => { setHovered(null) }}>
    {shortcuts.map(entry => <PaimindTooltip key={entry.id} label={entry.label} side={wide ? "top" : "right"} delayMs={180} disabled={false}><button type="button" data-paimind-navigation-row data-paimind-navigation-target={entry.id}
      data-morph-selected={hovered === entry.id || (hovered === null && entry.active)}
      onMouseEnter={() => { setHovered(entry.id) }} onFocus={() => { setHovered(entry.id) }} onBlur={() => { setHovered(null) }}
      aria-label={entry.label} aria-current={entry.active ? 'page' : undefined} disabled={entry.disabled} onClick={() => { activate(entry) }}>
      <ResourceIcon id={entry.id} /><span data-paimind-morph-label>{entry.label}</span>
    </button></PaimindTooltip>)}
    <PaimindTooltip label={zh ? '资源库' : 'Library'} side={wide ? "top" : "right"} delayMs={180} disabled={false}><button ref={library} type="button" data-paimind-navigation-row data-paimind-resource-library-trigger aria-label={zh ? '资源库' : 'Library'}
      data-morph-selected={open || hovered === 'library' || (hovered === null && !entries.some(entry => entry.active))}
      onMouseEnter={() => { setHovered('library') }} onFocus={() => { setHovered('library') }} onBlur={() => { setHovered(null) }}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? 'paimind-resource-library' : undefined}
      aria-current={entries.some(entry => entry.active && !shortcuts.includes(entry)) ? 'page' : undefined}
      onClick={() => { setQuery(''); setOpen(!open) }}>
      <span data-paimind-launcher-identity ref={element => { if (element) bridge.current?.mountIdentity(element) }} /><span data-paimind-launcher-chevron aria-hidden="true">⌃</span><PaimindMoreIcon size={17} /><span data-paimind-morph-label>{zh ? (wide && !open ? '功能与设置' : '资源') : (wide && !open ? 'Features & settings' : 'Library')}</span>
    </button></PaimindTooltip>
    {utilities.map(entry => <PaimindTooltip key={entry.id} label={entry.id === 'settings' ? (zh ? '设置' : 'Settings') : (zh ? '通知' : 'Notifications')} side={wide ? 'top' : 'right'} delayMs={180}>
      <button type="button" data-paimind-navigation-row data-paimind-navigation-target={entry.id} data-paimind-utility={entry.id}
        aria-label={entry.id === 'settings' ? (zh ? '设置' : 'Settings') : (zh ? '通知' : 'Notifications')}
        disabled={entry.disabled} onClick={() => { setOpen(false); bridge.current?.activate(entry.id) }}>
        <span data-paimind-morph-label>{entry.id === 'settings' ? (zh ? '设置' : 'Settings') : (zh ? '通知' : 'Notifications')}</span>
        <span data-paimind-utility-icon ref={element => { if (element) bridge.current?.mountIcon(entry.id, element) }} />
        {entry.badge && <i data-paimind-utility-badge aria-label={zh ? `${entry.badge} 条未读通知` : `${entry.badge} unread notifications`} />}
      </button>
    </PaimindTooltip>)}
    </div>
    <div data-paimind-morph-reveal aria-hidden={!open} {...(!open ? { inert: '' } as Record<string, string> : {})}>
    <div data-paimind-morph-clip>
    <div data-paimind-resource-popover>
      <header data-paimind-resource-heading><h2>{zh ? '功能与设置' : 'Features & settings'}</h2><button type="button" aria-label={zh ? '关闭资源库' : 'Close library'} onClick={close}><PaimindCloseIcon size={14} /></button></header>
      <label data-paimind-library-search><PaimindSearchIcon size={17} /><input ref={search} type="search" tabIndex={open ? 0 : -1} disabled={!open} aria-label={zh ? '搜索资源入口' : 'Search resources'} placeholder={zh ? '搜索技能、连接、模板…' : 'Search skills, connections, templates…'} value={query} onChange={event => { setQuery(event.target.value) }} /></label>
      {groups.map(group => <section key={group} aria-label={group}><h3 data-paimind-resource-group>{group}</h3>
        {visible.filter(entry => (entry.group || (zh ? '更多功能' : 'More')) === group).map(entry => <div key={entry.id} data-paimind-resource-item data-active={entry.active}>
          <button type="button" data-paimind-resource-open disabled={entry.disabled} aria-label={`${zh ? '打开' : 'Open '}${entry.label}`} onClick={() => { activate(entry) }}>
            <span data-paimind-resource-icon><ResourceIcon id={entry.id} /></span><span data-paimind-resource-copy><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </button>
        </div>)}
      </section>)}
      {visible.length === 0 && <p data-paimind-resource-empty>{zh ? '没有找到匹配的入口' : 'No matching resources'}</p>}
    </div>
    </div>
    </div>
    </div>
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
