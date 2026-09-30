// @vitest-environment node
import { mkdtemp, realpath, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import { createNativeConnectorConfiguration } from '../src/connector-configuration.js'
import { handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const closes: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })
const signal = () => new AbortController().signal
const configuration = (name='sales', secret='SYNTHETIC_VERSION_SECRET') => ({ transport:'streamable-http',serverName:name,url:'https://example.invalid/mcp',
 headers:{Authorization:secret,'X-A':'a'},toolCallTimeoutMs:5000,failOnStartupError:true,
 reconnect:{enabled:false,initialDelayMs:100,maxDelayMs:1000,maxAttempts:1} })
async function fixture(legacy=false) {
 const home=await realpath(await mkdtemp(join(tmpdir(),'paimind-connector-release-'))),directory=join(home,'.enterprise-connectors'),file=join(directory,'cordis.json'),root=join(home,'root.json')
 await writeFile(root,'[]',{mode:0o600})
 if(legacy){await mkdir(directory,{mode:0o700});await writeFile(file,JSON.stringify([{id:'sales',name:'@deepseek-ai/dsh-mcp-client',disabled:true,config:configuration()}]),{mode:0o600})}
 const start=async()=>{const ctx=await boot('release-reference',root,[]);closes.push(()=>ctx.fiber.dispose());const owner=await createNativeConnectorConfiguration(ctx,directory)
 ctx.provide('paimindNativeConnectorConfiguration',owner)
 const read=(entryId='sales',expectedRevision=owner.read(signal()).revision)=>owner.release({entryId,expectedRevision},signal())
 const put=(entryId='sales',config=configuration(entryId))=>owner.configure({kind:'upsert',entryId,configuration:config,expectedRevision:owner.read(signal()).revision},signal())
 return {ctx,owner,read,put}}
 return {home,directory,file,start,...await start()}
}
describe('stable exact native connector release references, never approval or activation',()=>{
 it('survives real native owner restart, while optimistic process revision changes and secrets remain private',async()=>{
  const f=await fixture();await f.put();const before=f.read(),bytes=await readFile(f.file,'utf8'),key=JSON.parse(bytes)[0].paimindVersionKey
  expect(before.outcome).toBe('current');expect(before.reference?.configurationVersion).toMatch(/^[a-f0-9]{64}$/)
  expect(key).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(before)).not.toContain(key);expect(JSON.stringify(before)).not.toMatch(/SYNTHETIC|example.invalid/)
  await f.ctx.fiber.dispose();const next=await f.start(),after=next.read()
  expect(after.reference).toEqual(before.reference);expect(after.revision).not.toBe(before.revision);expect(await readFile(f.file,'utf8')).toBe(bytes)
  expect(next.read('sales',before.revision)).toMatchObject({outcome:'conflict',reference:null})
  expect(next.owner.read(signal()).entries[0]?.enabled).toBe(false)
 })
 it('preserves exact no-op writes and unaffected siblings, but changes, restoring old input and recreation never reuse an old version',async()=>{
  const f=await fixture();await f.put();const before=f.read(),bytes=await readFile(f.file,'utf8')
  expect((await f.put()).outcome).toBe('unchanged');expect(await readFile(f.file,'utf8')).toBe(bytes)
  await f.put('support');expect(f.read().reference).toEqual(before.reference)
  expect(f.read('sales',before.revision).outcome).toBe('conflict')
  await f.put('sales',configuration('sales','CHANGED_SECRET'));const changed=f.read().reference
  expect(changed?.configurationVersion).not.toBe(before.reference?.configurationVersion)
  await f.put();const restored=f.read().reference;expect(restored?.configurationVersion).not.toBe(before.reference?.configurationVersion)
  await f.owner.configure({kind:'remove',entryId:'sales',expectedRevision:f.owner.read(signal()).revision},signal())
  expect(f.read()).toMatchObject({outcome:'missing',reference:null});await f.put()
  expect(f.read().reference?.configurationVersion).not.toBe(restored?.configurationVersion)
 })
 it('gives independent owners different opaque references even for identical entry IDs and secret configurations',async()=>{
  const a=await fixture(),b=await fixture();await a.put();await b.put()
  expect(a.read().reference?.configurationVersion).not.toBe(b.read().reference?.configurationVersion)
 })
 it('retains legacy bytes and makes them explicitly unversioned until the administrator submits a full valid replacement',async()=>{
  const f=await fixture(true),bytes=await readFile(f.file,'utf8')
  expect(f.read()).toMatchObject({outcome:'unversioned',reference:null});expect(await readFile(f.file,'utf8')).toBe(bytes)
  await f.put('support');expect(JSON.parse(await readFile(f.file,'utf8'))[0].paimindVersionKey).toBeUndefined()
  expect(f.read().outcome).toBe('unversioned');expect((await f.put()).outcome).toBe('saved-disabled');expect(f.read().outcome).toBe('current')
 })
 it('derives the version from actual canonical content, not just the retained key or JSON layout',async()=>{
  const f=await fixture();await f.put();const before=f.read().reference,rows=JSON.parse(await readFile(f.file,'utf8'))
  await f.ctx.fiber.dispose()
  rows[0].config.headers=Object.fromEntries(Object.entries(rows[0].config.headers).reverse())
  await writeFile(f.file,JSON.stringify(rows,null,4),{mode:0o600});const reordered=await f.start()
  expect(reordered.read().reference).toEqual(before);await reordered.ctx.fiber.dispose()
  rows[0].config.headers.Authorization='MODIFIED_WITH_RETAINED_KEY'
  await writeFile(f.file,JSON.stringify(rows),{mode:0o600});const modified=await f.start()
  expect(modified.read().reference?.configurationVersion).not.toBe(before?.configurationVersion)
 })
 it('rejects malformed persisted version keys before mounting entries and never rewrites the rejected file',async()=>{
  const f=await fixture();await f.put();await f.ctx.fiber.dispose();const rows=JSON.parse(await readFile(f.file,'utf8'))
  for(const invalid of ['', 'a'.repeat(63), {__jsExpr:'process.exit()'}]){
   rows[0].paimindVersionKey=invalid;const bytes=JSON.stringify(rows);await writeFile(f.file,bytes,{mode:0o600})
   await expect(f.start()).rejects.toThrow();expect(await readFile(f.file,'utf8')).toBe(bytes)
  }
 })
 it('uses the original owner through the bounded private release operation and rejects stale, canceled and caller-invented version inputs',async()=>{
  const f=await fixture();await f.put();const input={entryId:'sales',expectedRevision:f.owner.read(signal()).revision}
  expect(await handleNativeControl(f.ctx,'connector.release',input,signal())).toEqual(f.read())
  for(const patch of [{expectedRevision:'bad'},{configurationVersion:'a'.repeat(64)},{paimindVersionKey:'a'.repeat(64)},{entryId:'../sales'},{enabled:true}]){
   await expect(handleNativeControl(f.ctx,'connector.release',{...input,...patch},signal())).rejects.toThrow()
  }
  const canceled=new AbortController();canceled.abort();expect(()=>f.owner.release(input,canceled.signal)).toThrow()
  await f.ctx.fiber.dispose();expect(()=>f.owner.release(input,signal())).toThrow()
 })
})
