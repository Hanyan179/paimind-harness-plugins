import { useEffect, useState } from 'react'
import type { HarnessRemoteResult } from '@paimind/harness-compat'
import { PaimindExtensionIcon, PaimindSearchIcon } from '@paimind/harness-compat/client-icons'
import type { McpConnectionView, McpManagement } from '@paimind/mcp-center/contract'
import { AgentSelectionPanel } from './selection-panel.js'

export type McpRemoteApi = { [K in 'list']: (...args: Parameters<McpManagement[K]>) => Promise<HarnessRemoteResult<Awaited<ReturnType<McpManagement[K]>>>> }
async function mcpResult<T>(request: Promise<HarnessRemoteResult<T>>): Promise<T> { const result = await request; if (!result.ok) throw new Error(result.error.message); return result.value }
const categories = { all: ['全部', 'All'], documents: ['文档协作', 'Documents'], development: ['开发工具', 'Development'], data: ['数据服务', 'Data'], other: ['其他', 'Other'] } as const

/** Agent Center owns the draft; this picker only reads current connection choices. */
export function McpConnectionPicker({ api, selected, onChange, zh = true }: { readonly api?: McpRemoteApi | undefined; readonly selected: readonly string[]; readonly onChange: (ids: readonly string[]) => void; readonly zh?: boolean }): React.JSX.Element {
  const [choices, setChoices] = useState<McpConnectionView[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [selectedOnly, setSelectedOnly] = useState(false), [category, setCategory] = useState('all')
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    if (!api || typeof api.list !== 'function') { setLoading(false); setError(zh ? '连接中心不可用；已保存引用保持不变。' : 'Connection Center is unavailable; saved references are preserved.'); return }
    const refresh = (): void => { void mcpResult(api.list()).then(result => { if (alive) { setChoices(result.items); setError('') } }, () => { if (alive) setError(zh ? '读取连接失败；已保存引用保持不变。' : 'Could not load connections; saved references are preserved.') }).finally(() => { if (alive) setLoading(false) }) }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [api, zh, open])
  const visible = choices.filter(({ connection: { configuration: config } }) => config.name.toLowerCase().includes(query.trim().toLowerCase()) && (category === 'all' || config.category === category) && (!selectedOnly || selected.includes(config.id)))
  const missing = selected.filter(id => !choices.some(view => view.connection.configuration.id === id))
  const toggle = (id: string, checked: boolean): void => { onChange(checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id)) }
  return <AgentSelectionPanel id="paimind-agent-connections" title={zh ? '工具连接（可选）' : 'Tool connections (optional)'} description={zh ? '只绑定这个智能体需要的工具连接。' : 'Bind only the tool connections required by this Agent.'} icon={<PaimindExtensionIcon size={15} />} count={selected.length} open={open} onToggle={() => { setOpen(value => !value) }} zh={zh}>
    <fieldset data-paimind-agent-field data-paimind-agent-skill-picker data-paimind-agent-connection-picker><legend>{zh ? '智能体工具连接' : 'Agent tool connections'}</legend>
      <p data-paimind-agent-skill-policy>{zh ? '先在连接中心添加和测试，再选择这个助手需要的连接。同一条连接可以供多个助手使用。' : 'Add and test connections in Connection Center, then select those this Agent needs. Multiple Agents can share a connection.'}</p>
      {loading && <span aria-busy="true">{zh ? '正在读取连接…' : 'Loading connections…'}</span>}{error && <p role="alert">{error}</p>}
      {!loading && !error && <>
        <div data-paimind-agent-skill-toolbar><label data-paimind-agent-skill-search><PaimindSearchIcon size={15} /><input type="search" aria-label={zh ? '搜索工具连接' : 'Search tool connections'} placeholder={zh ? '搜索连接名称' : 'Search connection names'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} /></label><button type="button" data-paimind-agent-skill-selected aria-pressed={selectedOnly} onClick={() => { setSelectedOnly(value => !value) }}>{zh ? `只看已选 ${selected.length}` : `Selected ${selected.length}`}</button></div>
        <div data-paimind-agent-skill-categories role="group" aria-label={zh ? '连接分类' : 'Connection categories'}>{Object.entries(categories).map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id) }}><span>{label[zh ? 0 : 1]}</span><small>{choices.filter(view => id === 'all' || view.connection.configuration.category === id).length}</small></button>)}</div>
        <div data-paimind-agent-skill-summary><span>{zh ? `已选择 ${selected.length} / 已添加 ${choices.length}` : `${selected.length} selected / ${choices.length} added`}</span><span>{zh ? `${visible.length} 个结果` : `${visible.length} results`}</span></div>
        <div data-paimind-agent-skill-results>
          {visible.map(view => { const config = view.connection.configuration; const checked = selected.includes(config.id); return <label key={config.id} data-paimind-agent-skill data-selected={checked}><input type="checkbox" disabled={!config.enabled && !checked} checked={checked} onChange={event => { toggle(config.id, event.currentTarget.checked) }} /><span><strong>{config.name}</strong><small>{categories[config.category][zh ? 0 : 1]} · {config.transport === 'stdio' ? (zh ? '本机程序' : 'Local process') : (zh ? '远程服务' : 'Remote service')}</small><em>{!config.enabled ? (zh ? '已停用' : 'Disabled') : view.state === 'error' ? (zh ? '需要处理' : 'Needs attention') : view.state === 'untested' ? (zh ? '待测试' : 'Untested') : (zh ? `${view.tools.length} 个工具 · 可绑定` : `${view.tools.length} tools · Available`)}</em></span></label> })}
          {visible.length === 0 && <div data-paimind-agent-skill-empty>{choices.length === 0 ? (zh ? '尚无连接，请先在连接中心添加。' : 'Add a connection in Connection Center first.') : (zh ? '当前筛选没有匹配连接。' : 'No connections match the filters.')}</div>}
          {missing.map(id => <label key={id} data-paimind-agent-skill data-selected="true"><input type="checkbox" checked onChange={() => { toggle(id, false) }} /><span><strong>{zh ? '不可用的连接' : 'Unavailable connection'} {id.slice(0, 8)}</strong><em>{zh ? '取消勾选可解除引用' : 'Uncheck to remove this reference'}</em></span></label>)}
        </div>
      </>}
    </fieldset>
  </AgentSelectionPanel>
}
