// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookup } from 'node:dns/promises'
import { request } from 'node:http'
import { isConnectorPublicAddress, openConnectorHttpEgress } from '../src/connector-http-egress.js'
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
const closes: Array<() => Promise<void>> = []
afterEach(async () => { vi.resetAllMocks(); for (const close of closes.splice(0)) await close() })
async function fixture() { const relay = await openConnectorHttpEgress({ url: 'https://public.test/mcp?key=SYNTHETIC_SECRET', headers: { authorization: 'SYNTHETIC_UPSTREAM' } }); closes.push(relay.close); return relay }
describe('native HTTP connector fixed-destination egress', () => {
  it('rejects private, special, mapped and transition addresses while retaining public dual-stack addresses', () => {
    for (const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.31.1.1','192.0.0.9','192.0.2.1','192.88.99.1',
      '192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:8.8.8.8','64:ff9b::808:808',
      'fc00::1','fe80::1','ff02::1','2001::1','2001:db8::1','2002:0808:0808::1','3fff::1','not-an-address']) expect(isConnectorPublicAddress(address), address).toBe(false)
    for (const address of ['1.1.1.1','8.8.8.8','11.255.254.3','2606:4700:4700::1111','2001:4860:4860::8888']) expect(isConnectorPublicAddress(address), address).toBe(true)
  })
  it('rejects private/ambiguous endpoints and invalid header overrides before opening any relay', async () => {
    for (const url of ['http://127.1/mcp','http://2130706433/mcp','http://0x7f000001/mcp','http://[::1]/mcp','http://[::ffff:8.8.8.8]/mcp',
      'http://user:SYNTHETIC_SECRET@public.test/mcp','ftp://public.test/mcp','https://public.test/mcp#fragment'])
      await expect(openConnectorHttpEgress({ url, headers: {} })).rejects.toThrow('Managed connector network destination is unavailable')
    for (const headers of [{ Host: 'other.test' }, { 'Mcp-Session-Id': 'forged' }, { 'Proxy-Authorization': 'secret' }, { 'X-Forwarded-Host': 'other.test' },
      { Authorization: 'one', authorization: 'two' }, { Custom: 'x\r\ninjected: value' }])
      await expect(openConnectorHttpEgress({ url: 'https://public.test/mcp', headers })).rejects.toThrow('unavailable')
    expect(lookup).not.toHaveBeenCalled()
  })
  it('requires the exact local endpoint, host, capability, method and absent browser Origin before DNS', async () => {
    const f = await fixture()
    for (const [url, options, status] of [
      [f.url, {}, 403], [f.url+'?target=other', { headers: f.headers }, 403],
      [f.url, { headers: { ...f.headers, origin: 'https://attacker.test' } }, 403],
      [f.url, { method: 'PUT', headers: f.headers }, 405],
    ] as const) {
      const result = await fetch(url, options); expect(result.status).toBe(status)
      expect(await result.text()).toBe('Managed connector request unavailable')
    }
    // Fetch owns Host; use the raw HTTP API to actually send a forged authority.
    const forged = await new Promise<number | undefined>((resolve, reject) => {
      const r = request(f.url, { headers: { ...f.headers, host: 'attacker.test' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) })
      r.on('error', reject); r.end()
    })
    expect(forged).toBe(403)
    expect(lookup).not.toHaveBeenCalled()
  })
  it('rejects mixed/private DNS answers and DNS failures per request, without disclosing upstream secrets', async () => {
    const f = await fixture(), mocked = vi.mocked(lookup)
    for (const answers of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }],
      [{ address: '1.1.1.1', family: 6 }]]) {
      mocked.mockResolvedValueOnce(answers as never)
      const result = await fetch(f.url, { headers: f.headers })
      expect(result.status).toBe(502); expect(await result.text()).not.toContain('SYNTHETIC')
    }
    mocked.mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_DNS_ERROR'))
    expect(await (await fetch(f.url, { headers: f.headers })).text()).toBe('Managed connector request unavailable')
    expect(mocked).toHaveBeenCalledTimes(5)
  })
  it('rejects oversized writes before DNS and closes capability listeners idempotently', async () => {
    const f = await fixture()
    // The stream can be closed before a response once its bounded input is exceeded.
    const result = await fetch(f.url, { method: 'POST', headers: f.headers, body: 'x'.repeat(1024*1024+1) }).catch(() => undefined)
    expect(result?.ok ?? false).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
    await f.close(); await f.close()
    await expect(fetch(f.url, { headers: f.headers })).rejects.toThrow()
  })
})
