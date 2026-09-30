import { createClientContextFixture as createBaseFixture } from '@paimind/testkit'
import type { apply } from '../src/client/index.js'
import type { AgentCenterContributions } from '../../agent-market/src/client/contributions.js'
import type { SkillCenterContributions } from '../../skill-market/src/client/contributions.js'
import type { FeatureManagementContributions } from '../../extension-center/src/client/contributions.js'

/** Minimal dynamic child-service fixture, not a native runtime acceptance. */
export function createClientContextFixture() {
  const base = createBaseFixture()
  type Context = Parameters<typeof apply>[0]
  let registry: AgentCenterContributions | undefined
  let skills: SkillCenterContributions | undefined
  let features: FeatureManagementContributions | undefined
  const available = (name: string) => name === 'paimindAgentCenterContributions' ? registry : name === 'paimindSkillCenterContributions' ? skills : features
  const children = new Set<{ name: string; install: (scope: Context) => () => void; remove?: () => void }>()
  const context: Context = { ...base.context,
    connection: { hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } },
    get paimindAgentCenterContributions() { if (!registry) throw new Error('Owner absent in fixture'); return registry },
    get paimindSkillCenterContributions() { if (!skills) throw new Error('Skill owner absent in fixture'); return skills },
    get paimindFeatureManagementContributions() { if (!features) throw new Error('Feature owner absent in fixture'); return features },
    inject(services, install) {
      if (services.length !== 1 || !['paimindAgentCenterContributions', 'paimindSkillCenterContributions', 'paimindFeatureManagementContributions'].includes(services[0]!)) throw new Error('Unknown fixture dependency')
      const child: { name: string; install: typeof install; remove?: () => void } = { name: services[0]!, install }
      children.add(child)
      if (available(child.name)) child.remove = install(context)
      return Object.assign(Promise.resolve(), { dispose: async () => { child.remove?.(); children.delete(child) } })
    },
  }
  return { ...base, context,
    setFeatureOwner(next?: FeatureManagementContributions) {
      const selected = [...children].filter(child => child.name === 'paimindFeatureManagementContributions')
      for (const child of selected) { child.remove?.(); child.remove = undefined }
      features = next
      if (features) for (const child of selected) child.remove = child.install(context)
    },
    setOwner(next?: AgentCenterContributions) {
      const selected = [...children].filter(child => child.name === 'paimindAgentCenterContributions')
      for (const child of selected) { child.remove?.(); child.remove = undefined }
      registry = next
      if (registry) for (const child of selected) child.remove = child.install(context)
    },
    setSkillOwner(next?: SkillCenterContributions) {
      const selected = [...children].filter(child => child.name === 'paimindSkillCenterContributions')
      for (const child of selected) { child.remove?.(); child.remove = undefined }
      skills = next
      if (skills) for (const child of selected) child.remove = child.install(context)
    },
  }
}
