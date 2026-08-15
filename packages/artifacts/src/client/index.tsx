import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { contributePaimindExtension, type PaimindWorkspaceClientContext } from '@paimind/harness-compat'
import type {
  PaimindSidebarFileOpenResult,
  PaimindSidebarService,
  PaimindSidebarTabScope,
} from '@paimind/better-sidebar-adapter'
import type { PaimindWorkspaceProjectService } from '@paimind/workspace-project'
import type { PaimindBentoPreviewService } from '@paimind/renderer-bento'
import {
  ArtifactRegistry,
  HarnessDeliverableArtifactSource,
  HarnessProjectedArtifactSource,
  resolveArtifactPath,
  selectArtifactViews,
  type ArtifactPathFailureCode,
  type PaimindArtifact,
  type PaimindArtifactScope,
  type PaimindArtifactService,
  type PaimindArtifactSource,
  type PaimindArtifactState,
  type PaimindArtifactView,
} from '../index.js'

export const inject = ['slots', 'sessions', 'paimindSidebar', 'paimindBentoPreview', 'locale', 'paimindWorkspaceProject']

export interface ArtifactsClientContext extends PaimindWorkspaceClientContext {
  readonly paimindSidebar: PaimindSidebarService
  readonly paimindBentoPreview: PaimindBentoPreviewService
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
}

