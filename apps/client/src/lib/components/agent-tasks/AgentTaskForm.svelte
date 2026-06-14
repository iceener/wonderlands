<script lang="ts">
import type {
  BackendAgentScheduledTask,
  BackendAgentScheduledTaskRun,
  BackendAgentSummary,
} from '@wonderlands/contracts/chat'
import { onDestroy, onMount, tick } from 'svelte'
import {
  createAgentTask,
  deleteAgentTask,
  getAgentTask,
  listAgents,
  listAgentTaskRuns,
  pauseAgentTask,
  previewAgentTaskSchedule,
  resumeAgentTask,
  runAgentTaskNow,
  updateAgentTask,
} from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext, viewKey } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import FieldInput from '../../ui/FieldInput.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import SegmentControl from '../../ui/SegmentControl.svelte'
import StatusBadge from '../../ui/StatusBadge.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'

interface Props {
  taskId?: string
  agentId?: string
  onOpenThread?: (threadId: string) => void
}

interface AgentTaskFormState {
  agentId: string
  content: string
  cronExpression: string
  description: string
  name: string
  status: 'active' | 'archived' | 'paused'
  timezone: string
}

let { taskId, agentId, onOpenThread }: Props = $props()

const viewStore = getViewStoreContext()
const getFormView = () => ({
  kind: 'agent-task-form' as const,
  ...(taskId ? { taskId } : {}),
  ...(agentId ? { agentId } : {}),
})

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let editingTaskId = $state<string | null>(null)
let agents = $state<BackendAgentSummary[]>([])
let form = $state<AgentTaskFormState>({
  agentId: '',
  content: '',
  cronExpression: '0 9 * * 1-5',
  description: '',
  name: '',
  status: 'active',
  timezone: browserTimezone(),
})
let loaded = $state<AgentTaskFormState | null>(null)
let taskRecord = $state<BackendAgentScheduledTask | null>(null)
let taskRuns = $state<BackendAgentScheduledTaskRun[]>([])
let previewTimes = $state<string[]>([])
let previewError = $state<string | null>(null)
let errorMessage = $state('')
let successMessage = $state('')
let isLoading = $state(false)
let isSaving = $state(false)
let isRunningNow = $state(false)
let isTogglingStatus = $state(false)
let isConfirmingDelete = $state(false)
let deleteTimer: ReturnType<typeof setTimeout> | null = null
let formRoot: HTMLElement | undefined = $state()
let previewTimer: ReturnType<typeof setTimeout> | null = null

const dirty = $derived.by(() => {
  if (!editingTaskId) {
    return form.name.trim().length > 0 || form.content.trim().length > 0 || form.agentId.length > 0
  }
  if (!loaded) return false
  return (
    form.agentId !== loaded.agentId ||
    form.content !== loaded.content ||
    form.cronExpression !== loaded.cronExpression ||
    form.description !== loaded.description ||
    form.name !== loaded.name ||
    form.status !== loaded.status ||
    form.timezone !== loaded.timezone
  )
})

const formatInstant = (value: string | null): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    weekday: 'short',
    year: 'numeric',
  })
}

const refreshPreview = (): void => {
  if (previewTimer) clearTimeout(previewTimer)

  previewTimer = setTimeout(async () => {
    const cronExpression = form.cronExpression.trim()
    const timezone = form.timezone.trim()

    if (!cronExpression || !timezone) {
      previewTimes = []
      previewError = null
      return
    }

    try {
      const result = await previewAgentTaskSchedule({
        count: 5,
        cronExpression,
        timezone,
      })
      previewTimes = result.nextRunTimes
      previewError = null
    } catch (error) {
      previewTimes = []
      previewError = humanizeErrorMessage(
        error instanceof Error ? error.message : 'Could not preview this schedule.',
      )
    }
  }, 350)
}

