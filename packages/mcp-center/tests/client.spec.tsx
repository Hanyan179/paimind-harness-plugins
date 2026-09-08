import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { McpCenterSection, type McpRemoteApi } from '../src/client/index.js'
import { McpConnectionPicker } from '../../agent-market/src/client/mcp-picker.js'
import type { McpConnectionView } from '../src/contract.js'
afterEach(cleanup)
const id = 'a'.repeat(32)
const view: McpConnectionView = { connection: { configuration: { id, name: '我的飞书', category: 'documents', enabled: true, timeoutMs: 60000, transport: 'stdio', command: 'node', args: [], cwd: '/tmp', envRefs: {} }, owner: 'local', revision: 1, updatedAt: 1 }, state: 'available', tools: [{ name: 'read', description: 'Read' }], probe: { at: 1, status: 'passed', message: '协议握手成功；尚未验证文档权限。' }, business: null, bindings: [{ presetId: 'writer', name: '写作助手' }] }
function api() {
 return { list: vi.fn(async () => ({ ok: true, value: { items: [view] } })), save: vi.fn(async () => ({ ok: true, value: view })), probe: vi.fn(async () => ({ ok: true, value: view })), setEnabled: vi.fn(async () => ({ ok: true, value: view })), removeConnection: vi.fn(async () => ({ ok: true, value: { removed: true } })), templates: vi.fn(async () => ({ ok: true, value: { items: [] } })) } as unknown as McpRemoteApi
}
it('searches and filters connections, distinguishes probe from business evidence, reviews impacted Agents before removal', async () => {
 const remote = api(); render(<McpCenterSection api={remote} />)
 await screen.findByText('我的飞书')
 fireEvent.change(screen.getByLabelText('搜索连接'), { target: { value: '不存在' } }); expect(screen.getByText('没有匹配的连接')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('搜索连接'), { target: { value: '' } })
 fireEvent.change(screen.getByLabelText('按用途筛选'), { target: { value: 'data' } }); expect(screen.getByText('没有匹配的连接')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('按用途筛选'), { target: { value: 'documents' } })
 fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
 expect(screen.getByText(/尚无真实调用证据/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
 await waitFor(() => expect(remote.probe).toHaveBeenCalledWith({ id, expectedRevision: 1 }))
 await waitFor(() => expect(screen.getByRole('button', { name: '移除' })).not.toBeDisabled())
 fireEvent.click(screen.getByRole('button', { name: '移除' }))
 expect(screen.getByRole('alertdialog').textContent).toContain('写作助手')
 expect(remote.removeConnection).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
 await waitFor(() => expect(remote.removeConnection).toHaveBeenCalledWith({ id, expectedRevision: 1, acknowledgeBindings: true }))
})
it('never silently changes Agent references when the connection center is unavailable', async () => {
 const change = vi.fn(); render(<McpConnectionPicker selected={[id]} onChange={change} />)
 fireEvent.click(screen.getByRole('button', { name: /工具连接（可选）/ }))
 expect(await screen.findByRole('alert')).toHaveTextContent('已保存引用保持不变')
 expect(change).not.toHaveBeenCalled()
})
it('allows explicit unbinding of a missing reference', async () => {
 const remote = api(), missing = 'b'.repeat(32), change = vi.fn()
 render(<McpConnectionPicker api={remote} selected={[missing]} onChange={change} />)
 fireEvent.click(screen.getByRole('button', { name: /工具连接（可选）/ }))
 const checkbox = await screen.findByRole('checkbox', { name: /不可用的连接/ })
 fireEvent.click(checkbox); expect(change).toHaveBeenCalledWith([])
})

it('uses generic remote templates and scopes setup hints to the selected template', async () => {
 const remote = api()
 vi.mocked(remote.templates).mockResolvedValue({ ok: true, value: { items: [{ id: 'generic', name: '数据查询', description: 'Remote tools', setupHint: '使用服务自己的账号', configuration: { transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {}, category: 'data', enabled: true, timeoutMs: 5000 } }] } })
 render(<McpCenterSection api={remote} />)
 fireEvent.click(await screen.findByRole('button', { name: '连接数据查询' }))
 expect(screen.getByLabelText('服务地址')).toHaveValue('https://example.invalid/mcp')
 expect(screen.getByText('使用服务自己的账号')).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
 fireEvent.click(screen.getByRole('button', { name: '添加连接', exact: true }))
 expect(screen.queryByText('使用服务自己的账号')).toBeNull()
 expect(screen.getByLabelText('启动程序')).toHaveValue('')
})
it('filters connection choices without losing selected references and keeps disabled choices unavailable', async () => {
 const remote = api(), change = vi.fn()
 vi.mocked(remote.list).mockResolvedValue({ ok: true, value: { items: [view, { ...view, connection: { ...view.connection, configuration: { ...view.connection.configuration, id: 'b'.repeat(32), name: '已停用数据服务', enabled: false, category: 'data' } }, state: 'disabled' }] } })
 render(<McpConnectionPicker api={remote} selected={[id]} onChange={change} />)
 const panel = screen.getByRole('button', { name: /工具连接（可选）/ })
 expect(panel).toHaveAttribute('aria-expanded', 'false')
 fireEvent.click(panel)
 expect(await screen.findByRole('checkbox', { name: /已停用数据服务/ })).toBeDisabled()
 fireEvent.change(screen.getByLabelText('搜索工具连接'), { target: { value: '不存在' } })
 expect(screen.getByText('当前筛选没有匹配连接。')).toBeTruthy()
 expect(change).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('搜索工具连接'), { target: { value: '' } })
 fireEvent.click(screen.getByRole('button', { name: '只看已选 1' }))
 expect(screen.queryByRole('checkbox', { name: /已停用数据服务/ })).toBeNull()
 fireEvent.click(screen.getByRole('checkbox', { name: /我的飞书/ }))
 expect(change).toHaveBeenCalledWith([])
})
