export interface ToolProfileDiffRow {
  enabled: boolean
  runtimeName: string
  serverId: string
  trusted: boolean
}

export interface ToolProfileAssignmentChange {
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
}

export interface ToolProfileAccessPlan {
  assignments: ToolProfileAssignmentChange[]
  removals: string[]
}

const dedupeByRuntimeName = <TRow extends ToolProfileDiffRow>(
  rows: readonly TRow[],
): Map<string, TRow> => new Map(rows.map((row) => [row.runtimeName, row]))

export const planToolProfileAccessChanges = <TRow extends ToolProfileDiffRow>(
  currentRows: readonly TRow[],
  desiredRows: readonly TRow[],
): ToolProfileAccessPlan => {
  const currentByRuntimeName = dedupeByRuntimeName(currentRows)
  const desiredByRuntimeName = dedupeByRuntimeName(desiredRows)

  const assignments: ToolProfileAssignmentChange[] = []
  const removals = new Set<string>()

  for (const desired of desiredRows) {
    const current = currentByRuntimeName.get(desired.runtimeName)

    if (!desired.enabled) {
      if (current?.enabled) {
        removals.add(desired.runtimeName)
      }
      continue
    }

    const trustChanged = current?.enabled === true && current.trusted !== desired.trusted
    const serverChanged = current?.enabled === true && current.serverId !== desired.serverId

    if (!current?.enabled || trustChanged || serverChanged) {
      assignments.push({
        requiresConfirmation: !desired.trusted,
        runtimeName: desired.runtimeName,
        serverId: desired.serverId,
      })
    }
  }

  for (const current of currentRows) {
    if (!current.enabled) {
      continue
    }

    const desired = desiredByRuntimeName.get(current.runtimeName)
    if (!desired?.enabled) {
      removals.add(current.runtimeName)
    }
  }

  return {
    assignments,
    removals: Array.from(removals),
  }
}
