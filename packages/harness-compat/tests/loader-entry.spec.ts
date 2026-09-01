import { describe, expect, it, vi } from 'vitest'
import {
  describePaimindHostLoaderEntry,
  setPaimindHostLoaderEntryEnabled,
  type PaimindHostLoaderEntry,
  type PaimindHostLoaderFacility,
} from '../src/host.js'

function nestedLoader(disabled: boolean): {
  loader: PaimindHostLoaderFacility
  entry: PaimindHostLoaderEntry
  update: ReturnType<typeof vi.fn>
} {
  const entry: PaimindHostLoaderEntry = {
    id: 'paimind-bundle:paimind-pack-experience',
    options: {
      id: 'paimind-pack-experience',
      name: 'cordis:group',
      group: true,
      disabled,
    },
  }
  const update = vi.fn(async () => undefined)
  return {
    entry,
    update,
    loader: {
      entries: () => [entry],
      await: async () => undefined,
      resolve: () => { throw new Error('not a root entry') },
      update,
    },
  }
}

function nestedRuntimeLoader(disabled: boolean): {
  loader: PaimindHostLoaderFacility
  entry: PaimindHostLoaderEntry
  runtimeUpdate: ReturnType<typeof vi.fn>
  persistedUpdate: ReturnType<typeof vi.fn>
} {
  const persistedUpdate = vi.fn(async () => undefined)
  const runtimeUpdate = vi.fn(async (options: { readonly disabled?: boolean | null }) => {
    if (options.disabled === true) entry.options.disabled = true
    else delete entry.options.disabled
  })
  const entry = {
    id: 'paimind-bundle:paimind-pack-experience',
    options: {
      id: 'paimind-pack-experience',
      name: 'cordis:group',
      group: true,
      disabled,
    },
    update: runtimeUpdate,
  } as PaimindHostLoaderEntry & { options: PaimindHostLoaderEntry['options'] & { disabled?: boolean | null } }
  return {
    entry,
    runtimeUpdate,
    persistedUpdate,
    loader: {
      entries: () => [entry],
      await: async () => undefined,
      resolve: () => { throw new Error('not a root entry') },
      update: persistedUpdate,
    },
  }
}

describe('PAIMind Host Loader compatibility', () => {
  it('describes a logical product id nested below an Include entry', () => {
    const { loader } = nestedLoader(false)

    expect(describePaimindHostLoaderEntry(loader, 'paimind-pack-experience')).toEqual({
      entryId: 'paimind-pack-experience',
      installed: true,
      enabled: true,
    })
  })

  it('updates the fully-qualified runtime id for a nested product entry', async () => {
    const { loader, update } = nestedLoader(false)

    await setPaimindHostLoaderEntryEnabled(loader, 'paimind-pack-experience', false)

    expect(update).toHaveBeenCalledWith(
      'paimind-bundle:paimind-pack-experience',
      { disabled: true },
    )
  })

  it('uses the runtime entry transition without rewriting the file-backed Loader tree', async () => {
    const { loader, entry, runtimeUpdate, persistedUpdate } = nestedRuntimeLoader(true)

    await setPaimindHostLoaderEntryEnabled(loader, 'paimind-pack-experience', true)

    expect(runtimeUpdate).toHaveBeenCalledWith({ disabled: null })
    expect(persistedUpdate).not.toHaveBeenCalled()
    expect(entry.options.disabled).toBeUndefined()
  })

  it('rejects duplicate logical product ids instead of toggling an arbitrary entry', () => {
    const first = nestedLoader(false).entry
    const second = { ...first, id: 'another-bundle:paimind-pack-experience' }
    const loader: PaimindHostLoaderFacility = {
      entries: () => [first, second],
      await: async () => undefined,
      resolve: () => { throw new Error('not a root entry') },
      update: async () => undefined,
    }

    expect(() => describePaimindHostLoaderEntry(loader, 'paimind-pack-experience'))
      .toThrow('is ambiguous (2 matches)')
  })

})
