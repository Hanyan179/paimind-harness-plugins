import { readFileSync, statSync } from 'node:fs'
import postgres from 'postgres'
import { Identity } from './identity.js'
import { createEnterpriseServer } from './server.js'
import { MemberContent } from './member-content.js'
import { ModelInspection } from './model-inspection.js'
import { ConnectorInspection } from './connector-inspection.js'
import { ConnectorManagement } from './connector-management.js'
import { ModelManagement } from './model-management.js'
import { InstructionManagement } from './instruction-management.js'
import { FeatureManagement, type ApprovedFeatureRelease } from './feature-management.js'
import { RuntimeBindings, type PrivateRuntimeCell } from './runtime-bindings.js'
import { NativeGateway } from './native-gateway.js'
import { CellTransport } from './cell-transport.js'
import { CellTransportDirectory } from './cell-transport-directory.js'
import { openPinnedOriginAuthority, restorePinnedConnectors, readRuntimeCellConfiguration, readRuntimeReload, RuntimeCellReloader } from './runtime-cell-reload.js'
import { SkillPublications } from './skill-publications.js'
import { EnterpriseError } from './errors.js'

// This executable starts only the explicitly configured control-plane API. It does
// not initialize databases, mutate runtime homes or manage any Docker resource.
async function main() {
  const configPath = process.argv[2]
  if (!configPath || process.argv.length !== 3 || (statSync(configPath).mode & 0o077) !== 0) {
    throw new Error('A private enterprise configuration file is required')
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    applicationUrl: string; tenantId: string; masterKey: string; bootstrapSecret: string
    publicOrigin: string; loopbackDevelopment?: boolean; tlsKeyPath?: string; tlsCertPath?: string
    nativeDevelopmentOrigins?: string[]
    nativePrivateCells?: (PrivateRuntimeCell & { transportKey: string })[]
    nativeResourceDiagnostics?: boolean
    approvedFeatureReleases?: ApprovedFeatureRelease[]
  }
  const url = new URL(config.publicOrigin)
  const sql = postgres(config.applicationUrl, { max: 10, connect_timeout: 5, onnotice: () => {},
    connection: { statement_timeout: 5_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 10_000 } })
  let transports: ReadonlyMap<string, CellTransport> = new Map()
  try {
    const identity = new Identity(sql, config.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await identity.bootstrapState()
    const tls = config.tlsKeyPath && config.tlsCertPath
      ? { key: readFileSync(config.tlsKeyPath), cert: readFileSync(config.tlsCertPath) } : undefined
    if (config.nativeDevelopmentOrigins && config.loopbackDevelopment !== true) throw new Error('Development cells require explicit loopback mode')
    if (config.nativeResourceDiagnostics && config.loopbackDevelopment !== true) throw new Error('Resource diagnostics require isolated loopback mode')
    const configuredCells = (config.nativePrivateCells ?? []).map(cell => readRuntimeCellConfiguration(cell, config.publicOrigin))
    const cells = configuredCells.map(({ transportKey: _key, ...cell }) => cell)
    const bindings = config.nativeDevelopmentOrigins || cells.length
      ? new RuntimeBindings(sql, identity, config.publicOrigin, config.nativeDevelopmentOrigins ?? [], cells) : undefined
    const directory = new CellTransportDirectory(new Map(configuredCells.map(cell => [cell.origin, new CellTransport(cell.origin, cell.transportKey)])), cells)
    transports = directory
    const nativeGateway = bindings ? new NativeGateway({ publicOrigin: config.publicOrigin,
      ...(config.nativeResourceDiagnostics ? { onTransportFailure: event => console.log(JSON.stringify({ event: 'native-transport-failure', ...event })) } : {}),
      transports,
      resolve: (token, requestId) => bindings.resolve(token, requestId),
      agentPresetEligibility: (token, requestId, grant, ids) => bindings.readAgentPresetEligibility(token, requestId, grant, ids),
      sealInteractiveOrigin: (token, requestId, scope, clientRpcId) => identity.sealInteractiveOrigin(token, requestId, scope, clientRpcId),
      authorize: (token, requestId, grant, request, verifyResource) => identity.authorizeRuntimeOperation(token, requestId, grant, request, verifyResource) }) : undefined
    if (bindings) for (const cell of cells) {
      // A new gateway must not silently connect an older launcher lacking the
      // reverse channel. Neither the public browser nor DB chooses this pin.
      await openPinnedOriginAuthority(bindings, cell, transports.get(cell.origin)!)
      const recovery = await restorePinnedConnectors(bindings, cell, transports.get(cell.origin)!, AbortSignal.timeout(5000))
      console.log(JSON.stringify({ event: 'connector-cold-restoration', cellId: cell.cellId, ...recovery }))
    }
    const skillPublications = new SkillPublications(sql, identity, (token, requestId, principal, selection, sink, signal) => {
      if (!nativeGateway) throw new EnterpriseError(503, 'publication-source-unavailable', '原生技能来源尚未接入', true)
      return nativeGateway.exportSkillPublication(token, requestId, principal, selection, sink, signal)
    }, (token, requestId, principal, input, readChunk, mode, signal) => {
      if (!nativeGateway) throw new EnterpriseError(503, 'skill-adoption-unavailable', '原生技能采用尚未接入', true)
      return nativeGateway.adoptSkillPublication(token, requestId, principal, input, readChunk, mode, signal)
    })
    const memberContent = bindings ? new MemberContent(identity, bindings, transports) : undefined
    const modelInspection = bindings ? new ModelInspection(identity, bindings, transports) : undefined
    const connectorInspection = bindings ? new ConnectorInspection(identity, bindings, transports) : undefined
    const connectorManagement = bindings ? new ConnectorManagement(identity, bindings, transports) : undefined
    const modelManagement = bindings ? new ModelManagement(identity, bindings, transports) : undefined
    const instructionManagement = bindings ? new InstructionManagement(identity, bindings, transports) : undefined
    const featureManagement = bindings ? new FeatureManagement(identity, bindings, transports, config.approvedFeatureReleases ?? []) : undefined
    const server = createEnterpriseServer({ identity, skillPublications, publicOrigin: config.publicOrigin,
      ...(memberContent ? { memberContent } : {}),
      ...(modelInspection ? { modelInspection } : {}),
      ...(connectorInspection ? { connectorInspection } : {}),
      ...(connectorManagement ? { connectorManagement } : {}),
      ...(modelManagement ? { modelManagement } : {}),
      ...(instructionManagement ? { instructionManagement } : {}),
      ...(featureManagement ? { featureManagement } : {}),
      ...(config.nativeResourceDiagnostics ? { onNativeResourceResponse: event => console.log(JSON.stringify({ event: 'native-resource-response', ...event })) } : {}),
      ...(nativeGateway ? { nativeGateway } : {}),
      ...(config.loopbackDevelopment === true ? { loopbackDevelopment: true } : {}), ...(tls ? { tls } : {}) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(Number(url.port), '127.0.0.1', resolve)
    })
    console.log(JSON.stringify({ status: 'listening', publicOrigin: url.origin, deployment: 'isolated-enterprise', pid: process.pid }))
    let closing = false
    const reloadLifetime = new AbortController()
    const reloader = bindings && cells.length ? new RuntimeCellReloader(bindings, directory, configuredCells, config.publicOrigin, reloadLifetime.signal) : undefined
    let pendingReload = Promise.resolve()
    const reload = () => {
      if (closing) return
      pendingReload = pendingReload.then(async () => {
        if (closing) return
        if (!reloader) throw Error('No private runtime inventory to reload')
        const result = await reloader.apply(readRuntimeReload(configPath, config))
        console.log(JSON.stringify({ event: 'runtime-cell-reload', at: new Date().toISOString(), ...result }))
      }).catch(() => console.error('运行单元配置重载未完成；请核对准确的新绑定，其他成员保持原配置。'))
    }
    process.on('SIGHUP', reload)
    const close = async () => {
      if (closing) return
      closing = true
      process.off('SIGHUP', reload)
      reloadLifetime.abort()
      await pendingReload
      nativeGateway?.close()
      memberContent?.close()
      modelInspection?.close()
      connectorInspection?.close()
      connectorManagement?.close()
      modelManagement?.close()
      instructionManagement?.close()
      featureManagement?.close()
      const force = setTimeout(() => server.closeAllConnections(), 10_000)
      force.unref()
      await new Promise<void>(resolve => server.close(() => resolve()))
      clearTimeout(force)
      await sql.end({ timeout: 5 })
    }
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void close() })
  } catch {
    for (const transport of transports.values()) transport.destroy()
    await sql.end({ timeout: 5 })
    throw new Error('Enterprise startup failed')
  }
}

void main().catch(() => { console.error('企业控制面未能安全启动；请检查私有配置与依赖。'); process.exitCode = 1 })
