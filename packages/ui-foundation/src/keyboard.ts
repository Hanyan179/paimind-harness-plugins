/** Roving focus for a local, automatically activated tab list. No host DOM coupling. */
export function handlePaimindTabKey(event: {
  readonly key: string
  readonly currentTarget: HTMLButtonElement
  preventDefault(): void
}): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const group = event.currentTarget.closest('[role="tablist"]')
  if (group === null) return
  const tabs = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .filter(tab => tab.closest('[role="tablist"]') === group && !tab.disabled && tab.getAttribute('aria-disabled') !== 'true' && !tab.hidden)
  const current = tabs.indexOf(event.currentTarget)
  if (current < 0) return
  event.preventDefault()
  const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + offset + tabs.length) % tabs.length
  tabs[next]?.focus()
  tabs[next]?.click()
}
