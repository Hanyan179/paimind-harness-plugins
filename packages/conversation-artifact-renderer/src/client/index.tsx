import { useState, useSyncExternalStore } from 'react'
import {
  contributePaimindExtension,
  selectPaimindProducedFiles,
  type HarnessSessionService,
  type PaimindClientContext,
  type PaimindConversationTurnTailOwner,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import {
  resolveArtifactPath,
  type PaimindArtifactService,
  type PaimindArtifactState,
  type PaimindArtifactView,
} from '@paimind/artifacts'

export const inject = ['slots', 'sessions', 'paimindArtifacts', 'locale']

export interface ConversationArtifactRendererContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly paimindArtifacts: PaimindArtifactService
}

export interface ConversationArtifactFormat {
  readonly key: string
  readonly badge: string
  readonly labelZh: string
  readonly labelEn: string
  readonly actionZh: string
  readonly actionEn: string
}

const FORMATS: Readonly<Record<string, ConversationArtifactFormat>> = Object.freeze({
  markdown: Object.freeze({ key: 'markdown', badge: 'MD', labelZh: 'Markdown 文档', labelEn: 'Markdown document', actionZh: '打开文档', actionEn: 'Open document' }),
  json: Object.freeze({ key: 'json', badge: '{ }', labelZh: '结构化数据', labelEn: 'Structured data', actionZh: '查看数据', actionEn: 'View data' }),
  bento: Object.freeze({ key: 'bento', badge: 'B', labelZh: '可溯源 Bento 演示', labelEn: 'Traceable Bento presentation', actionZh: '打开演示', actionEn: 'Open presentation' }),
  html: Object.freeze({ key: 'html', badge: 'HTML', labelZh: '网页文档', labelEn: 'Web document', actionZh: '预览网页', actionEn: 'Preview page' }),
  pptx: Object.freeze({ key: 'pptx', badge: 'P', labelZh: 'PowerPoint 演示文稿', labelEn: 'PowerPoint presentation', actionZh: '预览幻灯片', actionEn: 'Preview slides' }),
  pdf: Object.freeze({ key: 'pdf', badge: 'PDF', labelZh: 'PDF 文档', labelEn: 'PDF document', actionZh: '预览文档', actionEn: 'Preview document' }),
  sheet: Object.freeze({ key: 'sheet', badge: 'X', labelZh: '电子表格', labelEn: 'Spreadsheet', actionZh: '预览表格', actionEn: 'Preview sheet' }),
  word: Object.freeze({ key: 'word', badge: 'W', labelZh: 'Word 文档', labelEn: 'Word document', actionZh: '预览文档', actionEn: 'Preview document' }),
  image: Object.freeze({ key: 'image', badge: 'IMG', labelZh: '图片', labelEn: 'Image', actionZh: '预览图片', actionEn: 'Preview image' }),
  file: Object.freeze({ key: 'file', badge: 'FILE', labelZh: '文件', labelEn: 'File', actionZh: '打开文件', actionEn: 'Open file' }),
})