const hydrate = (task: BackendAgentScheduledTask): void => {
  editingTaskId = task.id
  taskRecord = task
  const snapshot: AgentTaskFormState = {
    agentId: task.agentId,
    content: task.content,
    cronExpression: task.cronExpression,
    description: task.description ?? '',
    name: task.name,
    status: task.status === 'deleted' ? 'paused' : task.status,
    timezone: task.timezone,
  }
  form = { ...snapshot }
  loaded = snapshot
}

const loadTaskRuns = async (id: string): Promise<void> => {
  try {
    taskRuns = await listAgentTaskRuns(id, { limit: 20 })
  } catch {
    taskRuns = []
  }
}

const save = async (): Promise<boolean> => {
  if (isSaving) return false

  const trimmedName = form.name.trim()
  const trimmedContent = form.content.trim()

  if (!form.agentId) {
    errorMessage = 'Select an agent to run.'
    return false
  }
  if (!trimmedName) {
    errorMessage = 'A task name is required.'
    return false
  }
  if (!trimmedContent) {
    errorMessage = 'Message content is required.'
    return false
  }

  isSaving = true
  errorMessage = ''
  successMessage = ''

  try {
    const description = form.description.trim() ? form.description.trim() : null

    if (editingTaskId) {
      const saved = await updateAgentTask(editingTaskId, {
        agentId: form.agentId,
        content: trimmedContent,
        cronExpression: form.cronExpression.trim(),
        description,
        name: trimmedName,
        status: form.status,
        timezone: form.timezone.trim(),
      })
      hydrate(saved)
      await loadTaskRuns(saved.id)
    } else {
      const created = await createAgentTask({
        agentId: form.agentId,
        content: trimmedContent,
        cronExpression: form.cronExpression.trim(),
        description,
        name: trimmedName,
        status: form.status === 'archived' ? 'paused' : form.status,
        timezone: form.timezone.trim(),
      })
      hydrate(created)
    }

    successMessage = `Saved "${trimmedName}".`
    return true
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not save.')
    return false
  } finally {
    isSaving = false
  }
}

const saveAndClose = async (): Promise<void> => {
  if (!dirty) {
    viewStore.pop()
    return
  }
  if (await save()) {
    viewStore.pop()
  }
}

const requestClose = (): void => {
  if (!dirty) {
    viewStore.pop()
    return
  }
  if (!isConfirmingDelete) {
    void saveAndClose()
  }
}

const runNow = async (): Promise<void> => {
  if (!editingTaskId || isRunningNow) return
  isRunningNow = true
  errorMessage = ''
  successMessage = ''
  try {
    const result = await runAgentTaskNow(editingTaskId)
    await loadTaskRuns(editingTaskId)
    const refreshed = await getAgentTask(editingTaskId)
    taskRecord = refreshed
    if (result.taskRun.threadId && onOpenThread) {
      successMessage = 'Run started — opening the conversation.'
      onOpenThread(result.taskRun.threadId)
    } else if (result.taskRun.threadId) {
      successMessage = 'Run started.'
    } else {
      successMessage = `Run ${result.taskRun.displayStatus}.`
    }
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not start this task.',
    )
  } finally {
    isRunningNow = false
  }
}

const toggleStatus = async (): Promise<void> => {
  if (!editingTaskId || !taskRecord || isTogglingStatus) return
  isTogglingStatus = true
  errorMessage = ''
  try {
    const updated =
      taskRecord.status === 'active'
        ? await pauseAgentTask(editingTaskId)
        : await resumeAgentTask(editingTaskId)
    hydrate(updated)
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not change the task status.',
    )
  } finally {
    isTogglingStatus = false
  }
}

const requestDelete = async (): Promise<void> => {
  if (!editingTaskId) return
  if (!isConfirmingDelete) {
    isConfirmingDelete = true
    deleteTimer = setTimeout(() => {
      isConfirmingDelete = false
    }, 3000)
    return
  }
  if (deleteTimer) clearTimeout(deleteTimer)
  isConfirmingDelete = false
  try {
    await deleteAgentTask(editingTaskId)
    viewStore.pop()
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not delete this task.',
    )
  }
}

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(getFormView())

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isActiveView()) return
  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveAndClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void save()
  }
}

