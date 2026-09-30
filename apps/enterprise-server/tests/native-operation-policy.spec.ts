// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { authorizeNativeOperation, type NativeOperationRequest } from '../src/native-operation-policy.js'

const call = (endpoint: string, args: object = {}): NativeOperationRequest => ({ method: 'POST', target: `/api/${endpoint}`,
  contentType: 'application/json', body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'policy-test', method: endpoint,
    payload: endpoint.includes('/') ? { args } : args })) })
const personal = { input: { productKind: 'personal', basePresetId: 'standard' } }
describe('native plain JSON boot receipt boundary', () => {
  it('accepts only the reviewed submission, not diagnostic reads, aliases or authority selectors', () => {
    const request: NativeOperationRequest = { method: 'POST', target: '/paimind/boot-readiness', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ schema: 'paimind.boot-readiness/v1', state: 'ready', phase: 'shell-ready' })) }
    for (const role of ['member', 'admin'] as const) expect(() => authorizeNativeOperation(role, request)).not.toThrow()
    for (const changed of [{ method: 'GET', body: Buffer.alloc(0) }, { method: 'PUT' }, { contentType: 'text/plain' },
      { target: request.target + '?userId=another' }, { target: request.target + '/' },
      { body: Buffer.from('{') }, { body: Buffer.from(JSON.stringify({ schema: 'paimind.boot-readiness/v1', state: 'ready', userId: 'another' })) }]) {
      expect(() => authorizeNativeOperation('member', { ...request, ...changed })).toThrow()
    }
  })
})
describe('enterprise native role policy, not member admission or object isolation', () => {
  it('admits original and branded manifest reads without granting mutations or new member selectors', () => {
    for (const role of ['admin', 'member'] as const) for (const method of ['GET', 'HEAD']) {
      for (const target of ['/manifest.webmanifest', '/plugins/@paimind/branding/manifest.webmanifest']) {
        expect(() => authorizeNativeOperation(role, { method, target, body: Buffer.alloc(0) })).not.toThrow()
        expect(() => authorizeNativeOperation(role, { method: 'POST', target, body: Buffer.alloc(0) })).toThrow()
      }
      if (role === 'member') expect(() => authorizeNativeOperation(role, { method, target: '/manifest.webmanifest?userId=other', body: Buffer.alloc(0) })).toThrow()
    }
  })
  it('admits native export preflight and descendant download for current roles without admitting arbitrary query fields', () => {
    for (const role of ['member', 'admin'] as const) for (const method of ['HEAD', 'GET']) {
      const request = { method, target: '/api/session.export?sessionId=owned&includeDescendants=true', body: Buffer.alloc(0) }
      expect(() => authorizeNativeOperation(role, request)).not.toThrow()
      for (const suffix of ['&includeDescendants=false', '&userId=alex', '&path=/secrets', '&sessionId=foreign']) {
        expect(() => authorizeNativeOperation(role, { ...request, target: request.target + suffix })).toThrow()
      }
    }
  })
  it('admits only exact original Web export; role admission alone is not execution authority', () => {
    for (const role of ['member', 'admin'] as const) {
      expect(() => authorizeNativeOperation(role, call('commands/execute', { agentId: 'owned', line: '/export', images: [] }))).not.toThrow()
      for (const patch of [{ images: ['injected'] }, { userId: 'alex' }, { line: '/export ' + 'x'.repeat(4096) }, { line: '/export \0' }]) {
        expect(() => authorizeNativeOperation(role, call('commands/execute', { agentId: 'owned', line: '/export', images: [], ...patch }))).toThrow()
      }
    }
    for (const line of ['/export-all', '/plan', '/compact', '/goal']) {
      expect(() => authorizeNativeOperation('member', call('commands/execute', { agentId: 'owned', line, images: [] }))).toThrow()
    }
  })
  it('allows only the original agent-addressed list shape; actual eligibility belongs to the private gateway', () => {
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, call('commands/list', { agentId: 'owned' }))).not.toThrow()
    for (const args of [{}, { agentId: '' }, { agentId: 'owned', userId: 'alex' }, { agentId: 'owned', role: 'admin' }]) {
      expect(() => authorizeNativeOperation('member', call('commands/list', args))).toThrow()
    }
    expect(() => authorizeNativeOperation('member', call('commands/execute', { agentId: 'owned', line: 'run' }))).toThrow()
  })
  it('accepts only empty exact provider presentation reads; writes and terminal execution stay closed', () => {
    for (const target of ['/sidebar/api/settings.get', '/sidebar/api/shell.get']) {
      const request = { method: 'POST', target, contentType: 'application/json', body: Buffer.from('{}') }
      for (const role of ['member', 'admin'] as const) expect(() => authorizeNativeOperation(role, request)).not.toThrow()
      for (const input of [{ userId: 'alex' }, { sessionId: 'foreign' }, { role: 'admin' }, { patch: {} }]) {
        expect(() => authorizeNativeOperation('member', { ...request, body: Buffer.from(JSON.stringify(input)) })).toThrow()
      }
      for (const target of ['/sidebar/api/settings.update', '/sidebar/api/pty.open', '/sidebar/api/shell.execute']) {
        expect(() => authorizeNativeOperation('member', { ...request, target })).toThrow()
      }
    }
  })
  it('admits the exact managed tree and rejects its resource selectors on other sidebar operations', () => {
    const request = { method: 'POST', target: '/sidebar/api/fs.tree', contentType: 'application/json', body: Buffer.from(JSON.stringify({ sessionId: 'hansen', cwd: '/untrusted' })) }
    expect(() => authorizeNativeOperation('member', request)).not.toThrow()
    for (const target of ['/sidebar/api/fs.write', '/sidebar/api/settings.get', '/sidebar/api/shell.get', '/sidebar/api/fs.tree?x=1']) {
      expect(() => authorizeNativeOperation('member', { ...request, target })).toThrow()
    }
    expect(() => authorizeNativeOperation('member', { ...request, body: Buffer.from(JSON.stringify({ sessionId: 'hansen', userId: 'alex' })) })).toThrow()
  })
  it('admits only the exact display-settings read carrier whose response the gateway must project', () => {
    expect(() => authorizeNativeOperation('member', call('settings.describe'))).not.toThrow()
    for (const args of [{ ns: 'llm-deepseek' }, { role: 'admin' }, { redactSecrets: false }, { userId: 'hansen' }]) {
      expect(() => authorizeNativeOperation('member', call('settings.describe', args))).toThrow()
    }
    for (const endpoint of ['settings.update', 'settings.replace', 'settings.mutate', 'settings.openDocument']) {
      expect(() => authorizeNativeOperation('member', call(endpoint, { ns: 'locale' }))).toThrow()
    }
  })
  it('permits only the current private cell notification read-state contract, never recipient selection or publishing', () => {
    for (const endpoint of ['paimindNotifications/list', 'paimindNotifications/markAllRead']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).not.toThrow()
      for (const args of [{ userId: 'alex' }, { recipientIds: ['hansen'] }, { request: {} }, { role: 'admin' }]) {
        expect(() => authorizeNativeOperation('member', call(endpoint, args))).toThrow()
      }
    }
    const request = { id: 'notification:one', ifVersion: 'version:one' }
    expect(() => authorizeNativeOperation('member', call('paimindNotifications/markRead', { request }))).not.toThrow()
    for (const args of [{}, { request: null }, { request: { ...request, recipientIds: ['hansen'] } },
      { request: { ...request, ifVersion: '' } }, { request: { ...request, id: '../hansen' } },
      { request, userId: 'hansen' }]) {
      expect(() => authorizeNativeOperation('member', call('paimindNotifications/markRead', args))).toThrow()
    }
    for (const endpoint of ['paimindNotifications/publish', 'paimindNotifications/registerProducer',
      'paimindNotifications/remove', 'paimindNotifications/futureMethod']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).toThrow()
    }
  })
  it('requires governed Feature Pack changes even for a genuine administrator', () => {
    for (const endpoint of ['settings.update', 'settings.replace', 'settings.mutate']) {
      for (const ns of ['paimind-feature-packs', 'paimind.feature-packs']) {
        expect(() => authorizeNativeOperation('admin', call(endpoint, { ns, patch: {}, section: {}, ops: [] }))).toThrow()
      }
    }
    for (const endpoint of ['paimindFeaturePacks/mutate', 'paimindFeaturePacks/futureMutation', 'settings.openDocument', 'settings.futureWrite']) {
      expect(() => authorizeNativeOperation('admin', call(endpoint))).toThrow()
    }
    for (const endpoint of ['settings.describe', 'pluginInventory/list', 'paimindFeaturePacks/describe', 'credentials.describe', 'session.list']) {
      expect(() => authorizeNativeOperation('admin', call(endpoint))).not.toThrow()
    }
    for (const endpoint of ['settings.update', 'settings.replace', 'settings.mutate']) {
      expect(() => authorizeNativeOperation('admin', call(endpoint, { ns: 'llm-deepseek', patch: {}, section: {}, ops: [] }))).not.toThrow()
    }
  })
  it('does not let administrator carrier aliases or malformed envelopes evade the same policy', () => {
    const request = call('paimindFeaturePacks/mutate', { request: { id: 'paimind:pack:operations', enabled: false, expectedRevision: 0 } })
    for (const target of [request.target + '?approved=true', '/api/paimindFeaturePacks%2fmutate', request.target + '/', '/api/session.list']) {
      expect(() => authorizeNativeOperation('admin', { ...request, target })).toThrow()
    }
    for (const patch of [{ contentType: 'text/plain' }, { method: 'GET' }, { body: Buffer.from('{}') }, { body: Buffer.from([0xff]) }]) {
      expect(() => authorizeNativeOperation('admin', { ...request, ...patch })).toThrow()
    }
    for (const ns of [undefined, {}, '', '../paimind-feature-packs']) {
      expect(() => authorizeNativeOperation('admin', call('settings.mutate', { ns, ops: [] }))).toThrow()
    }
  })
  it('allows only one exact adopted preference and never general policy, system capabilities or a claimed role', () => {
    const input = { reference: { publicationId: 'shape-only-owner-validates-the-complete-reference' }, expectedRevision: 0, field: 'enabled', value: true }
    expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/setAdoptedSkillPreference', { input }))).not.toThrow()
    for (const patch of [{ role: 'admin' }, { enabledOptionalSystemSkillNames: ['genui'] }, { field: 'system' }, { value: 'true' },
      { reference: null }, { expectedRevision: -1 }, { expectedRevision: 0.5 }]) {
      expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/setAdoptedSkillPreference', { input: { ...input, ...patch } }))).toThrow()
    }
    expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/setAdoptedSkillPreference', { input, role: 'admin' }))).toThrow()
    expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/replaceUserSkillPolicy', { input }))).toThrow()
  })
  it('allows only the adopted-content read shape without exposing general Skill content, editing or policy administration', () => {
    expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/readAdoptedSkillContent', {
      input: { reference: { publicationId: 'shape-only-owner-checks-full-reference' }, kind: 'directory', path: '' },
    }))).not.toThrow()
    for (const endpoint of ['paimindSkillInstaller/getSkillPackage', 'paimindSkillInstaller/listSkillPackageDirectory',
      'paimindSkillInstaller/readSkillPackageFile', 'paimindSkillInstaller/saveSkillPackage', 'paimindSkillInstaller/replaceUserSkillPolicy']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).toThrow()
    }
    for (const args of [{}, { input: { kind: 'file', path: 'SKILL.md', offset: 0 } },
      { input: { reference: {}, kind: 'directory', path: '', role: 'admin' } }, { input: { reference: {}, kind: 'directory', path: '' }, role: 'admin' }]) {
      expect(() => authorizeNativeOperation('member', call('paimindSkillInstaller/readAdoptedSkillContent', args))).toThrow()
    }
  })
  it('permits only the two exact sidebar push shapes; the gateway separately verifies the native session', () => {
    const request = { method: 'GET', target: '/sidebar/ws/agent-opens?sessionId=session-hansen', contentType: undefined, body: new Uint8Array() }
    expect(() => authorizeNativeOperation('member', request)).not.toThrow()
    expect(() => authorizeNativeOperation('member', { ...request, target: '/sidebar/ws/agent-terminals?sessionId=session-hansen' })).not.toThrow()
    for (const changed of [{ target: '/sidebar/ws/terminal?sessionId=session-hansen' },
      { target: request.target + '&role=admin' }, { body: Buffer.from('{}') }, { method: 'POST' }]) {
      expect(() => authorizeNativeOperation('member', { ...request, ...changed })).toThrow()
    }
  })
  it('allows only reviewed managed directory operations without opening host I/O', () => {
    expect(() => authorizeNativeOperation('member', call('host.listDirectory'))).not.toThrow()
    expect(() => authorizeNativeOperation('member', call('host.createDirectory', { path: '/var/lib/paimind/workspace', name: 'Hansen 客户项目' }))).not.toThrow()
    for (const request of [call('host.listDirectory', { root: '/', role: 'admin' }), call('host.createDirectory'),
      call('host.createDirectory', { path: '/', name: 'x', recursive: true }), call('host.pickDirectory'), call('host.openPath')]) {
      expect(() => authorizeNativeOperation('member', request)).toThrow()
    }
  })
  it('preserves member conversation, workspace, goal and personal Agent authoring operations', () => {
    for (const endpoint of ['session.create', 'session.prompt', 'session.history', 'workspace.create', 'goal.resume',
      'skill.list', 'agentPreset.select', 'paimindAgentProfiles/removeProfile', 'paimindAgentProfiles/bindSession']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).not.toThrow()
    }
    expect(() => authorizeNativeOperation('member', call('paimindAgentProfiles/saveProfile', personal))).not.toThrow()
    expect(() => authorizeNativeOperation('member', call('paimindAgentProfiles/saveProfile', { input: { basePresetId: 'standard' } }))).not.toThrow()
    expect(() => authorizeNativeOperation('member', call('paimindAgentProfiles/prepareAuthoringTurn', {
      input: { draft: { productKind: 'personal', basePresetId: 'standard', businessCategory: '' } },
    }))).not.toThrow()
  })
  it('denies platform management, credential/model changes, skill authoring and unknown operations', () => {
    for (const endpoint of ['settings.replace', 'settings.mutate', 'settings.update', 'settings.openDocument',
      'credentials.describe', 'credentials.set', 'credentials.unset', 'llm.discoverModels', 'host.openPath',
      'paimindExtensionCenter/setEnabled', 'paimindSkillMarket/create',
      'paimindScheduler/list', 'paimindScheduler/create', 'paimindScheduler/runNow', 'session.futureAdminMethod']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).toThrow('当前账户未获授权')
      if (['settings.replace', 'settings.mutate', 'settings.update', 'settings.openDocument'].includes(endpoint)) {
        expect(() => authorizeNativeOperation('admin', call(endpoint))).toThrow()
      } else expect(() => authorizeNativeOperation('admin', call(endpoint))).not.toThrow()
    }
  })
  it('rejects business publishing or a privileged base hidden in personal save/authoring payloads', () => {
    for (const input of [{ productKind: 'business', basePresetId: 'standard' }, { productKind: 'personal', basePresetId: 'cordis' },
      { productKind: 'personal', basePresetId: 'standard', businessCategory: 'enterprise' },
      { productKind: 'personal', basePresetId: 'standard', businessCategoryId: 'assigned' }, null]) {
      expect(() => authorizeNativeOperation('member', call('paimindAgentProfiles/saveProfile', { input }))).toThrow()
    }
    expect(() => authorizeNativeOperation('member', call('paimindAgentProfiles/prepareAuthoringTurn', {
      input: { draft: { productKind: 'business', basePresetId: 'standard', businessCategory: '' } },
    }))).toThrow()
  })
  it('allows the actual personal Agent save prerequisites without enabling native preset administration', () => {
    for (const endpoint of ['paimindSkillInstaller/listInstalled', 'paimindSkillInstaller/getUserSkillPolicy',
      'paimindSkillInstaller/listSystemSkills', 'paimindSkillInstaller/getSessionBusinessSkillSelection']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).not.toThrow()
    }
    expect(() => authorizeNativeOperation('member', call('agentPreset.copy', { from: 'standard', agentPreset: 'sales-helper-a12345', name: 'Sales Helper' }))).not.toThrow()
    for (const payload of [{ from: 'cordis', agentPreset: 'my-agent' }, { from: 'standard', agentPreset: 'standard' },
      { from: 'standard', agentPreset: 'paimind-enterprise-guessed-id' },
      { from: 'standard', agentPreset: '../other' }, { from: 'standard', agentPreset: 'my-agent', content: 'privileged' }]) {
      expect(() => authorizeNativeOperation('member', call('agentPreset.copy', payload))).toThrow()
    }
    for (const endpoint of ['agentPreset.openDocument', 'agentPreset.remove', 'paimindSkillInstaller/replaceUserSkillPolicy',
      'paimindSkillInstaller/saveSkillSource', 'paimindSkillInstaller/installUpload', 'paimindSkillInstaller/uninstall']) {
      expect(() => authorizeNativeOperation('member', call(endpoint))).toThrow()
    }
  })
  it('does not turn a claimed role inside the body into authority and rejects mismatched envelopes', () => {
    expect(() => authorizeNativeOperation('member', call('settings.replace', { role: 'admin' }))).toThrow()
    const request = call('settings.replace')
    expect(() => authorizeNativeOperation('member', { ...request, target: '/api/session.prompt' })).toThrow('格式无效')
    expect(() => authorizeNativeOperation('member', { ...request, contentType: 'text/plain' })).toThrow('格式无效')
  })
})
