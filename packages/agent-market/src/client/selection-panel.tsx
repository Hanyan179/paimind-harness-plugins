import type { ReactNode } from 'react'

/** Shared presentation only; Skill and connection selection retain separate owners. */
export function AgentSelectionPanel({ id, title, description, icon, count, open, onToggle, children, zh = true }: {
  readonly id: string; readonly title: string; readonly description: string; readonly icon: ReactNode
  readonly count: number; readonly open: boolean; readonly onToggle: () => void; readonly children: ReactNode; readonly zh?: boolean
}): React.JSX.Element {
  return <section data-paimind-agent-form-panel data-paimind-agent-skills-panel aria-labelledby={`${id}-title`}>
    <button type="button" data-paimind-agent-skills-toggle aria-expanded={open} aria-controls={`${id}-content`} onClick={onToggle}>
      <span data-paimind-agent-panel-head><span>{icon}</span><span><strong id={`${id}-title`}>{title}</strong><small>{description}</small></span></span>
      <span>{zh ? `已选择 ${count} 项` : `${count} selected`}</span>
    </button>
    {open && <div id={`${id}-content`}>{children}</div>}
  </section>
}
