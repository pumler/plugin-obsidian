import type { DataAdapter } from 'obsidian'

type PumlerLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type PumlerLogData = Record<string, unknown>

export interface PumlerLogger {
  debug(event: string, data?: PumlerLogData): void
  info(event: string, data?: PumlerLogData): void
  warn(event: string, data?: PumlerLogData): void
  error(event: string, data?: PumlerLogData): void
}

export const NOOP_PUMLER_LOGGER: PumlerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

export class PumlerDiskLogger implements PumlerLogger {
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly logPath: string
  private readonly logDir: string | null

  constructor(
    private readonly adapter: DataAdapter,
    logPath: string
  ) {
    this.logPath = normalizeVaultPath(logPath)
    this.logDir = getParentPath(this.logPath)
  }

  debug(event: string, data: PumlerLogData = {}): void {
    this.write('debug', event, data)
  }

  info(event: string, data: PumlerLogData = {}): void {
    this.write('info', event, data)
  }

  warn(event: string, data: PumlerLogData = {}): void {
    this.write('warn', event, data)
  }

  error(event: string, data: PumlerLogData = {}): void {
    this.write('error', event, data)
  }

  private write(level: PumlerLogLevel, event: string, data: PumlerLogData): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...sanitizeLogData(data)
    }
    const line = `${JSON.stringify(entry)}\n`

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureLogDir()
        await this.ensureLogFile()
        await this.adapter.append(this.logPath, line)
      })
      .catch(() => undefined)
  }

  private async ensureLogDir(): Promise<void> {
    if (!this.logDir || await this.adapter.exists(this.logDir)) {
      return
    }

    await this.adapter.mkdir(this.logDir)
  }

  private async ensureLogFile(): Promise<void> {
    if (await this.adapter.exists(this.logPath)) {
      return
    }

    await this.adapter.write(this.logPath, '')
  }
}

export function createLogDigest(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function formatLogError(error: unknown): PumlerLogData {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message
    }
  }

  return {
    errorMessage: String(error)
  }
}

function sanitizeLogData(data: PumlerLogData): PumlerLogData {
  const sanitized: PumlerLogData = {}
  Object.entries(data).forEach(([key, value]) => {
    sanitized[key] = sanitizeLogValue(value)
  })
  return sanitized
}

function sanitizeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return formatLogError(value)
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue)
  }
  if (value && typeof value === 'object') {
    return sanitizeLogData(value as PumlerLogData)
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}...[truncated:${value.length}]`
  }

  return value
}

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function getParentPath(path: string): string | null {
  const separatorIndex = path.lastIndexOf('/')
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null
}
