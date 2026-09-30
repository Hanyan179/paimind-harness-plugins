import { posix } from 'node:path'
import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'

export const isDeclaration = path => /\.d\.(?:ts|mts|cts)$/.test(path)

// Use the installed TypeScript lexer, not a regex over comments and string
// contents. This only resolves package-local declaration edges; external
// package contracts remain the external-consumer gate's responsibility.
export function declarationReferences(source) {
  const scanner = createScanner(false, undefined, source)
  const tokens = []; const references = []; const templateDepths = []
  let braceDepth = 0
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.CloseBraceToken && templateDepths.at(-1) === braceDepth) {
      kind = scanner.reScanTemplateToken(false)
      if (kind === SyntaxKind.TemplateTail) templateDepths.pop()
    } else if (kind === SyntaxKind.OpenBraceToken) braceDepth += 1
    else if (kind === SyntaxKind.CloseBraceToken) braceDepth -= 1
    if (kind === SyntaxKind.TemplateHead) templateDepths.push(braceDepth)
    if (kind === SyntaxKind.SingleLineCommentTrivia) {
      const text = scanner.getTokenText()
      if (/^\/\/\/\s*<reference\s/.test(text)) {
        const path = text.match(/\bpath\s*=\s*(["'])(.*?)\1/)
        if (path) references.push({ specifier: path[2], pathReference: true })
      }
      continue
    }
    if ([SyntaxKind.MultiLineCommentTrivia, SyntaxKind.WhitespaceTrivia, SyntaxKind.NewLineTrivia].includes(kind)) continue
    if (kind === SyntaxKind.StringLiteral) {
      const prior = tokens.at(-1); const before = tokens.at(-2)
      if (prior?.text === 'from' || prior?.kind === SyntaxKind.ImportKeyword
        || (prior?.kind === SyntaxKind.OpenParenToken && ['import', 'require'].includes(before?.text))
        || (prior?.kind === SyntaxKind.ModuleKeyword && before?.kind === SyntaxKind.DeclareKeyword)) {
        references.push({ specifier: scanner.getTokenValue(), pathReference: false })
      }
    }
    tokens.push({ kind, text: scanner.getTokenText() })
    if (tokens.length > 2) tokens.shift()
  }
  return references
}

export function declaredTypeEntries(manifest, exportTargets) {
  const entries = [...exportTargets]
  if (manifest.types) entries.push(manifest.types)
  for (const source of [...(manifest.paimindBuild?.node ?? []), ...(manifest.paimindBuild?.client ? [manifest.paimindBuild.client] : [])]) {
    entries.push(`lib/types/${source.replace(/^src\//, '').replace(/\.tsx?$/, '.d.ts')}`)
  }
  return entries.filter(isDeclaration)
}

export function auditPackedDeclarations(contents, entryPaths) {
  const declarations = new Map([...contents].filter(([path]) => isDeclaration(path)))
  const reachable = new Set(); const missing = new Set(); const pending = []
  for (const path of new Set(entryPaths.filter(isDeclaration))) {
    const normalized = posix.normalize(path.replace(/^\.\//, ''))
    if (!declarations.has(normalized)) missing.add(`entry: ${normalized}`)
    else pending.push(normalized)
  }
  while (pending.length) {
    const path = pending.pop()
    if (reachable.has(path)) continue
    reachable.add(path)
    for (const reference of declarationReferences(declarations.get(path))) {
      const { specifier, pathReference } = reference
      if (!pathReference && !specifier.startsWith('.')) continue
      const relative = posix.normalize(posix.join(posix.dirname(path), specifier))
      if (posix.isAbsolute(specifier) || relative === '..' || relative.startsWith('../')) {
        missing.add(`${path}: outside package ${specifier}`); continue
      }
      const candidates = isDeclaration(relative) ? [relative]
        : /\.(?:[cm]?[jt]s)$/.test(relative)
          ? [relative.replace(/\.(?:js|ts)$/, '.d.ts').replace(/\.(?:mjs|mts)$/, '.d.mts').replace(/\.(?:cjs|cts)$/, '.d.cts')]
          : [`${relative}.d.ts`, `${relative}/index.d.ts`]
      const target = candidates.find(candidate => declarations.has(candidate))
      if (target === undefined) missing.add(`${path}: missing packed dependency ${specifier}`)
      else pending.push(target)
    }
  }
  return { reachable: [...reachable].sort(), missing: [...missing].sort(),
    orphaned: [...declarations.keys()].filter(path => !reachable.has(path)).sort() }
}
