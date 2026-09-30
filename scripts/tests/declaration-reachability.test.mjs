import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPackedDeclarations, declarationReferences, declaredTypeEntries } from '../declaration-reachability.mjs'

test('declaration edges include actual import/export/type-query/reference forms, not comments or string contents', () => {
  const source = `
    // import X from './fake.js';
    /** import('./fake-doc.js') */
    export type Text = "import('./fake-string.js')";
    import type { A } from './a.js'; export { B } from './b.js';
    import './side.js'; export type C = import('./c.js').C;
    import D = require('./d.cjs');
    /// <reference path="./ref.d.ts" />
    declare module './augment.js' {}
    import type { External } from 'external';
  `
  assert.deepEqual(declarationReferences(source).map(r => r.specifier),
    ['./a.js', './b.js', './side.js', './c.js', './d.cjs', './ref.d.ts', './augment.js', 'external'])
})

test('template literal text cannot manufacture an edge but embedded type queries remain visible', () => {
  const source = "export type A<T> = `prefix ${T} import('./fake.js')`; export type B = `${import('./real.js').B}`;"
  assert.deepEqual(declarationReferences(source).map(r => r.specifier), ['./real.js'])
})

test('documented build runtime and native client declarations are legitimate roots without widening exports', () => {
  assert.deepEqual(declaredTypeEntries({ types: 'lib/types/index.d.ts', paimindBuild: {
    node: ['src/cli.ts'], client: 'src/client/index.tsx',
  } }, ['./lib/types/index.d.ts', './lib/index.js']), [
    './lib/types/index.d.ts', 'lib/types/index.d.ts', 'lib/types/cli.d.ts', 'lib/types/client/index.d.ts',
  ])
})

test('follows packed declaration closure and flags orphan cycles and missing packed dependencies', () => {
  const contents = new Map([
    ['lib/index.d.ts', `export * from './a.js'; export type B = import('./b.mjs').B; import './missing.js';`],
    ['lib/a.d.ts', `export * from './index.js';`],
    ['lib/b.d.mts', 'export type B = string;'],
    ['lib/orphan.d.ts', `export * from './unused.js';`],
    ['lib/unused.d.ts', `export * from './orphan.js';`],
  ])
  assert.deepEqual(auditPackedDeclarations(contents, ['./lib/index.d.ts']), {
    reachable: ['lib/a.d.ts', 'lib/b.d.mts', 'lib/index.d.ts'],
    orphaned: ['lib/orphan.d.ts', 'lib/unused.d.ts'],
    missing: ['lib/index.d.ts: missing packed dependency ./missing.js'],
  })
})

test('rejects absent exported declarations and package escapes while accepting local reference paths', () => {
  const contents = new Map([
    ['lib/index.d.ts', `/// <reference path="ref.d.ts" />\nexport * from '../../outside.js';`],
    ['lib/ref.d.ts', 'export type A = string;'],
  ])
  const result = auditPackedDeclarations(contents, ['./lib/index.d.ts', './lib/absent.d.ts'])
  assert.deepEqual(result.reachable, ['lib/index.d.ts', 'lib/ref.d.ts'])
  assert.deepEqual(result.missing, ['entry: lib/absent.d.ts', 'lib/index.d.ts: outside package ../../outside.js'])
})
