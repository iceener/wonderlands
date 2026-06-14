import type {
  AcceptedRunResumeOutput,
  AcceptedThreadInteractionOutput,
  BackendPendingWait,
  BackendSession,
  BackendThread,
  BackendThreadRootJob,
  BackendUsage,
  BootstrapSessionAcceptedOutput,
  BootstrapSessionOutput,
  BootstrapSessionRouteOutput,
  CancelRunOutput,
  CompletedRunExecutionOutput,
  PostThreadMessageOutput,
  ResumeRunOutput,
  RunExecutionOutput,
  StartThreadInteractionOutput,
  WaitingRunExecutionOutput,
} from '@wonderlands/contracts/chat'
import type {
  AcceptedRunResumeOutputContract,
  AcceptedThreadInteractionOutputContract,
  BackendPendingWaitContract,
  BackendSessionContract,
  BackendThreadContract,
  BackendThreadRootJobContract,
  BackendUsageContract,
  BootstrapSessionAcceptedOutputContract,
  BootstrapSessionExecutionOutputContract,
  BootstrapSessionRouteOutputContract,
  CancelRunOutputContract,
  CompletedRunExecutionOutputContract,
  PostThreadMessageOutputContract,
  ResumeRunOutputContract,
  RunExecutionOutputContract,
  StartThreadInteractionOutputContract,
  WaitingRunExecutionOutputContract,
} from '@wonderlands/contracts/conversation-schemas'
import { describe, expectTypeOf, it } from 'vitest'

describe('contracts parity', () => {
  it('keeps exported conversation payload types aligned with schema-derived contracts', () => {
    expectTypeOf<BackendThreadRootJob>().toMatchTypeOf<BackendThreadRootJobContract>()
    expectTypeOf<BackendThread>().toMatchTypeOf<BackendThreadContract>()
    expectTypeOf<BackendSession>().toMatchTypeOf<BackendSessionContract>()
    expectTypeOf<BackendUsage>().toEqualTypeOf<BackendUsageContract>()
    expectTypeOf<AcceptedRunResumeOutput>().toMatchTypeOf<AcceptedRunResumeOutputContract>()
    expectTypeOf<CompletedRunExecutionOutput>().toMatchTypeOf<CompletedRunExecutionOutputContract>()
    expectTypeOf<BackendPendingWait>().toMatchTypeOf<BackendPendingWaitContract>()
    expectTypeOf<WaitingRunExecutionOutput>().toMatchTypeOf<WaitingRunExecutionOutputContract>()
    expectTypeOf<RunExecutionOutput>().toMatchTypeOf<RunExecutionOutputContract>()
    expectTypeOf<ResumeRunOutput>().toMatchTypeOf<ResumeRunOutputContract>()
    expectTypeOf<BootstrapSessionAcceptedOutput>().toMatchTypeOf<BootstrapSessionAcceptedOutputContract>()
    expectTypeOf<BootstrapSessionOutput>().toMatchTypeOf<BootstrapSessionExecutionOutputContract>()
    expectTypeOf<BootstrapSessionRouteOutput>().toMatchTypeOf<BootstrapSessionRouteOutputContract>()
    expectTypeOf<PostThreadMessageOutput>().toMatchTypeOf<PostThreadMessageOutputContract>()
    expectTypeOf<AcceptedThreadInteractionOutput>().toMatchTypeOf<AcceptedThreadInteractionOutputContract>()
    expectTypeOf<CancelRunOutput>().toMatchTypeOf<CancelRunOutputContract>()
    expectTypeOf<StartThreadInteractionOutput>().toMatchTypeOf<StartThreadInteractionOutputContract>()
  })
})
