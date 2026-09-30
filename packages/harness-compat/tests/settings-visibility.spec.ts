import { afterEach, describe, expect, it, vi } from 'vitest'
import { installHarnessSettingsSectionVisibility, type HarnessInspectableSlotRegistry } from '../src/index.js'

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); document.body.innerHTML = '' })
const flush = async () => { await new Promise(done => setTimeout(done, 0)) }
function fixture() {
  const entries = ['general', 'models', 'account'].map(id => ({ options: { id, label: () => id } }))
  const changes = new Set<() => void>()
  const roles = new Set<() => void>()
  let allowed: readonly string[] | null = ['account']
  const slots: HarnessInspectableSlotRegistry = { entries: () => entries, getVersion: () => 1,
    register: () => () => {}, inject: () => {},
    subscribe: (_name, callback) => { changes.add(callback); return () => { changes.delete(callback) } } }
  const projection = { getSnapshot: () => allowed,
    subscribe: (callback: () => void) => { roles.add(callback); return () => { roles.delete(callback) } } }
  const update = (value: readonly string[] | null) => { allowed = value; for (const callback of roles) callback() }
  return { entries, slots, projection, update, changes, roles }
}
function shell() {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true')
  dialog.innerHTML = '<nav><div>Settings</div><div><button aria-current="true">general</button><button>models</button><button>account</button></div></nav><div><div><button>Close</button></div><div>general content</div></div>'
  document.body.append(dialog)
  const [general, models, account] = [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
  const openAccount = vi.fn(() => {
    general!.removeAttribute('aria-current'); account!.setAttribute('aria-current', 'true')
    dialog.children[1]!.children[1]!.textContent = 'account content'
  })
  account!.addEventListener('click', openAccount)
  return { dialog, general: general!, models: models!, account: account!, openAccount }
}
describe('native role navigation projection (DOM contract, not authorization or Browser E2E)', () => {
  it('uses the existing native account action, hides only disallowed rows and fully restores without replacing owners', () => {
    const f = fixture(); const s = shell()
    s.models.style.setProperty('display', 'inline-block', 'important')
    s.general.focus()
    const dispose = installHarnessSettingsSectionVisibility(f.slots, f.projection, 'account'); disposers.push(dispose)
    expect(s.general.hidden).toBe(true); expect(s.models.hidden).toBe(true); expect(s.account.hidden).toBe(false)
    expect(s.openAccount).toHaveBeenCalledOnce(); expect(s.account).toHaveFocus()
    expect(s.dialog.querySelectorAll('button')).toHaveLength(4)
    f.update(null)
    expect(s.general.hidden).toBe(false); expect(s.models.style.getPropertyValue('display')).toBe('inline-block')
    expect(s.models.style.getPropertyPriority('display')).toBe('important')
    f.update(['account']); expect(s.general.hidden).toBe(true)
    dispose(); dispose()
    expect(s.general.hidden).toBe(false); expect(f.changes.size).toBe(0); expect(f.roles.size).toBe(0)
  })
  it('handles late modal mount and repeated observations without repeated navigation or stealing close focus', async () => {
    const f = fixture(); disposers.push(installHarnessSettingsSectionVisibility(f.slots, f.projection, 'account'))
    const s = shell(); const close = s.dialog.querySelector<HTMLButtonElement>('nav+div button')!; close.focus()
    await flush(); await flush()
    expect(s.openAccount).toHaveBeenCalledOnce(); expect(close).toHaveFocus()
    s.dialog.remove(); await flush(); expect(s.general.hidden).toBe(false)
    document.body.append(s.dialog); await flush()
    expect(s.general.hidden).toBe(true); expect(s.openAccount).toHaveBeenCalledOnce()
  })
  it('leaves administrators unchanged and refuses ambiguous or missing native section identities', async () => {
    const f = fixture(); f.update(null); const s = shell()
    disposers.push(installHarnessSettingsSectionVisibility(f.slots, f.projection, 'account'))
    expect(s.general.hidden).toBe(false); expect(s.openAccount).not.toHaveBeenCalled()
    const duplicate = shell(); f.update(['account'])
    expect(s.general.hidden).toBe(false); expect(duplicate.general.hidden).toBe(false)
    duplicate.dialog.remove(); await flush(); expect(s.general.hidden).toBe(true)
    f.entries.push({ options: { id: 'unknown-owner', label: () => 'models' } })
    for (const changed of f.changes) changed()
    expect(s.general.hidden).toBe(false); expect(s.models.hidden).toBe(false)
    f.update([]); expect(s.account.hidden).toBe(false)
  })
})