const STYLE_ID = '@paimind/artifacts'
const STYLE = `
[data-paimind-artifacts] {
  box-sizing: border-box;
  min-width: 0;
  min-height: 100%;
  padding: 16px;
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-1, transparent);
  font: inherit;
}
[data-paimind-artifact-header] {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
[data-paimind-artifact-header] h2 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
[data-paimind-artifact-header] p {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 11px;
  line-height: 17px;
}
[data-paimind-artifact-count] {
  min-width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--dsw-alias-state-business-primary, #4f7ff8);
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 11px;
  font-weight: 600;
}
[data-paimind-artifact-filters] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 14px 0;
  padding: 3px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));
}
[data-paimind-artifact-filter] {
  min-width: 0;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #626872);
  background: transparent;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
[data-paimind-artifact-filter][aria-pressed='true'] {
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
[data-paimind-artifact-list] { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
[data-paimind-artifact-row] {
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.04));
}
[data-paimind-artifact-row][data-state='missing'],
[data-paimind-artifact-row][data-state='failed'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d04444) 34%, transparent);
}
[data-paimind-artifact-row][data-state='updating'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b7791f) 34%, transparent);
}
[data-paimind-artifact-row][data-focused='true'] {
  border-color: var(--dsw-alias-state-business-primary, #4f7ff8);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f7ff8) 18%, transparent);
}
[data-paimind-artifact-row-head] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
[data-paimind-artifact-kind] {
  min-width: 38px;
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--dsw-alias-state-business-primary, #4f7ff8);
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 9px;
  line-height: 14px;
  font-weight: 700;
  text-align: center;
  text-transform: uppercase;
}
[data-paimind-artifact-title] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}
[data-paimind-artifact-state] { color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; }
[data-paimind-artifact-path] {
  margin: 6px 0 0 46px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 10px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-paimind-artifact-reason] {
  margin: 7px 0 0 46px;
  color: var(--dsw-alias-label-secondary, #626872);
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
}
[data-paimind-artifact-actions] { display: flex; justify-content: flex-end; gap: 6px; margin-top: 9px; }
[data-paimind-artifact-action],
[data-paimind-artifact-preview] {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.24));
  border-radius: 8px;
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-3, #fff);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
[data-paimind-artifact-action]:disabled,
[data-paimind-artifact-preview]:disabled { opacity: .46; cursor: not-allowed; }
[data-paimind-artifact-empty],
[data-paimind-artifact-diagnostic],
[data-paimind-artifact-notice] {
  padding: 14px 12px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.24));
  border-radius: 12px;
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 11px;
  line-height: 18px;
}
[data-paimind-artifact-diagnostic], [data-paimind-artifact-notice] {
  margin-bottom: 8px;
  color: var(--dsw-alias-state-error-primary, #d04444);
}
@media (max-width: 720px) {
  [data-paimind-artifacts] { padding: 12px; }
  [data-paimind-artifact-row] { padding: 10px; }
  [data-paimind-artifact-row-head] { grid-template-columns: auto minmax(0, 1fr); }
  [data-paimind-artifact-state] { grid-column: 2; }
  [data-paimind-artifact-path], [data-paimind-artifact-reason] { margin-left: 0; }
}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/artifacts'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function ArtifactIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4 2.7h6.3L14 6.4v8.9H4z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M10.2 2.9v3.7h3.6M6.3 10.8h5.4M6.3 13h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

const STATE_COPY: Readonly<Record<PaimindArtifactState, readonly [string, string]>> = {
  available: ['可预览', 'Available'],
  updating: ['更新中', 'Updating'],
  missing: ['文件缺失', 'Missing'],
  failed: ['处理失败', 'Failed'],
}

const PATH_FAILURE_COPY: Readonly<Record<ArtifactPathFailureCode, readonly [string, string]>> = {
  'empty-path': ['文件路径为空。', 'The file path is empty.'],
  'invalid-workspace-root': ['当前工作区根目录不可用。', 'The current Workspace root is unavailable.'],
  'control-character': ['文件路径包含不安全字符。', 'The file path contains unsafe characters.'],
  'unsupported-scheme': ['不允许通过 URL 打开本地产物。', 'URL schemes are not allowed for local artifacts.'],
  traversal: ['文件路径包含目录穿越。', 'The file path contains directory traversal.'],
  'outside-workspace': ['文件不在当前工作区内。', 'The file is outside the current Workspace.'],
  'unsupported-kind': ['只支持 PDF、PPTX、HTML 和 XLSX 产物。', 'Only PDF, PPTX, HTML and XLSX artifacts are supported.'],
}

const OPEN_FAILURE_COPY: Readonly<Record<Exclude<PaimindSidebarFileOpenResult['state'], 'opened' | 'failed'>, readonly [string, string]>> = {
  'provider-unavailable': ['侧边栏预览服务不可用。', 'The sidebar preview provider is unavailable.'],
  'editor-unavailable': ['侧边栏文件编辑器已停用或不兼容。', 'The sidebar file editor is disabled or incompatible.'],
  'viewer-unavailable': ['对应的文件查看器已停用或不兼容。', 'The matching file viewer is disabled or incompatible.'],
}

function QaArtifactSource(
  ctx: ArtifactsClientContext,
): PaimindArtifactSource {
  const read = (): readonly PaimindArtifact[] => {
    const sessions = ctx.sessions.list.getSnapshot()
    const sessionId = sessions.current
    if (sessionId === undefined) return Object.freeze([])
    const project = ctx.paimindWorkspaceProject.getSnapshot().projects
      .find(entry => entry.sessionIds.includes(sessionId))
    if (project === undefined) return Object.freeze([])
    const updatedAt = Date.UTC(2026, 7, 14, 6, 0, 0)
    const common = { origin: 'paimind-product' as const, sessionId, workspaceId: project.workspaceId, updatedAt }
    return Object.freeze([
      Object.freeze({ ...common, id: 'qa-pdf', kind: 'pdf' as const, state: 'available' as const, title: 'FP06 PDF Preview', path: 'fp06-preview.pdf', revision: '2' }),
      Object.freeze({ ...common, id: 'qa-pptx', kind: 'pptx' as const, state: 'available' as const, title: 'FP06 PPTX Preview', path: 'fp06-preview.pptx', revision: '3' }),
      Object.freeze({ ...common, id: 'qa-html', kind: 'html' as const, previewKind: 'html-document' as const, state: 'available' as const, title: 'FP07 HTML Document', path: 'fp07-document.html', revision: '1' }),
      Object.freeze({ ...common, id: 'qa-html-deck', kind: 'html' as const, previewKind: 'html-deck' as const, state: 'available' as const, title: 'FP07 HTML Deck', path: 'fp07-deck.html', revision: '1' }),
      Object.freeze({ ...common, id: 'qa-bento', kind: 'html' as const, previewKind: 'bento-deck' as const, state: 'available' as const, title: 'FP07 Bento Deck', path: 'fp07-bento.html', revision: '1', traceId: 'qa-trace-adventureworks' }),
      Object.freeze({ ...common, id: 'qa-xlsx', kind: 'xlsx' as const, previewKind: 'spreadsheet' as const, state: 'available' as const, title: 'FP07 Workbook', path: 'fp07-workbook.xlsx', revision: '1' }),
      Object.freeze({ ...common, id: 'qa-updating', kind: 'pptx' as const, state: 'updating' as const, title: 'Quarterly Review (updating)', path: 'quarterly-review.pptx' }),
      Object.freeze({ ...common, id: 'qa-missing', kind: 'pdf' as const, state: 'missing' as const, title: 'Missing Evidence', path: 'missing-evidence.pdf', reason: { code: 'not-found', messageZh: '文件尚未生成或已被移除。', messageEn: 'The file has not been generated or was removed.' } }),
      Object.freeze({ ...common, id: 'qa-failed', kind: 'pptx' as const, state: 'failed' as const, title: 'Failed Deck', path: 'failed-deck.pptx', reason: { code: 'render-source-failed', messageZh: '产物来源处理失败，请查看对应任务。', messageEn: 'The artifact producer failed; inspect its task.' } }),
    ])
  }
  return {
    id: 'paimind:fp06-browser-qa',
    getSnapshot: () => ({ artifacts: read() }),
    subscribe(listener) {
      const offSessions = ctx.sessions.list.subscribe(listener)
      const offProjects = ctx.paimindWorkspaceProject.subscribe(listener)
      return () => { offProjects(); offSessions() }
    },
  }
}

function ArtifactRow(props: {
  readonly artifact: PaimindArtifactView
  readonly focused: boolean
  readonly actions: ReturnType<PaimindArtifactService['actionsFor']>
  readonly zh: boolean
  readonly onPreview: (artifact: PaimindArtifactView) => void
  readonly onAction: (actionId: string, artifact: PaimindArtifactView) => void
}): React.JSX.Element {
  const { artifact, focused, actions, zh, onPreview, onAction } = props
  const kindLabel = artifact.previewKind === 'html-deck'
    ? 'HTML Deck'
    : artifact.previewKind === 'bento-deck'
      ? 'Bento'
      : artifact.previewKind === 'html-document'
        ? 'HTML'
        : artifact.previewKind === 'spreadsheet'
          ? 'XLSX'
          : artifact.kind
  return (
    <li data-paimind-artifact-row data-artifact-id={artifact.id} data-state={artifact.state} data-focused={focused}>
      <div data-paimind-artifact-row-head>
        <span data-paimind-artifact-kind>{kindLabel}</span>
        <span data-paimind-artifact-title title={artifact.title}>{artifact.title}</span>
        <span data-paimind-artifact-state>{STATE_COPY[artifact.state][zh ? 0 : 1]}</span>
      </div>
      <p data-paimind-artifact-path title={artifact.path}>{artifact.path}</p>
      {artifact.reason !== undefined && (
        <p data-paimind-artifact-reason>{zh ? artifact.reason.messageZh : artifact.reason.messageEn}</p>
      )}
      <div data-paimind-artifact-actions>
        {actions.map(action => (
          <button
            key={action.id}
            type="button"
            data-paimind-artifact-action={action.id}
            disabled={artifact.state !== 'available'}
            onClick={() => { onAction(action.id, artifact) }}
          >
            {zh ? action.labelZh : action.labelEn}
          </button>
        ))}
        <button
          type="button"
          data-paimind-artifact-preview
          disabled={artifact.state !== 'available'}
          onClick={() => { onPreview(artifact) }}
        >
          {zh ? '预览' : 'Preview'}
        </button>
      </div>
    </li>
  )
}

export interface ArtifactPanelProps {
  readonly service: PaimindArtifactService
  readonly sidebar: PaimindSidebarService
  readonly bentoPreview: PaimindBentoPreviewService
  readonly scope: PaimindSidebarTabScope
}

export function ArtifactPanel({ service, sidebar, bentoPreview, scope }: ArtifactPanelProps): React.JSX.Element {
  const root = useRef<HTMLElement>(null)
  const snapshot = useSyncExternalStore(
    service.subscribe.bind(service),
    service.getSnapshot.bind(service),
    service.getSnapshot.bind(service),
  )
  const activeLocale = useSyncExternalStore(
    scope.locale.subscribe.bind(scope.locale),
    () => scope.locale.getLocale().active,
    () => scope.locale.getLocale().active,
  )
  const zh = activeLocale.startsWith('zh')
  const [filter, setFilter] = useState<PaimindArtifactScope>('session')
  const [notice, setNotice] = useState<readonly [string, string] | null>(null)
  const artifacts = useMemo(() => selectArtifactViews(
    snapshot.artifacts,
    filter,
    scope.sessionId,
    scope.workspaceId,
  ), [snapshot.artifacts, filter, scope.sessionId, scope.workspaceId])

  useEffect(() => {
    if (snapshot.focusedArtifactId === undefined) return
    const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-paimind-artifact-row]') ?? [])]
      .find(candidate => candidate.dataset.artifactId === snapshot.focusedArtifactId)
    row?.scrollIntoView({ block: 'nearest' })
  }, [artifacts, snapshot.focusedArtifactId])

  const preview = (artifact: PaimindArtifactView): void => {
    setNotice(null)
    const resolution = resolveArtifactPath(scope.cwd, artifact.path)
    if (resolution.state === 'unsafe') {
      setNotice(PATH_FAILURE_COPY[resolution.code])
      return
    }
    if (resolution.kind !== artifact.kind) {
      setNotice(PATH_FAILURE_COPY['unsupported-kind'])
      return
    }
    if (artifact.previewKind === 'bento-deck') {
      const opened = bentoPreview.open({
        sessionId: artifact.sessionId,
        workspaceId: artifact.workspaceId,
        cwd: scope.cwd ?? '',
        path: resolution.path,
        title: artifact.title,
      })
      if (!opened) setNotice([
        'Bento 隔离预览服务不可用。',
        'The isolated Bento preview service is unavailable.',
      ])
      return
    }
    const result = sidebar.openFile({
      path: resolution.path,
      title: artifact.title,
      allowedViewerIds: artifact.kind === 'pdf' ? ['paimind:pdf', 'pdf'] : [artifact.kind],
      refresh: true,
    })
    if (result.state === 'opened') return
    if (result.state === 'failed') setNotice([result.error, result.error])
    else setNotice(OPEN_FAILURE_COPY[result.state])
  }

  const runAction = (actionId: string, artifact: PaimindArtifactView): void => {
    setNotice(null)
    const result = service.runAction(actionId, artifact)
    if (result.state === 'failed') setNotice([result.messageZh, result.messageEn])
  }

  return (
    <section ref={root} data-paimind-artifacts aria-label={zh ? 'PAIMind 产物' : 'PAIMind Artifacts'}>
      <header data-paimind-artifact-header>
        <div>
          <h2>{zh ? 'PAIMind 产物' : 'PAIMind Artifacts'}</h2>
          <p>{zh ? '关联 Harness 会话与工作区，预览由侧边栏提供' : 'Session/Workspace associations; previews stay provider-owned'}</p>
        </div>
        <span data-paimind-artifact-count>{artifacts.length}</span>
      </header>
      <div data-paimind-artifact-filters aria-label={zh ? '产物范围' : 'Artifact scope'}>
        {(['session', 'workspace'] as const).map(entry => (
          <button
            key={entry}
            type="button"
            data-paimind-artifact-filter
            aria-pressed={filter === entry}
            onClick={() => { setFilter(entry) }}
          >
            {entry === 'session' ? (zh ? '当前会话' : 'Session') : (zh ? '当前工作区' : 'Workspace')}
          </button>
        ))}
      </div>
      {notice !== null && <div role="alert" data-paimind-artifact-notice>{notice[zh ? 0 : 1]}</div>}
      {snapshot.diagnostics.map(diagnostic => (
        <div key={diagnostic.sourceId} role="alert" data-paimind-artifact-diagnostic>
          {zh ? '产物来源不可用' : 'Artifact source unavailable'} · {diagnostic.sourceId}: {diagnostic.message}
        </div>
      ))}
      {artifacts.length === 0 ? (
        <div data-paimind-artifact-empty>{zh ? '这个范围内暂时没有可预览产物。' : 'No previewable artifacts in this scope yet.'}</div>
      ) : (
        <ul data-paimind-artifact-list>
          {artifacts.map(artifact => (
            <ArtifactRow
              key={`${artifact.sourceId}:${artifact.id}`}
              artifact={artifact}
              focused={snapshot.focusedArtifactId === artifact.id}
              actions={service.actionsFor(artifact)}
              zh={zh}
              onPreview={preview}
              onAction={runAction}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

class ArtifactErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-artifacts]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function apply(ctx: ArtifactsClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:artifacts',
    packageName: '@paimind/artifacts',
    category: 'content-rendering',
    nameZh: '产物与预览',
    nameEn: 'Artifacts & Preview',
    descriptionZh: '投影 Harness Session/Workspace 产物并路由到匹配的安全预览器。',
    descriptionEn: 'Projects Harness Session/Workspace artifacts and routes them to matching safe viewers.',
    surface: 'side-card',
    maturity: 'technical-preview',
    order: 10,
  })
  ctx.effect(() => installStyle(), 'paimind-artifacts: style')
  ctx.effect(() => {
    const registry = new ArtifactRegistry()
    const nativeSource = new HarnessDeliverableArtifactSource(ctx.sessions, ctx.paimindWorkspaceProject)
    const projectedSource = new HarnessProjectedArtifactSource(ctx.sessions, ctx.paimindWorkspaceProject)
    const offNative = registry.registerSource(nativeSource)
    const offProjected = registry.registerSource(projectedSource)
    const qaEnabled = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('paimindArtifactPreview') === '1'
    const offQa = qaEnabled ? registry.registerSource(QaArtifactSource(ctx)) : () => {}
    const disposeService = ctx.reflect.provide('paimindArtifacts', registry)
    const disposeTab = ctx.paimindSidebar.registerTab({
      id: 'paimind:artifacts',
      titleZh: 'PAIMind 产物',
      titleEn: 'PAIMind Artifacts',
      order: 51,
      single: true,
      icon: <ArtifactIcon />,
      render: scope => (
        <ArtifactErrorBoundary>
          <ArtifactPanel service={registry} sidebar={ctx.paimindSidebar} bentoPreview={ctx.paimindBentoPreview} scope={scope} />
        </ArtifactErrorBoundary>
      ),
    })
    return () => {
      disposeTab()
      void disposeService()
      offQa()
      offProjected()
      offNative()
      projectedSource.dispose()
      nativeSource.dispose()
      registry.dispose()
    }
  }, 'paimind-artifacts: service and tab')
}
