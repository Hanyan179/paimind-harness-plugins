import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Full, published web profile in a labelled disposable Linux image. Direct
// native-service checks are NOT browser/member acceptance, and tools stay sealed.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const workspace = '/var/lib/paimind/workspaces/hansen'
const other = '/var/lib/paimind/workspaces/alex'
const privateHome = '/var/lib/paimind/dsh-home'
const domain = createCandidateExecutionDomain(workspace)
const alexResources = '/var/lib/paimind/resources/alex'
for (const dir of [workspace, other, privateHome, '/var/lib/paimind/home', domain.temporaryRoot, domain.resourceRoot, alexResources]) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}
await writeFile(`${privateHome}/private-canary.txt`, 'private-native-controller-only')
await writeFile(`${other}/Alex.txt`, 'Alex-only')
await writeFile(`${alexResources}/Alex.txt`, 'Alex-only-resource')
process.chdir(workspace)
process.env.HOME = '/var/lib/paimind/home'; process.env.DSH_HOME = privateHome
process.env.NODE_ENV = 'production'; process.env.DSH_TELEMETRY_MODE = 'DISABLED'
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const { symbols } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { bootManagedHarnessProfile } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-runtime')).href)
const { LlmAdapter } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
const cycles = []
for (let cycle = 0; cycle < 2; cycle++) {
  let root
  try {
    root = await bootManagedHarnessProfile({ runtimeRoot: '/opt/paimind', profileHome: '/usr/share/paimind/managed',
      profileName: 'web', installationManifest: '/opt/paimind/node_modules/@deepseek-ai/dsh/package.json',
      args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'],
      environment: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
      executionDomain: domain, toolGuard: () => 'candidate-not-admitted',
      requestExit: () => { throw Error('Unexpected native application exit request') },
      prepare: context => { root = context },
    })
    assert.equal(root.fs.constructor.name, 'BoundFilesystem')
    assert.equal(root.subprocess.constructor.name, 'ManagedHarnessSubprocessRuntime')
    assert.equal(root.codeRuntime.constructor.name, 'ManagedHarnessCodeRuntime')
    assert.equal(root.codeRuntime.isolation, 'process')
    assert.equal(root.get('workflowEngine'), undefined, 'The web profile must not acquire a new root workflow backend')
    const codeOwners = [...root.loader.entries()].filter(entry => entry.options.id === 'code-runtime')
    assert.equal(codeOwners.length, 1); assert.equal(codeOwners[0].options.disabled, true)
    assert.equal(root.sandboxPolicy.workspaceRoot, workspace)
    const codeResult = await root.codeRuntime.run({ bindings: [], program: `
      const fs = await import('node:fs/promises');
      const checks = [];
      for (const file of ${JSON.stringify([`${privateHome}/private-canary.txt`, `${other}/Alex.txt`])}) {
        try { await fs.readFile(file); checks.push('EXPOSED') } catch (error) { checks.push(error.code) }
      }
      const filename = ${JSON.stringify(workspace + '/Hansen-code.txt')};
      ${cycle === 0 ? "await fs.writeFile(filename, 'Hansen code-owned content');" : ''}
      return { checks, content: await fs.readFile(filename, 'utf8'), env: Object.keys(process.env) };
    ` })
    assert.deepEqual(codeResult, { logs: [], value: { checks: ['ENOENT', 'ENOENT'], content: 'Hansen code-owned content', env: [] } })
    assert.equal(await root.fs.readText(await root.fs.resolve('Hansen-code.txt')), 'Hansen code-owned content')
    const page = await fetch('http://127.0.0.1:3210/', { signal: AbortSignal.timeout(5000) })
    const html = await page.text(); assert.equal(page.status, 200)
    for (const marker of ['__DSH_BOOT__', '@paimind/enterprise-admin', '@paimind/extension-center']) assert.ok(html.includes(marker))
    const presets = await root.agentPresets.list()
    assert.ok(presets.some(row => row.id === 'standard' && !row.broken), 'Original shipped preset must remain available')
    const codeAgent = await root.agents.create({ sessionId: `native-code-consumer-${cycle}`,
      meta: { cwd: workspace, agentPreset: 'code' }, setup: async ctx => { await root.agentPresets.mount(ctx, 'code') } })
    try {
      assert.ok(root.tools.schemas(codeAgent.agent).some(tool => tool.name === 'run_code'))
      let codeConsumerRan = false
      await codeAgent.agent.ctx.inject(['codeRuntime'], async context => {
        // Cordis deliberately wraps services/methods per calling context. Compare
        // its exported original identity, but execute through the scoped proxy.
        const original = context.codeRuntime[symbols.original]
        assert.ok(original)
        assert.equal(original, root.codeRuntime[symbols.original],
          'Native code preset must consume the same host provider identity')
        assert.equal(root.registry.get(original.constructor).fibers.length, 1,
          'The agent consumer must not create a second Code Runtime')
        assert.deepEqual(await context.codeRuntime.run({ program: 'return await own.name({})',
          bindings: [{ global: 'own', functions: { name: async () => 'Hansen' } }] }), { logs: [], value: 'Hansen' })
        codeConsumerRan = true
      })
      assert.ok(codeConsumerRan)
    } finally { await codeAgent.dispose() }
    // Real original parent Agents, Sessions, standing presets, subagent registry
    // and spawn provider. Only the model wire is an explicit deterministic
    // fixture; this cannot be counted as a real model reply or Browser E2E.
    const modelCalls = []; const nativeChildren = []; const childEnds = []
    class DiagnosticModel extends LlmAdapter {
      async *stream(options) {
        const prompt = JSON.stringify(options.messages)
        modelCalls.push(prompt)
        const text = 'native-child-diagnostic-reply'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const unregisterModel = root.llm.registerAdapter(['workflow-diagnostic'], new DiagnosticModel())
    const stopStarts = root.on('subagent/start', info => {
      const child = root.agents.get(info.id)
      nativeChildren.push({ id: info.id, runId: info.runId, provider: info.provider, local: info.local,
        nativeAgent: !!child, nativeSession: child?.session.id === info.id,
        parent: child?.session.header.parentSession, origin: child?.session.header.origin })
    })
    const stopEnds = root.on('subagent/end', info => { childEnds.push({ id: info.id, runId: info.runId, reason: info.stopReason }) })
    const workflowPresets = []; const originalEngines = []
    try {
      for (const preset of ['standard', 'code', 'cordis']) {
        const parent = await root.agents.create({ sessionId: `native-workflow-${preset}-${cycle}`,
          meta: { cwd: workspace, agentPreset: preset }, agentOptions: { provider: 'workflow-diagnostic', model: 'fixture' },
          setup: async ctx => { await root.agentPresets.mount(ctx, preset) } })
        try {
          const engine = root.agentPresets.serviceFor(parent.agent, 'workflowEngine')
          assert.ok(engine); assert.equal(engine.constructor.name, 'BoundWorkflow')
          originalEngines.push(engine)
          const request = { parent: parent.agent, meta: { name: `native-${preset}`, description: 'Native workflow diagnostic', phases: [{ title: 'Review' }] } }
          const run = engine.start({ ...request, script: `
            const p=log.constructor('return process')();
            const fs=await p.getBuiltinModule('node:fs/promises');const denied=[];
            for(const file of ${JSON.stringify([`${privateHome}/private-canary.txt`, `${other}/Alex.txt`])}) {
              try{await fs.readFile(file);denied.push('EXPOSED')}catch(error){denied.push(error.code)}
            }
            return {denied,reply:await agent(${JSON.stringify(`native-parent-${preset}-${cycle}`)})};
          ` })
          try {
            assert.deepEqual(await run.result, { stopReason: 'completed', agentsStarted: 1,
              value: { denied: ['ENOENT', 'ENOENT'], reply: 'native-child-diagnostic-reply' } })
          } finally { await run.dispose() }
          const child = nativeChildren.at(-1)
          assert.equal(child.parent, parent.agent.session.id); assert.equal(child.provider, 'spawn')
          assert.equal(child.nativeAgent, true); assert.equal(child.nativeSession, true)
          assert.equal(child.local, true); assert.equal(child.origin, 'subagent')
          assert.equal(root.agents.get(child.id), undefined, 'Original child owner must release the actual Agent')
          assert.equal(childEnds.filter(end => end.runId === child.runId && end.reason === 'completed').length, 1)
          assert.ok(modelCalls.at(-1).includes(`native-parent-${preset}-${cycle}`))
          workflowPresets.push({ preset, originalParentAndChild: true, privateAndOtherMemberDenied: true,
            originalChildReleased: true, modelWire: 'deterministic-diagnostic-fixture' })
        } finally { await parent.dispose() }
      }
      assert.equal(new Set(originalEngines).size, 3, 'Each original standing preset retains its own workflow realm')
      assert.equal(new Set(nativeChildren.map(child => child.id)).size, 3)
      assert.equal(modelCalls.length, 3); assert.equal(childEnds.length, 3)
    } finally { unregisterModel(); stopStarts(); stopEnds() }
    const installer = root.paimindSkillInstaller
    assert.ok(installer, 'Real product Skill Center must be active')
    const skillName = 'hansen-delivery-review'
    if (cycle === 0) await installer.saveSkillPackage({ changes: [
      { operation: 'write', path: 'SKILL.md', content: `---\nname: ${skillName}\ndescription: Review Hansen delivery evidence.\n---\nRead references/delivery.txt before reviewing delivery.\n` },
      { operation: 'mkdir', path: 'references' },
      { operation: 'write', path: 'references/delivery.txt', content: 'Hansen delivery resource evidence' },
    ] })
    const selection = await installer.getUserSkillPolicy()
    await installer.replaceUserSkillPolicy({ expectedRevision: selection.revision,
      enabledOptionalSystemSkillNames: selection.enabledOptionalSystemSkillNames,
      enabledBusinessSkillNames: selection.enabledBusinessSkillNames, directBusinessSkillNames: [] })
    const selected = await root.agents.create({ sessionId: `native-skill-selected-${cycle}`, meta: { cwd: workspace, agentPreset: 'standard' },
      setup: async ctx => { await root.agentPresets.mount(ctx, 'standard') } })
    const unselected = await root.agents.create({ sessionId: `native-skill-unselected-${cycle}`, meta: { cwd: workspace, agentPreset: 'standard' },
      setup: async ctx => { await root.agentPresets.mount(ctx, 'standard') } })
    try {
      await installer.replaceSessionBusinessSkillSelection({ sessionId: selected.agent.session.id, expectedRevision: 0, skillNames: [skillName] })
      const skill = await root.skills.get(skillName, { scope: selected.agent })
      assert.ok(skill?.content.includes('Read references/delivery.txt'), 'Selected native skill body must be readable')
      if (cycle === 1) assert.ok(skill.content.includes('Updated source-owned review instructions.'))
      assert.equal(await root.skills.get(skillName, { scope: unselected.agent }), undefined, 'Unselected session must not receive the business skill')
      assert.equal(await root.skills.get(skillName), undefined, 'Business skill must not enter the global registry')
      assert.equal(skill.resourceBase?.kind, 'directory')
      assert.equal(skill.resourceBase.path, `${domain.resourceRoot}/skills/${skillName}`)
      const resourcePath = `${skill.resourceBase.path}/references/delivery.txt`
      const resource = await root.fs.resolve(resourcePath)
      const expected = cycle === 0 ? 'Hansen delivery resource evidence' : 'Hansen revised resource evidence'
      assert.equal(await root.fs.readText(resource), expected, 'Selected skill resources must be usable, not merely advertised')
      await assert.rejects(root.fs.writeText(resource, 'unauthorized tool change'), error => error.code === 'FS_SANDBOX_DENIED')
      const handle = root.subprocess.spawn({ argv: ['/usr/local/bin/node', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';import{readFile,writeFile,chmod,rename,unlink,link,readdir}from'node:fs/promises';
        const resource=${JSON.stringify(resourcePath)};
        assert.equal(await readFile(resource,'utf8'),${JSON.stringify(expected)});
        for(const operation of [()=>writeFile(resource,'bad'),()=>chmod(resource,0o777),()=>rename(resource,resource+'.moved'),
          ()=>unlink(resource),()=>link(resource,${JSON.stringify(workspace + '/resource-hardlink')})]) {
          await assert.rejects(operation(),error=>['EROFS','EACCES','EPERM','EXDEV'].includes(error.code));
        }
        await assert.rejects(readFile(${JSON.stringify(alexResources + '/Alex.txt')}),error=>error.code==='ENOENT');
        await assert.rejects(readFile(${JSON.stringify(privateHome + '/private-canary.txt')}),error=>error.code==='ENOENT');
        assert.deepEqual(await readdir('/var/lib/paimind/resources'),['hansen']);
        console.log('NATIVE_SKILL_RESOURCE_READONLY_AND_MEMBER_BOUNDARY_PASSED');
      `], cwd: workspace, graceMs: 1000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
      try {
        assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
        assert.ok(handle.collected.stdout.readFrom(0).text.includes('NATIVE_SKILL_RESOURCE_READONLY_AND_MEMBER_BOUNDARY_PASSED'))
      } finally { handle.terminate(); await handle.waitForExit() }
      assert.equal(await readFile(resourcePath, 'utf8'), expected)
      if (cycle === 0) {
        const document = await installer.getSkillPackage({ skillId: skillName })
        const body = await installer.readSkillPackageFile({ skillId: skillName, path: 'SKILL.md' })
        const attachment = await installer.readSkillPackageFile({ skillId: skillName, path: 'references/delivery.txt' })
        await installer.saveSkillPackage({ skillId: skillName, expectedDigest: document.digest, changes: [
          { operation: 'write', path: 'SKILL.md', expectedDigest: body.digest, content: `---\nname: ${skillName}\ndescription: Review Hansen delivery evidence.\n---\nRead references/delivery.txt before reviewing delivery.\nUpdated source-owned review instructions.\n` },
          { operation: 'write', path: 'references/delivery.txt', content: 'Hansen revised resource evidence', expectedDigest: attachment.digest },
        ] })
        assert.ok((await root.skills.get(skillName, { scope: selected.agent }))?.content.includes('Updated source-owned review instructions.'))
        assert.equal(await root.fs.readText(resource), 'Hansen revised resource evidence', 'Source-owned atomic update must remain visible')
      } else {
        const removed = await installer.uninstall({ skillId: skillName })
        assert.equal(removed.recoverable, true)
        assert.equal(await root.skills.get(skillName, { scope: selected.agent }), undefined)
        await assert.rejects(root.fs.readText(resource), error => error.code === 'FS_NOT_FOUND')
        assert.ok(!(await installer.listInstalled()).items.some(item => item.name === skillName))
      }
    } finally { await selected.dispose(); await unselected.dispose() }
    const file = await root.fs.resolve('Hansen-shared-capabilities.txt')
    if (cycle === 0) await root.fs.writeText(file, 'Hansen persisted content', { kind: 'createIfAbsent' })
    assert.equal(await root.fs.readText(file), 'Hansen persisted content')
    const temp = await root.fs.resolve('/tmp/Hansen-interoperable.txt')
    await root.fs.writeText(temp, 'native filesystem and process')
    const handle = root.subprocess.spawn({ argv: ['/bin/sh', '-c', 'cat /tmp/Hansen-interoperable.txt'], cwd: workspace, graceMs: 1000,
      stdio: { stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 }, stdin: 'ignore' } })
    try {
      assert.equal((await handle.done).exitCode, 0)
      assert.equal(handle.collected.stdout.readFrom(0).text, 'native filesystem and process')
    } finally { handle.terminate(); await handle.waitForExit() }
    for (const path of [`${privateHome}/private-canary.txt`, `${other}/Alex.txt`]) {
      await assert.rejects(root.fs.readText(await root.fs.resolve(path)))
    }
    await assert.rejects(root.fs.writeText(file, 'forbidden', undefined, undefined,
      { mode: 'read-only', workspaceRoot: workspace }), error => error.code === 'FS_SANDBOX_DENIED')
    const dependencyTransitions = []
    let currentWorkflowEngines = originalEngines
    for (const id of ['sandbox', 'sandbox-policy']) {
      const entries = [...root.loader.entries()].filter(entry => entry.options.id === id)
      assert.equal(entries.length, 1)
      const previousFs = root.fs; const previousProcess = root.subprocess; const previousCode = root.codeRuntime
      // The published entry transition changes only the in-memory native tree,
      // not the sealed file-backed profile. No Loader.update persistence call.
      await entries[0].update({ disabled: true })
      assert.equal(root.get('fs'), undefined); assert.equal(root.get('subprocess'), undefined)
      assert.equal(root.get('codeRuntime'), undefined)
      assert.equal(root.get('workflowEngine'), undefined)
      for (const engine of currentWorkflowEngines) assert.throws(() => engine.start({}), /withdrawn/)
      await assert.rejects(previousCode.run({ program: 'return 1', bindings: [] }), /withdrawn/)
      await assert.rejects(previousFs.readText(file), error => error.code === 'FS_ABORTED')
      assert.throws(() => previousProcess.spawn({ argv: ['/bin/true'], cwd: workspace, graceMs: 1000,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' } }), /withdrawn/)
      await entries[0].update({ disabled: null })
      await root.loader.await()
      assert.notEqual(root.fs, previousFs); assert.notEqual(root.subprocess, previousProcess)
      assert.notEqual(root.codeRuntime, previousCode)
      assert.equal(root.get('workflowEngine'), undefined)
      const recreatedWorkflows = []
      for (const preset of ['standard', 'code', 'cordis']) {
        const parent = await root.agents.create({ sessionId: `recreated-workflow-${id}-${preset}-${cycle}`,
          meta: { cwd: workspace, agentPreset: preset }, setup: async ctx => { await root.agentPresets.mount(ctx, preset) } })
        try {
          const engine = root.agentPresets.serviceFor(parent.agent, 'workflowEngine')
          assert.equal(engine.constructor.name, 'BoundWorkflow')
          assert.ok(!currentWorkflowEngines.includes(engine)); recreatedWorkflows.push(engine)
          const run = engine.start({ parent: parent.agent, meta: { name: 'recreated', description: 'Dependency transition', phases: [{ title: 'Check' }] }, script: 'return 2' })
          try { assert.equal((await run.result).value, 2) } finally { await run.dispose() }
        } finally { await parent.dispose() }
      }
      currentWorkflowEngines = recreatedWorkflows
      assert.deepEqual(await root.codeRuntime.run({ program: 'return 2', bindings: [] }), { logs: [], value: 2 })
      assert.equal(await root.fs.readText(await root.fs.resolve('Hansen-shared-capabilities.txt')), 'Hansen persisted content')
      dependencyTransitions.push({ id, oldReferencesDenied: true, recreatedPairReadback: true, recreatedCodeReadback: true,
        withdrawnPresetWorkflowsDenied: true, recreatedWorkflowReadback: true, rootWorkflowStillAbsent: true })
    }
    // Register only a diagnostic native tool, dispatch it through the original
    // registry, and prove the candidate guard denies before any body side effect.
    let invoked = false
    root.tools.register({ name: 'managed_profile_diagnostic', description: 'Probe only', parameters: {},
      output: { schema: { type: 'object', properties: { ran: { type: 'boolean' } }, required: ['ran'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => { invoked = true; return { ran: true } } })
    const denied = await root.tools.execute({ name: 'managed_profile_diagnostic', callId: `profile-${cycle}`,
      arguments: {}, signal: AbortSignal.timeout(5000) })
    assert.equal(denied.isError, true); assert.equal(invoked, false)
    assert.ok(JSON.stringify(denied).includes('candidate-not-admitted'))
    const previousFs = root.fs; const previousProcess = root.subprocess; const previousCode = root.codeRuntime
    await root.fiber.dispose()
    await assert.rejects(previousFs.readText(file), error => error.code === 'FS_ABORTED')
    await assert.rejects(previousCode.run({ program: 'return 1', bindings: [] }), /withdrawn/)
    assert.throws(() => previousProcess.spawn({ argv: ['/bin/true'], cwd: workspace, graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' } }), /withdrawn/)
    assert.equal(await readFile(`${privateHome}/private-canary.txt`, 'utf8'), 'private-native-controller-only')
    assert.equal(await readFile(`${other}/Alex.txt`, 'utf8'), 'Alex-only')
    assert.equal(await readFile(`${alexResources}/Alex.txt`, 'utf8'), 'Alex-only-resource')
    cycles.push({ cycle, nativeWebStatus: page.status, shippedStandardPreset: true, sameWorldFileProcess: true,
      privateAndOtherMemberDenied: true, readonlyDenied: true, originalToolGuardActive: true, withdrawnPairDenied: true,
      dependencyTransitions, selectedSkillBodyAndResource: true, unselectedAndGlobalCatalogClean: true,
      nativeHostCodeProviderSelected: true, nativeCodePresetSharesProvider: true, codeFilePrivateAndOtherMemberDenied: true,
      workflowPresets,
      resourceReadonlyAndOtherMemberDenied: true, ownerResourceUpdateOrRemoval: cycle === 0 ? 'updated' : 'removed-recoverably' })
    process.stdout.write(JSON.stringify({ nativeProfileCycle: cycles.at(-1) }) + '\n')
  } finally { await root?.fiber.dispose() }
}
process.stdout.write(JSON.stringify({ status: 'NATIVE_MANAGED_PROFILE_CAPABILITY_PAIR_PASSED', cycles,
  nativeFilesystemFullProfileSliceVerified: true, retainedDataAcrossNativeRestart: true,
  nativeFullProfileCodeVerified: true, nativeWorkflowFullProfileVerified: true,
  realNativeChildProviderVerified: true, modelWire: 'deterministic-diagnostic-fixture', realModelReplyVerified: false,
  browserE2EVerified: false, memberAdmissionVerified: false,
  finalWorkerImageAccepted: false }) + '\n')
