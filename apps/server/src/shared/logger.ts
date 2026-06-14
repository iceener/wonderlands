export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

export interface AppLogger {
  child: (fields: LogFields) => AppLogger
  debug: (message: string, fields?: LogFields) => void
  error: (message: string, fields?: LogFields) => void
  info: (message: string, fields?: LogFields) => void
  level: LogLevel
  log: (level: LogLevel, message: string, fields?: LogFields) => void
  warn: (message: string, fields?: LogFields) => void
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
}

const consoleMethodByLevel: Record<LogLevel, 'debug' | 'error' | 'info' | 'warn'> = {
  debug: 'debug',
  error: 'error',
  info: 'info',
  warn: 'warn',
}

export const createLogger = (level: LogLevel, bindings: LogFields = {}): AppLogger => {
  const log = (eventLevel: LogLevel, message: string, fields: LogFields = {}) => {
    if (levelRank[eventLevel] < levelRank[level]) {
      return
    }

    console[consoleMethodByLevel[eventLevel]](
      JSON.stringify({
        ...bindings,
        ...fields,
        level: eventLevel,
        message,
        timestamp: new Date().toISOString(),
      }),
    )
  }

  return {
    child: (fields) => createLogger(level, { ...bindings, ...fields }),
    debug: (message, fields) => log('debug', message, fields),
    error: (message, fields) => log('error', message, fields),
    info: (message, fields) => log('info', message, fields),
    level,
    log,
    warn: (message, fields) => log('warn', message, fields),
  }
}
