import { CronExpressionParser } from 'cron-parser'

import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export const MINIMUM_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000
const INTERVAL_SAMPLE_COUNT = 5
const MAX_PREVIEW_COUNT = 10

const validationError = (message: string): DomainError => ({
  message,
  type: 'validation',
})

export const validateTimezone = (timezone: string): Result<string, DomainError> => {
  const normalized = timezone.trim()

  if (!normalized) {
    return err(validationError('timezone must not be empty'))
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized })
    return ok(normalized)
  } catch {
    return err(validationError(`timezone "${normalized}" is not a valid IANA timezone`))
  }
}

const parseExpression = (input: {
  cronExpression: string
  from: Date
  timezone: string
}): Result<ReturnType<typeof CronExpressionParser.parse>, DomainError> => {
  const normalized = input.cronExpression.trim()

  if (normalized.split(/\s+/).length !== 5) {
    return err(
      validationError('cron expression must use five fields (minute hour day month weekday)'),
    )
  }

  try {
    return ok(
      CronExpressionParser.parse(normalized, {
        currentDate: input.from,
        tz: input.timezone,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown cron parse failure'

    return err(validationError(`invalid cron expression "${normalized}": ${message}`))
  }
}

export const validateCronSchedule = (input: {
  cronExpression: string
  timezone: string
}): Result<{ cronExpression: string; timezone: string }, DomainError> => {
  const timezone = validateTimezone(input.timezone)

  if (!timezone.ok) {
    return timezone
  }

  const expression = parseExpression({
    cronExpression: input.cronExpression,
    from: new Date(),
    timezone: timezone.value,
  })

  if (!expression.ok) {
    return expression
  }

  const samples: number[] = []

  try {
    for (let index = 0; index < INTERVAL_SAMPLE_COUNT; index += 1) {
      samples.push(expression.value.next().getTime())
    }
  } catch {
    if (samples.length === 0) {
      return err(validationError('cron expression never fires'))
    }
  }

  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index]
    const previous = samples[index - 1]

    if (
      current !== undefined &&
      previous !== undefined &&
      current - previous < MINIMUM_SCHEDULE_INTERVAL_MS
    ) {
      return err(
        validationError(
          `schedule fires more often than the minimum interval of ${MINIMUM_SCHEDULE_INTERVAL_MS / 60000} minutes`,
        ),
      )
    }
  }

  return ok({
    cronExpression: input.cronExpression.trim(),
    timezone: timezone.value,
  })
}

export const computeNextRunAt = (input: {
  cronExpression: string
  from: string
  timezone: string
}): Result<string, DomainError> => {
  const fromDate = new Date(input.from)

  if (Number.isNaN(fromDate.getTime())) {
    return err(validationError(`invalid schedule reference instant "${input.from}"`))
  }

  const expression = parseExpression({
    cronExpression: input.cronExpression,
    from: fromDate,
    timezone: input.timezone,
  })

  if (!expression.ok) {
    return expression
  }

  try {
    const next = expression.value.next().toISOString()

    if (!next) {
      return err(validationError('cron expression has no future occurrence'))
    }

    return ok(next)
  } catch {
    return err(validationError('cron expression has no future occurrence'))
  }
}

export const previewRunTimes = (input: {
  count?: number
  cronExpression: string
  from: string
  timezone: string
}): Result<string[], DomainError> => {
  const validated = validateCronSchedule({
    cronExpression: input.cronExpression,
    timezone: input.timezone,
  })

  if (!validated.ok) {
    return validated
  }

  const fromDate = new Date(input.from)

  if (Number.isNaN(fromDate.getTime())) {
    return err(validationError(`invalid schedule reference instant "${input.from}"`))
  }

  const expression = parseExpression({
    cronExpression: validated.value.cronExpression,
    from: fromDate,
    timezone: validated.value.timezone,
  })

  if (!expression.ok) {
    return expression
  }

  const count = Math.min(Math.max(input.count ?? 5, 1), MAX_PREVIEW_COUNT)
  const nextRunTimes: string[] = []

  try {
    for (let index = 0; index < count; index += 1) {
      const next = expression.value.next().toISOString()

      if (!next) {
        break
      }

      nextRunTimes.push(next)
    }
  } catch {
    // expression ran out of occurrences; return what we collected
  }

  return ok(nextRunTimes)
}