onMount(() => {
  editingTaskId = taskId?.trim() || null
  if (!editingTaskId && agentId) {
    form.agentId = agentId
  }
  window.addEventListener('keydown', handleKeydown)
  viewStore.registerDirtyGuard(getFormView(), () => dirty)
  isLoading = true
  refreshPreview()

  void (async () => {
    try {
      agents = await listAgents({ status: 'active' })
    } catch {
      agents = []
    }

    if (!editingTaskId) {
      isLoading = false
      void tick().then(() => scrollFormViewToTop(formRoot))
      return
    }

    try {
      const task = await getAgentTask(editingTaskId)
      hydrate(task)
      await loadTaskRuns(task.id)
    } catch (error) {
      errorMessage = humanizeErrorMessage(
        error instanceof Error ? error.message : 'Could not load this scheduled task.',
      )
    } finally {
      isLoading = false
      void tick().then(() => scrollFormViewToTop(formRoot))
    }
  })()
})

onDestroy(() => {
  if (deleteTimer) clearTimeout(deleteTimer)
  if (previewTimer) clearTimeout(previewTimer)
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard(getFormView())
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-[16px] font-semibold text-text-primary">
        {editingTaskId ? 'Edit Scheduled Task' : 'New Scheduled Task'}
      </h2>
      <p class="mt-1 text-[13px] text-text-secondary">
        Scheduled tasks run an agent on a cron schedule, sending your message as the first turn of a new conversation.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ActionButton variant="secondary" onclick={() => { requestClose() }}>
        {viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
      <ActionButton variant="primary" disabled={isSaving} onclick={() => { void saveAndClose() }}>
        {isSaving ? 'Saving…' : 'Save & Close'}
      </ActionButton>
    </div>
  </div>

  {#if isLoading}
    <div class="rounded-lg border border-border bg-surface-1/60 px-4 py-5 text-[13px] text-text-secondary">
      Loading scheduled task…
    </div>
  {:else}
    <form
      class="space-y-6"
      onsubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <SectionCard title="Task">
        <div class="space-y-5">
          <FieldInput
            label="Name"
            value={form.name}
            placeholder="Weekday morning briefing"
            oninput={(value) => { form.name = value }}
          />

          <label class="block">
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
              Agent
            </span>
            <select
              class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors focus:border-border-strong"
              value={form.agentId}
              onchange={(event) => { form.agentId = event.currentTarget.value }}
            >
              <option value="" disabled>Select an agent…</option>
              {#each agents as agent}
                <option value={agent.id}>{agent.name}</option>
              {/each}
            </select>
          </label>

          <label class="block">
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
              Description <span class="text-text-tertiary/70">(optional, not sent to the agent)</span>
            </span>
            <input
              class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
              placeholder="What this task is for"
              value={form.description}
              oninput={(event) => { form.description = event.currentTarget.value }}
            />
          </label>

          <label class="block">
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
              Message
            </span>
            <textarea
              class="min-h-[120px] w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
              placeholder="Summarize my unread emails and list the three most urgent."
              value={form.content}
              oninput={(event) => { form.content = event.currentTarget.value }}
            ></textarea>
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Schedule"
        description="Standard five-field cron expression (minute hour day month weekday). Minimum interval is 5 minutes."
      >
        <div class="space-y-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <FieldInput
              label="Cron expression"
              value={form.cronExpression}
              placeholder="0 9 * * 1-5"
              oninput={(value) => { form.cronExpression = value; refreshPreview() }}
            />
            <FieldInput
              label="Timezone"
              value={form.timezone}
              placeholder="Europe/Warsaw"
              oninput={(value) => { form.timezone = value; refreshPreview() }}
            />
          </div>

          <div>
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Status</span>
            <SegmentControl
              options={editingTaskId
                ? [
                    { value: 'active', label: 'Active' },
                    { value: 'paused', label: 'Paused' },
                    { value: 'archived', label: 'Archived' },
                  ]
                : [
                    { value: 'active', label: 'Active' },
                    { value: 'paused', label: 'Paused' },
                  ]}
              value={form.status}
              onchange={(value) => { form.status = value }}
            />
          </div>

          <div class="rounded-md border border-border bg-surface-0 px-3 py-3">
            <span class="mb-2 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Next runs</span>
            {#if previewError}
              <p class="text-[12px] text-danger-text">{previewError}</p>
            {:else if previewTimes.length === 0}
              <p class="text-[12px] text-text-tertiary">Enter a valid cron expression to preview upcoming runs.</p>
            {:else}
              <ul class="space-y-1">
                {#each previewTimes as time}
                  <li class="text-[12px] text-text-secondary">{formatInstant(time)}</li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </SectionCard>

      {#if editingTaskId && taskRecord}
        <SectionCard title="Run controls">
          <div class="flex flex-wrap items-center gap-2">
            <ActionButton variant="secondary" disabled={isRunningNow} onclick={() => { void runNow() }}>
              {isRunningNow ? 'Starting…' : 'Run now'}
            </ActionButton>
            <ActionButton variant="secondary" disabled={isTogglingStatus} onclick={() => { void toggleStatus() }}>
              {taskRecord.status === 'active' ? 'Pause' : 'Resume'}
            </ActionButton>
            {#if taskRecord.lastThreadId && onOpenThread}
              <ActionButton
                variant="secondary"
                onclick={() => {
                  if (taskRecord?.lastThreadId) {
                    onOpenThread?.(taskRecord.lastThreadId)
                  }
                }}
              >
                Open latest run
              </ActionButton>
            {/if}
            <div class="ml-auto">
              <ActionButton
                variant={isConfirmingDelete ? 'danger' : 'secondary'}
                onclick={() => { void requestDelete() }}
              >
                {isConfirmingDelete ? 'Confirm delete' : 'Delete'}
              </ActionButton>
            </div>
          </div>
          <p class="mt-3 text-[11px] text-text-tertiary">
            Next run: {formatInstant(taskRecord.nextRunAt)} · Last run: {formatInstant(taskRecord.lastRunAt)}
          </p>
        </SectionCard>

        <SectionCard title="History">
          {#if taskRuns.length === 0}
            <p class="py-2 text-[12px] text-text-tertiary">No runs yet.</p>
          {:else}
            <div class="space-y-1.5">
              {#each taskRuns as run}
                <div class="flex items-center gap-2.5 rounded-md border border-border bg-surface-0 px-3 py-2">
                  <StatusBadge status={run.displayStatus} />
                  <span class="text-[11px] text-text-tertiary">{run.trigger}</span>
                  <span class="text-[11px] text-text-secondary">{formatInstant(run.scheduledFor)}</span>
                  {#if run.threadId && onOpenThread}
                    <button
                      type="button"
                      class="ml-auto text-[11px] text-accent-text hover:underline"
                      onclick={() => {
                        if (run.threadId) {
                          onOpenThread?.(run.threadId)
                        }
                      }}
                    >
                      Open thread
                    </button>
                  {:else}
                    <span class="ml-auto text-[11px] text-text-tertiary">no thread</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </SectionCard>
      {/if}

      {#if errorMessage}
        <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
      {/if}
      {#if successMessage}
        <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
      {/if}

      <div class="sticky bottom-0 -mx-6 flex items-center justify-end border-t border-border bg-bg/80 px-6 py-4 backdrop-blur-sm">
        <ActionButton
          variant="primary"
          disabled={isSaving || !dirty}
          onclick={() => {
            errorMessage = ''
            successMessage = ''
            void save()
          }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </ActionButton>
      </div>
    </form>
  {/if}
</div>
