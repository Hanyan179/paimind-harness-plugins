/** Host half of the FP03 native-capability contract package. */
export const name = 'paimind-conversation-extensions'

/** The host half is intentionally empty; native Harness packages own every FP03 runtime surface. */
export function apply(): void {}

export type ConversationCapabilityDisposition = 'harness-native' | 'later-paimind-package'

export interface ConversationCapabilityRecord {
  readonly id:
    | 'questions'
    | 'plan-progress'
    | 'image-attachments'
    | 'workspace-file-references'
    | 'document-upload'
    | 'deliverables'
    | 'failure-recovery'
    | 'native-trajectory-rows'
  readonly disposition: ConversationCapabilityDisposition
  readonly owner: string
  readonly duplicateUiForbidden: boolean
}

/**
 * Immutable FP03 ownership ledger. It is diagnostic metadata, never a second
 * Session state store. FP16 may expose it in Developer Resources.
 */
export const CONVERSATION_CAPABILITIES: readonly ConversationCapabilityRecord[] = Object.freeze([
  { id: 'questions', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-user-questions', duplicateUiForbidden: true },
  { id: 'plan-progress', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-conversation', duplicateUiForbidden: true },
  { id: 'image-attachments', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-attachment', duplicateUiForbidden: true },
  { id: 'workspace-file-references', disposition: 'harness-native', owner: 'Harness input references and filesystem tools', duplicateUiForbidden: true },
  { id: 'document-upload', disposition: 'later-paimind-package', owner: 'FP04/FP06', duplicateUiForbidden: false },
  { id: 'deliverables', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-deliverables', duplicateUiForbidden: true },
  { id: 'failure-recovery', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-conversation', duplicateUiForbidden: true },
  { id: 'native-trajectory-rows', disposition: 'harness-native', owner: '@deepseek-ai/dsh-client-ui-tool', duplicateUiForbidden: true },
])

