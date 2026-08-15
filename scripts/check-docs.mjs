import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('.')
const files = [resolve(root, 'README.md')]
for (const file of await readdir(resolve(root, 'docs'), { recursive: true })) {
  if (file.endsWith('.md')) files.push(resolve(root, 'docs', file))
}

const failures = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1]?.trim() ?? ''
    if (raw === '' || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue
    const target = decodeURIComponent(raw.split('#')[0] ?? '')
    if (target === '') continue
    try { await access(resolve(dirname(file), target)) } catch {
      failures.push(`${file.slice(root.length + 1)}: missing link target ${raw}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`documentation check passed: ${files.length} Markdown file(s), zero missing local links`)
}

