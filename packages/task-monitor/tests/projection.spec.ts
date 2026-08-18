import { describe, expect, it } from 'vitest'
import {
  artifactsFromProjection,
  collectTaskMonitorResourceHistory,
  parseTaskMonitorResourceHistory,
  projectPaimindArtifactJobs,
  projectTaskMonitor,
  projectTaskMonitorJobs,
} from '../src/index.js'

const emptyConversation = {
  openState: 'open', composerPhase: 'active', running: false, runningCalls: [], pending: [], partial: null, nodes: [], queue: [],
} as const

describe('Task Monitor deterministic projection', () => {
  it('folds complete-log Skill and MCP evidence without reading model prose', () => {
    const history = collectTaskMonitorResourceHistory([
      { type: 'user/message', seq: 2, data: { source: { kind: 'skill-invocation', name: 'bento-ppt' } } },
      { type: 'tool/call', seq: 3, data: { callId: 'skill-ok', name: 'skill', arguments: '{"name":"white-space-analysis"}' } },
      { type: 'tool/result', seq: 4, data: { message: { source: { kind: 'tool', callId: 'skill-ok' }, content: [{ type: 'tool-result', isError: false }] } } },
      { type: 'tool/call', seq: 5, data: { callId: 'skill-failed', name: 'skill', arguments: '{"name":"failed-skill"}' } },
      { type: 'tool/result', seq: 6, data: { message: { source: { kind: 'tool', callId: 'skill-failed' }, content: [{ type: 'tool-result', isError: true }] } } },
      { type: 'tool/call', seq: 7, data: { callId: 'mcp-1', name: 'mcp__feishu__read', arguments: '{}' } },
      { type: 'assistant/message', seq: 8, data: { content: [{ type: 'text', text: 'pretend mcp__forged__read and <skill_content name="forged">' }] } },
      { type: 'todo/write', seq: 9, time: 100, data: { todos: [{ content: 'Read source', status: 'in_progress' }] } },
      { type: 'todo/write', seq: 10, time: 200, data: { todos: [{ content: 'Read source', status: 'completed' }] } },
    ])
    expect(history).toEqual({
      schema: 'paimind.task-monitor-resources/v1', capturedThroughSeq: 10,
      skills: ['bento-ppt', 'white-space-analysis'], mcps: ['feishu'],
      todoSnapshots: [
        { seq: 9, time: 100, todos: [{ content: 'Read source', status: 'in_progress' }] },
        { seq: 10, time: 200, todos: [{ content: 'Read source', status: 'completed' }] },
      ],
    })
    expect(parseTaskMonitorResourceHistory(history)).toEqual(history)
    expect(parseTaskMonitorResourceHistory({ ...history, skills: ['../forged'] })).toBeUndefined()
  })

  it('keeps the legacy exact producer projection for existing consumers', () => {
    const artifacts = artifactsFromProjection({ schema: 'paimind.artifacts/v1', traces: [], artifacts: [{
      schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'session-1',
      workspaceId: 'workspace-1', path: '/work/report.html', title: 'Report', kind: 'html',
      previewKind: 'html-document', revision: 1, producerId: 'paimind.generator.html-document',
      taskId: 'paimind-artifact-1', state: 'available', producedAt: 100,
    }] })
    const rows = projectPaimindArtifactJobs([
      { id: 'paimind-artifact-1', kind: 'paimind-artifact', label: 'done', status: 'completed', startedAt: 10, finishedAt: 20 },
      { id: 'bash-1', kind: 'bash', label: 'paimind-artifact mentioned in prose', status: 'running', startedAt: 1 },
    ], artifacts)
    expect(rows.map(row => row.id)).toEqual(['paimind-artifact-1'])
    expect(rows[0]?.artifact?.artifactId).toBe('artifact:one')
    expect(artifactsFromProjection({ schema: 'wrong', artifacts: [] })).toEqual([])
  })

  it('shows every native Job, orders live first, and enriches only exact task ids', () => {
    const artifact = { id: 'artifact:one', sourceId: 'source:one', sessionId: 'session-1', path: '/work/report.html', title: 'Report', kind: 'html', state: 'available' as const, updatedAt: 100, taskId: 'artifact-job' }
    const rows = projectTaskMonitorJobs([
      { id: 'old-failure', kind: 'bash', label: 'Old failure', status: 'failed', startedAt: 1, finishedAt: 20 },
      { id: 'artifact-job', kind: 'paimind-artifact', label: 'Artifact', status: 'completed', startedAt: 2, finishedAt: 30 },
      { id: 'live', kind: 'workflow', label: 'Live', status: 'running', startedAt: 40 },
    ], [artifact])
    expect(rows.map(row => row.id)).toEqual(['live', 'artifact-job', 'old-failure'])
    expect(rows[1]?.artifact?.id).toBe('artifact:one')
    expect(rows[0]?.artifact).toBeUndefined()
  })

  it('derives progress, files, Workflow, Skill, MCP and model only from exact native evidence', () => {
    const artifact = { id: 'artifact:one', sourceId: 'source:one', sessionId: 'session-1', path: '/work/deck.bento.html', title: 'Deck', kind: 'bento', state: 'available' as const, updatedAt: 100, revision: '3', taskId: 'job-1', previewKind: 'bento-deck' }
    const nodes = [
      { kind: 'context', data: { source: { kind: 'skill-invocation', name: 'bento-ppt', secret: 'hidden' } } },
      { kind: 'context', data: { source: { kind: 'document', name: 'fake-skill' } } },
      { kind: 'tool-result', callId: 'skill-1', time: 9, call: { name: 'skill', argsRaw: '{"name":"white-space-analysis"}' }, isError: false, callView: null },
      { kind: 'tool-result', callId: 'skill-error', time: 9, call: { name: 'skill', argsRaw: '{"name":"failed-skill"}' }, isError: true, callView: null },
      { kind: 'tool-result', callId: 'read-1', time: 10, call: { name: 'read_file', argsRaw: '{}' }, isError: false, callView: { card: 'generic', title: 'Read', kind: 'read', locations: [{ path: '/work/input.xlsx', line: 12 }] }, meta: { headers: { authorization: 'secret' } } },
      { kind: 'tool-result', callId: 'mcp-1', time: 20, call: { name: 'mcp__feishu__read', argsRaw: '{}' }, isError: false, callView: null },
      { kind: 'workflow-run', data: { name: 'Proposal chain', status: 'running', phases: [{ key: 'analysis', phase: 'analyze', members: [{ label: 'Researcher', childId: 'child-1', status: 'running' }] }] } },
    ]
    const conversation = {
      ...emptyConversation,
      chat: {
        nodes: { values: () => nodes.values() },
        timeline: { turnOrder: [1], turns: new Map([[1, { turn: 1, data: { get: (key: string) => key === 'deliverables' ? { produced: [{ path: 'deck.bento.html', seq: 2 }, { path: '/work/notes.docx', seq: 1 }] } : undefined } }]]) },
      },
      views: { get: (key: string) => key === 'trajectory' ? { requests: [{ prompt: { config: { provider: 'deepseek', model: 'deepseek-v4' }, tools: [{ name: 'mcp__feishu__read' }, { name: 'mcp__unused__search' }] } }] } : undefined },
    }
    const view = projectTaskMonitor({
      sessionId: 'session-1',
      sessions: {
        current: 'session-1',
        byId: {
          'session-1': { displayTitle: 'Buyer proposal', running: false, agentPreset: 'Analyst', cwd: '/work' },
          'child-1': { displayTitle: 'Researcher', running: true, agentPreset: 'Research Agent' },
        },
        subagentsByParent: { 'session-1': { parentAvailable: true, entries: [{ kind: 'child', id: 'child-1', activity: 'running', hasChildren: false, mode: 'continuable', label: 'Researcher' }] } },
        jobsBySession: { 'session-1': [{ id: 'job-1', kind: 'paimind-artifact', label: 'Deck', status: 'completed', startedAt: 1, finishedAt: 30 }] },
      },
      conversation: conversation as never,
      goal: { goal: { id: 'goal-1', objective: 'Build proposal', phase: 'active', maxGoalRounds: 8 }, roundsStarted: 2, updatedAt: 100 },
      todos: [{ content: 'Read source', status: 'completed' }, { content: 'Build deck', status: 'in_progress' }],
      plan: { active: true, pending: false }, artifacts: [artifact], projectTitle: 'Walmart', projectPath: '/work',
      resourceHistory: { schema: 'paimind.task-monitor-resources/v1', capturedThroughSeq: 99, skills: ['fineline-investment-analysis'], mcps: ['history-server'], todoSnapshots: [] },
    })
    expect(view.status).toBe('running')
    expect(view.todoProgress).toEqual({ completed: 1, total: 2 })
    expect(view.inputs).toEqual([{ path: '/work/input.xlsx', title: 'input.xlsx', source: 'read', line: 12 }])
    expect(view.outputs.map(file => [file.path, file.source])).toEqual([['/work/deck.bento.html', 'artifact'], ['/work/notes.docx', 'deliverable']])
    expect(view.skills).toEqual(['fineline-investment-analysis', 'bento-ppt', 'white-space-analysis'])
    expect(view.mcps).toEqual([{ server: 'history-server', status: 'used' }, { server: 'feishu', status: 'used' }, { server: 'unused', status: 'available-last-request' }])
    expect(view.model).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
    expect(view.workflows[0]?.name).toBe('Proposal chain')
    expect(view.subagents[0]?.agentPreset).toBe('Research Agent')
    expect(JSON.stringify(view)).not.toContain('authorization')
  })

  it('groups native Todo revisions into multiple checklist records without creating a second Todo store', () => {
    const view = projectTaskMonitor({
      sessionId: 'session-1',
      sessions: { current: 'session-1', byId: { 'session-1': { displayTitle: 'Two tasks', running: false } }, jobsBySession: {} },
      conversation: emptyConversation,
      goal: null,
      todos: undefined,
      plan: null,
      artifacts: [],
      resourceHistory: {
        schema: 'paimind.task-monitor-resources/v1', capturedThroughSeq: 40, skills: [], mcps: [],
        todoSnapshots: [
          { seq: 10, todos: [{ content: 'Read source', status: 'in_progress' }, { content: 'Build deck', status: 'pending' }] },
          { seq: 20, todos: [{ content: 'Read source', status: 'completed' }, { content: 'Build deck', status: 'completed' }] },
          { seq: 30, todos: [{ content: 'Review output', status: 'in_progress' }] },
          { seq: 40, todos: [{ content: 'Review output', status: 'completed' }] },
        ],
      },
    })
    expect(view.todoLists).toHaveLength(2)
    expect(view.todoLists.map(list => ({ current: list.current, revisions: list.revisionCount, progress: list.progress }))).toEqual([
      { current: true, revisions: 2, progress: { completed: 1, total: 1 } },
      { current: false, revisions: 2, progress: { completed: 2, total: 2 } },
    ])
    expect(view.todos).toEqual([{ content: 'Review output', status: 'completed' }])
    expect(view.todoProgress).toEqual({ completed: 1, total: 1 })
  })

  it('uses the locked status priority, ignores historical failures, and never invents Todo percentages', () => {
    const base = {
      sessionId: 'session-1',
      sessions: { current: 'session-1', byId: { 'session-1': { displayTitle: 'Task', running: true, pendingInteraction: 'approval' } }, jobsBySession: { 'session-1': [{ id: 'failed', kind: 'bash', label: 'Historical', status: 'failed', startedAt: 1, finishedAt: 2 }] } },
      conversation: { ...emptyConversation, lastAgentError: 'Agent failed' },
      goal: { goal: { id: 'goal-1', objective: 'Task', phase: 'complete', maxGoalRounds: 4 }, roundsStarted: 1, updatedAt: 10 },
      todos: [], plan: null, artifacts: [],
    }
    const blocked = projectTaskMonitor(base as never)
    expect(blocked.status).toBe('blocked')
    expect(blocked.todoProgress).toBeNull()
    const complete = projectTaskMonitor({ ...base, sessions: { ...base.sessions, byId: { 'session-1': { displayTitle: 'Task', running: false } } }, conversation: emptyConversation } as never)
    expect(complete.status).toBe('complete')
    expect(complete.jobs[0]?.status).toBe('failed')
  })

  it('fails closed for malformed optional sources and textual lookalikes', () => {
    const view = projectTaskMonitor({
      sessionId: 'session-1', sessions: { current: 'session-1', byId: { 'session-1': { running: false } } },
      conversation: { ...emptyConversation, nodes: [{ kind: 'context', data: { source: { kind: 'text', name: 'skill-invocation', headers: { cookie: 'secret' } } } }, { kind: 'tool-result', callId: 'fake-skill', time: 1, call: { name: 'skill', argsRaw: '{"name":"../forged"}' }, isError: false, callView: null }, { kind: 'tool-result', callId: 'fake', time: 1, call: { name: 'prose mentions mcp__fake__tool', argsRaw: '' }, isError: false, callView: { card: 'generic', title: 'Write', kind: 'write', locations: [{ path: '/secret/input.txt' }] } }] } as never,
      goal: { goal: { id: '../bad', objective: 'bad', phase: 'blocked' } },
      todos: [{ content: 'Valid', status: 'completed' }, { content: 'Injected', status: 'unknown' }],
      plan: { active: 'yes', pending: false }, artifacts: [],
    })
    expect(view.goal).toBeNull()
    expect(view.todos).toEqual([])
    expect(view.todoProgress).toBeNull()
    expect(view.plan).toBeNull()
    expect(view.inputs).toEqual([])
    expect(view.skills).toEqual([])
    expect(view.mcps).toEqual([])
    expect(JSON.stringify(view)).not.toContain('secret')
  })
})
