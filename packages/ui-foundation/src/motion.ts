/** Presentation preference only. Persistence and lifecycle belong to the source plugin. */
export const PAIMIND_MOTION_PREFERENCES = ['system', 'on', 'off'] as const
export type PaimindMotionPreference = typeof PAIMIND_MOTION_PREFERENCES[number]
export const PAIMIND_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const PREFERENCE_ATTRIBUTE = 'data-paimind-motion-preference'
const EFFECTIVE_ATTRIBUTE = 'data-paimind-motion'

export function resolvePaimindMotion(preference: PaimindMotionPreference, systemReduced: boolean): boolean {
  return preference === 'on' || (preference === 'system' && !systemReduced)
}

/** Works across independently bundled clients; the DOM projection is never a second store. */
export function readPaimindMotion(doc: Document = document, win: Window = window): boolean {
  const value = doc.documentElement.getAttribute(PREFERENCE_ATTRIBUTE)
  const preference = value === 'on' || value === 'off' ? value : 'system'
  return resolvePaimindMotion(preference, win.matchMedia?.(PAIMIND_MOTION_QUERY).matches ?? false)
}

export function subscribePaimindMotion(listener: () => void, doc: Document = document, win: Window = window): () => void {
  const media = win.matchMedia?.(PAIMIND_MOTION_QUERY)
  const observer = new MutationObserver(listener)
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: [PREFERENCE_ATTRIBUTE] })
  media?.addEventListener('change', listener)
  return () => { observer.disconnect(); media?.removeEventListener('change', listener) }
}

/** Install exactly once in visual-experience; all other plugins use read/subscribe. */
export function installPaimindMotionPreference(doc: Document = document, win: Window = window): {
  set(preference: PaimindMotionPreference): void
  dispose(): void
} {
  const root = doc.documentElement
  const previousPreference = root.getAttribute(PREFERENCE_ATTRIBUTE)
  const previousEffective = root.getAttribute(EFFECTIVE_ATTRIBUTE)
  const media = win.matchMedia?.(PAIMIND_MOTION_QUERY)
  let preference: PaimindMotionPreference = 'system'
  let effective = 'on'
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    effective = resolvePaimindMotion(preference, media?.matches ?? false) ? 'on' : 'off'
    root.setAttribute(PREFERENCE_ATTRIBUTE, preference)
    root.setAttribute(EFFECTIVE_ATTRIBUTE, effective)
  }
  media?.addEventListener('change', sync)
  sync()
  return {
    set(value) { preference = value; sync() },
    dispose() {
      if (disposed) return
      disposed = true
      media?.removeEventListener('change', sync)
      for (const [attribute, owned, previous] of [
        [PREFERENCE_ATTRIBUTE, preference, previousPreference],
        [EFFECTIVE_ATTRIBUTE, effective, previousEffective],
      ] as const) {
        if (root.getAttribute(attribute) !== owned) continue
        if (previous === null) root.removeAttribute(attribute)
        else root.setAttribute(attribute, previous)
      }
    },
  }
}

/** Only durations explicitly consumed by PAIMind change; host/content animations stay owned. */
export const PAIMIND_MOTION_CSS: string = `
:where([data-paimind-ui-scope], [data-paimind-motion-scope]) {
  --paimind-motion-fast: 160ms;
  --paimind-motion-enter: 180ms;
  --paimind-motion-slow: 240ms;
  --paimind-motion-loop: 1800ms;
  --paimind-motion-iterations: infinite;
}
[data-paimind-motion='off'] :where([data-paimind-ui-scope], [data-paimind-motion-scope]) {
  --paimind-motion-fast: 0ms;
  --paimind-motion-enter: 0ms;
  --paimind-motion-slow: 0ms;
  --paimind-motion-loop: 0ms;
  --paimind-motion-iterations: 0;
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-paimind-motion='on']) :where([data-paimind-ui-scope], [data-paimind-motion-scope]) {
    --paimind-motion-fast: 0ms;
    --paimind-motion-enter: 0ms;
    --paimind-motion-slow: 0ms;
    --paimind-motion-loop: 0ms;
  --paimind-motion-iterations: 0;
  }
}
`