const extensionOf = (path: string): string => {
  const clean = (path.split(/[?#]/, 1)[0] ?? path).replace(/\\/g, '/')
  const base = clean.slice(clean.lastIndexOf('/') + 1)
  const at = base.lastIndexOf('.')
  return at < 0 ? '' : base.slice(at + 1).toLowerCase()
}

export const basenameOf = (path: string): string => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || path
}

/** File extensions describe display format; Bento semantics require an exact Artifact fact. */
export function formatForConversationArtifact(
  path: string,
  artifact?: PaimindArtifactView,
): ConversationArtifactFormat {
  if (artifact?.kind === 'html' && artifact.previewKind === 'bento-deck') return FORMATS.bento!
  switch (extensionOf(path)) {
    case 'md': case 'markdown': return FORMATS.markdown!
    case 'json': case 'jsonl': case 'geojson': return FORMATS.json!
    case 'html': case 'htm': return FORMATS.html!
    case 'ppt': case 'pptx': return FORMATS.pptx!
    case 'pdf': return FORMATS.pdf!
    case 'xls': case 'xlsx': case 'csv': case 'tsv': return FORMATS.sheet!
    case 'doc': case 'docx': return FORMATS.word!
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': return FORMATS.image!
    default: return FORMATS.file!
  }
}

/** Match only an exact Session-scoped, Workspace-contained Artifact path. */
export function artifactForConversationPath(
  path: string,
  sessionId: string | undefined,
  cwd: string | undefined,
  artifacts: readonly PaimindArtifactView[],
): PaimindArtifactView | undefined {
  if (sessionId === undefined) return undefined
  const requested = resolveArtifactPath(cwd, path)
  if (requested.state !== 'safe') return undefined
  return artifacts.find(artifact => {
    if (artifact.sessionId !== sessionId) return false
    const candidate = resolveArtifactPath(cwd, artifact.path)
    return candidate.state === 'safe' && candidate.path === requested.path
  })
}

const STATE_COPY: Readonly<Record<PaimindArtifactState, readonly [string, string]>> = Object.freeze({
  available: ['可用', 'Available'],
  updating: ['更新中', 'Updating'],
  missing: ['文件缺失', 'Missing'],
  failed: ['生成失败', 'Failed'],
})

const STYLE_ID = '@paimind/conversation-artifact-renderer'
const STYLE = `
[data-paimind-conversation-artifacts]{margin:14px 0 6px;min-width:0}
[data-paimind-conversation-artifacts] *{box-sizing:border-box}
[data-paimind-conversation-artifact-header]{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 9px;color:var(--dsw-alias-label-tertiary,#7a808a);font-size:11px;line-height:16px}
[data-paimind-conversation-artifact-heading]{display:flex;align-items:center;gap:7px;font-weight:600;letter-spacing:.01em}
[data-paimind-conversation-artifact-heading]::before{content:'';width:6px;height:6px;border-radius:99px;background:var(--dsw-alias-state-business-primary,#5d78ff);box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-business-primary,#5d78ff) 12%,transparent)}
[data-paimind-conversation-artifact-grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px}
[data-paimind-conversation-artifact-card]{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto auto;column-gap:11px;row-gap:2px;width:100%;min-width:0;min-height:96px;padding:12px;border:1px solid var(--dsw-alias-border-l1,rgba(120,130,150,.2));border-radius:13px;color:var(--dsw-alias-label-primary,#202124);background:linear-gradient(145deg,color-mix(in srgb,var(--artifact-accent,#5d78ff) 8%,var(--dsw-alias-bg-layer-3,#fff)),var(--dsw-alias-bg-layer-2,rgba(255,255,255,.75)));box-shadow:0 4px 15px rgba(20,30,50,.045);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
[data-paimind-conversation-artifact-card]:hover:not(:disabled){border-color:color-mix(in srgb,var(--artifact-accent,#5d78ff) 52%,transparent);box-shadow:0 7px 22px color-mix(in srgb,var(--artifact-accent,#5d78ff) 13%,transparent);transform:translateY(-1px)}
[data-paimind-conversation-artifact-card]:focus-visible{outline:2px solid var(--artifact-accent,#5d78ff);outline-offset:2px}
[data-paimind-conversation-artifact-card]:disabled{opacity:.58;cursor:not-allowed}
[data-paimind-conversation-artifact-card][data-format='markdown']{--artifact-accent:#637083}
[data-paimind-conversation-artifact-card][data-format='json']{--artifact-accent:#b97813}
[data-paimind-conversation-artifact-card][data-format='bento']{--artifact-accent:#8a5cf6}
[data-paimind-conversation-artifact-card][data-format='html']{--artifact-accent:#dc5b43}
[data-paimind-conversation-artifact-card][data-format='pptx']{--artifact-accent:#dc5b35}
[data-paimind-conversation-artifact-card][data-format='pdf']{--artifact-accent:#d54141}
[data-paimind-conversation-artifact-card][data-format='sheet']{--artifact-accent:#22865b}
[data-paimind-conversation-artifact-card][data-format='word']{--artifact-accent:#3978ce}
[data-paimind-conversation-artifact-card][data-format='image']{--artifact-accent:#178f9e}
[data-paimind-conversation-artifact-badge]{grid-row:1/4;display:grid;place-items:center;align-self:start;width:38px;height:38px;border-radius:10px;color:var(--artifact-accent,#5d78ff);background:color-mix(in srgb,var(--artifact-accent,#5d78ff) 13%,transparent);font-size:10px;font-weight:750;letter-spacing:-.02em}
[data-paimind-conversation-artifact-title]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;font-weight:650}
[data-paimind-conversation-artifact-meta]{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary,#7a808a);font-size:10px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-conversation-artifact-action]{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;color:var(--artifact-accent,#5d78ff);font-size:10px;line-height:15px;font-weight:600}
[data-paimind-conversation-artifact-action]::after{content:'↗';font-size:13px;font-weight:400}
[data-paimind-conversation-artifact-more]{display:block;margin:8px 0 0;padding:4px 0;border:0;color:var(--dsw-alias-state-business-primary,#4f7ff8);background:transparent;font:inherit;font-size:11px;cursor:pointer}
@media(max-width:560px){[data-paimind-conversation-artifact-grid]{grid-template-columns:1fr}[data-paimind-conversation-artifact-card]{min-height:88px}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/conversation-artifact-renderer'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

export interface ConversationArtifactCardsProps extends PaimindConversationTurnTailOwner {
  readonly matched: readonly string[]
  readonly sessions: HarnessSessionService
  readonly artifacts: PaimindArtifactService
  readonly locale: PaimindLocaleSource
}

const INITIAL_VISIBLE = 4

/** Format-aware projection of one Turn's native produced-file facts. */
export function ConversationArtifactCards(props: ConversationArtifactCardsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const sessionSnapshot = useSyncExternalStore(
    props.sessions.list.subscribe.bind(props.sessions.list),
    props.sessions.list.getSnapshot.bind(props.sessions.list),
    props.sessions.list.getSnapshot.bind(props.sessions.list),
  )
  const artifactSnapshot = useSyncExternalStore(
    props.artifacts.subscribe.bind(props.artifacts),
    props.artifacts.getSnapshot.bind(props.artifacts),
    props.artifacts.getSnapshot.bind(props.artifacts),
  )
  const activeLocale = useSyncExternalStore(
    props.locale.subscribe.bind(props.locale),
    () => props.locale.getLocale().active,
    () => props.locale.getLocale().active,
  )
  const zh = activeLocale.startsWith('zh')
  const sessionId = sessionSnapshot.current
  const cwd = sessionId === undefined ? undefined : sessionSnapshot.byId[sessionId]?.cwd
  const shown = expanded ? props.matched : props.matched.slice(0, INITIAL_VISIBLE)
  const remaining = props.matched.length - shown.length

  return <section
    data-paimind-conversation-artifacts
    data-artifact-count={artifactSnapshot.artifacts.length}
    data-artifact-diagnostic-count={artifactSnapshot.diagnostics.length}
    aria-label={zh ? '已生成文件' : 'Generated files'}
  >
    <header data-paimind-conversation-artifact-header>
      <span data-paimind-conversation-artifact-heading>{zh ? '已生成文件' : 'Generated files'}</span>
      <span>{props.matched.length}</span>
    </header>
    <div data-paimind-conversation-artifact-grid>
      {shown.map(path => {
        const artifact = artifactForConversationPath(path, sessionId, cwd, artifactSnapshot.artifacts)
        const format = formatForConversationArtifact(path, artifact)
        const state = artifact?.state ?? 'available'
        const stateCopy = STATE_COPY[state]
        const title = artifact?.title ?? basenameOf(path)
        const meta = `${zh ? format.labelZh : format.labelEn} · ${zh ? stateCopy[0] : stateCopy[1]}`
        return <button
          key={path}
          type="button"
          data-paimind-conversation-artifact-card
          data-format={format.key}
          data-state={state}
          data-artifact-id={artifact?.id}
          title={path}
          aria-label={`${zh ? format.actionZh : format.actionEn}: ${title}`}
          disabled={state !== 'available'}
          onClick={() => {
            if (format.key === 'bento' && artifact !== undefined) {
              const result = props.artifacts.open?.(artifact.id, artifact.sourceId)
              if (result?.state === 'opened') return
            }
            props.openFile(path)
          }}
        >
          <span aria-hidden="true" data-paimind-conversation-artifact-badge>{format.badge}</span>
          <strong data-paimind-conversation-artifact-title>{title}</strong>
          <span data-paimind-conversation-artifact-meta>{meta}</span>
          <span data-paimind-conversation-artifact-action>{zh ? format.actionZh : format.actionEn}</span>
        </button>
      })}
    </div>
    {remaining > 0 && <button type="button" data-paimind-conversation-artifact-more onClick={() => { setExpanded(true) }}>
      {zh ? `显示其余 ${remaining} 个文件` : `Show ${remaining} more files`}
    </button>}
    {expanded && props.matched.length > INITIAL_VISIBLE && <button type="button" data-paimind-conversation-artifact-more onClick={() => { setExpanded(false) }}>
      {zh ? '收起文件' : 'Show fewer files'}
    </button>}
  </section>
}

export function apply(ctx: ConversationArtifactRendererContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:conversation-artifact-renderer',
    packageName: '@paimind/conversation-artifact-renderer',
    category: 'content-rendering',
    nameZh: '对话产物渲染器',
    nameEn: 'Conversation Artifact Renderer',
    descriptionZh: '将对话中原生已生成文件投影为格式专属卡片，并复用现有安全查看器。',
    descriptionEn: 'Projects native produced files as format-aware cards and delegates to existing safe viewers.',
    surface: 'conversation',
    maturity: 'technical-preview',
    order: 11,
  })
  ctx.effect(installStyle, 'paimind-conversation-artifact-renderer: styles')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'paimind-conversation-artifact-renderer',
    priority: -10,
    select: selectPaimindProducedFiles,
  }, (props: PaimindConversationTurnTailOwner & { readonly matched: readonly string[] }) => <ConversationArtifactCards
    {...props}
    sessions={ctx.sessions}
    artifacts={ctx.paimindArtifacts}
    locale={ctx.locale}
  />))
}
