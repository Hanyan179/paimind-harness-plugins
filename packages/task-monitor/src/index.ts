import {
  defineArtifactProjection,
  PAIMIND_ARTIFACT_JOB_KIND,
  type ArtifactProducedEnvelopeV1,
  type PaimindArtifactProjectionV1,
} from '@paimind/contracts'
import type { HarnessNativeJobView } from '@paimind/harness-compat'

export const name = 'paimind-task-monitor'

/** Host state remains in Harness `ctx.jobs`; this package is a browser projection only. */
export function apply(): void {}

export interface PaimindArtifactJobView extends HarnessNativeJobView {
  readonly artifact?: Readonly<ArtifactProducedEnvelopeV1>
}

export function isLivePaimindJob(job: HarnessNativeJobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Exact producer kind only; labels, commands and model prose never classify a task. */
export function isPaimindArtifactJob(job: HarnessNativeJobView): boolean {
  return job.kind === PAIMIND_ARTIFACT_JOB_KIND
}

export function artifactsFromProjection(value: unknown): readonly Readonly<ArtifactProducedEnvelopeV1>[] {
  try {
    return defineArtifactProjection(value as PaimindArtifactProjectionV1).artifacts
  } catch {
    return Object.freeze([])
  }
}

/** Native Jobs are authoritative; the durable Artifact projection only enriches correlation. */
export function projectPaimindArtifactJobs(
  jobs: readonly HarnessNativeJobView[],
  artifacts: readonly Readonly<ArtifactProducedEnvelopeV1>[],
): readonly PaimindArtifactJobView[] {
  const artifactByTask = new Map(artifacts.map(artifact => [artifact.taskId, artifact]))
  return Object.freeze(jobs
    .filter(isPaimindArtifactJob)
    .map(job => {
      const artifact = artifactByTask.get(job.id)
      return Object.freeze({ ...job, ...(artifact === undefined ? {} : { artifact }) })
    })
    .sort((left, right) => {
      const live = Number(isLivePaimindJob(right)) - Number(isLivePaimindJob(left))
      if (live !== 0) return live
      if (isLivePaimindJob(left)) return left.startedAt - right.startedAt
      return (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    }))
}
