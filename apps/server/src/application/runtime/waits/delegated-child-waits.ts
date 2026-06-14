import type { RunDependencyRecord } from '../../../domain/runtime/run-dependency-repository'

type WaitLike = Pick<RunDependencyRecord, 'targetKind' | 'type'>

export const isParentDeliverableChildWait = (wait: WaitLike): boolean => {
  if (wait.type === 'agent' && wait.targetKind === 'run') {
    return false
  }

  // External tool waits such as sandbox executions are runtime-managed and
  // resolve themselves. Surfacing them as resumable delegated waits causes
  // parent/child orchestration loops.
  if (wait.type === 'tool' && wait.targetKind === 'external') {
    return false
  }

  return true
}
