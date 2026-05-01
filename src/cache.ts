import type { DataAdapter } from 'obsidian'
import { createRenderDiagramCacheSeed, type RenderDiagramOptions } from './client'
import { createLogDigest, formatLogError, NOOP_PUMLER_LOGGER, type PumlerLogger } from './logger'

export const SVG_DISK_CACHE_LIMIT = 30

interface CacheIndex {
  version: 1
  entries: CacheIndexEntry[]
}

interface CacheIndexEntry {
  key: string
  file: string
  createdAt: number
  updatedAt: number
  lastAccessed: number
}

export interface PumlerSvgCache {
  get(options: RenderDiagramOptions): Promise<string | null>
  set(options: RenderDiagramOptions, svg: string): Promise<void>
}

export class PumlerDiskSvgCache implements PumlerSvgCache {
  private readonly indexPath: string
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly adapter: DataAdapter,
    private readonly cacheDir: string,
    private readonly limit = SVG_DISK_CACHE_LIMIT,
    private readonly logger: PumlerLogger = NOOP_PUMLER_LOGGER
  ) {
    this.cacheDir = normalizeVaultPath(cacheDir)
    this.indexPath = normalizeVaultPath(`${this.cacheDir}/index.json`)
  }

  async get(options: RenderDiagramOptions): Promise<string | null> {
    const startedAt = Date.now()
    const cacheSeedDigest = createLogDigest(createRenderDiagramCacheSeed(options))
    this.logger.debug('cache.get.start', createCacheLogData(options, cacheSeedDigest))

    try {
      const svg = await this.enqueueOperation(() => this.readEntry(options, cacheSeedDigest))
      this.logger.debug(svg ? 'cache.get.hit' : 'cache.get.miss', {
        ...createCacheLogData(options, cacheSeedDigest),
        durationMs: Date.now() - startedAt,
        svgLength: svg?.length
      })
      return svg
    } catch (error) {
      this.logger.warn('cache.get.error', {
        ...createCacheLogData(options, cacheSeedDigest),
        durationMs: Date.now() - startedAt,
        ...formatLogError(error)
      })
      return null
    }
  }

  async set(options: RenderDiagramOptions, svg: string): Promise<void> {
    const startedAt = Date.now()
    const cacheSeedDigest = createLogDigest(createRenderDiagramCacheSeed(options))
    this.logger.debug('cache.set.start', {
      ...createCacheLogData(options, cacheSeedDigest),
      svgLength: svg.length
    })

    await this.enqueueOperation(() => this.writeEntry(options, svg, cacheSeedDigest))
      .then(() => {
        this.logger.debug('cache.set.done', {
          ...createCacheLogData(options, cacheSeedDigest),
          durationMs: Date.now() - startedAt,
          svgLength: svg.length
        })
      })
      .catch(error => {
        this.logger.warn('cache.set.error', {
          ...createCacheLogData(options, cacheSeedDigest),
          durationMs: Date.now() - startedAt,
          ...formatLogError(error)
        })
      })
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue
      .catch(() => undefined)
      .then(operation)

    this.operationQueue = result
      .then(() => undefined)
      .catch(() => undefined)

    return result
  }

  private async readEntry(options: RenderDiagramOptions, cacheSeedDigest: string): Promise<string | null> {
    const key = await createCacheKey(options)
    const index = await this.readIndex()
    const entry = index.entries.find(candidate => candidate.key === key)
    if (!entry) {
      return null
    }

    const path = normalizeVaultPath(`${this.cacheDir}/${entry.file}`)
    const svg = await this.adapter.read(path)
    const now = nextAccessStamp(index)
    entry.lastAccessed = now
    entry.updatedAt = Math.max(entry.updatedAt, entry.createdAt)
    await this.writeIndex(index)
    this.logger.debug('cache.index.touch', {
      ...createCacheLogData(options, cacheSeedDigest),
      file: entry.file,
      entryCount: index.entries.length
    })
    return svg
  }

  private async writeEntry(options: RenderDiagramOptions, svg: string, cacheSeedDigest: string): Promise<void> {
    await this.ensureCacheDir()

    const key = await createCacheKey(options)
    const file = `${key}.svg`
    const path = normalizeVaultPath(`${this.cacheDir}/${file}`)
    await this.adapter.write(path, svg)

    const index = await this.readIndex()
    const now = nextAccessStamp(index)
    const existingEntry = index.entries.find(entry => entry.key === key)
    if (existingEntry) {
      existingEntry.file = file
      existingEntry.updatedAt = now
      existingEntry.lastAccessed = now
    } else {
      index.entries.push({
        key,
        file,
        createdAt: now,
        updatedAt: now,
        lastAccessed: now
      })
    }

    await this.prune(index)
    await this.writeIndex(index)
    this.logger.debug('cache.index.write', {
      ...createCacheLogData(options, cacheSeedDigest),
      file,
      entryCount: index.entries.length
    })
  }

  private async readIndex(): Promise<CacheIndex> {
    try {
      const data = await this.adapter.read(this.indexPath)
      const parsed = JSON.parse(data) as Partial<CacheIndex>
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        return createEmptyIndex()
      }

      return {
        version: 1,
        entries: parsed.entries.filter(isCacheIndexEntry)
      }
    } catch {
      return createEmptyIndex()
    }
  }

  private async writeIndex(index: CacheIndex): Promise<void> {
    await this.ensureCacheDir()
    await this.adapter.write(this.indexPath, JSON.stringify(index, null, 2))
  }

  private async ensureCacheDir(): Promise<void> {
    if (await this.adapter.exists(this.cacheDir)) {
      return
    }

    await this.adapter.mkdir(this.cacheDir)
  }

  private async prune(index: CacheIndex): Promise<void> {
    const sortedEntries = [...index.entries].sort((first, second) => second.lastAccessed - first.lastAccessed)
    const retainedEntries = sortedEntries.slice(0, this.limit)
    const retainedFiles = new Set(retainedEntries.map(entry => entry.file))
    const removedEntries = index.entries.filter(entry => !retainedFiles.has(entry.file))

    index.entries = retainedEntries

    await Promise.all(removedEntries.map(entry => this.removeCacheFile(entry.file)))
    if (removedEntries.length > 0) {
      this.logger.info('cache.prune', {
        removedCount: removedEntries.length,
        retainedCount: retainedEntries.length,
        limit: this.limit
      })
    }
  }

  private async removeCacheFile(file: string): Promise<void> {
    try {
      await this.adapter.remove(normalizeVaultPath(`${this.cacheDir}/${file}`))
    } catch {
      // Cache pruning must not break rendering.
    }
  }
}

function createCacheLogData(options: RenderDiagramOptions, cacheSeedDigest: string): Record<string, unknown> {
  return {
    provider: options.provider,
    type: options.type,
    theme: options.theme,
    sourceLength: options.source.length,
    cacheSeedDigest
  }
}

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

async function createCacheKey(options: RenderDiagramOptions): Promise<string> {
  const data = new TextEncoder().encode(createRenderDiagramCacheSeed(options))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function createEmptyIndex(): CacheIndex {
  return {
    version: 1,
    entries: []
  }
}

function nextAccessStamp(index: CacheIndex): number {
  const latestStamp = index.entries.reduce((latest, entry) => Math.max(latest, entry.lastAccessed), 0)
  return Math.max(Date.now(), latestStamp + 1)
}

function isCacheIndexEntry(value: unknown): value is CacheIndexEntry {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as Partial<CacheIndexEntry>
  return typeof entry.key === 'string' &&
    typeof entry.file === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.updatedAt === 'number' &&
    typeof entry.lastAccessed === 'number'
}
