import { describe, expect, test } from 'vitest'
import type { DataAdapter, ListedFiles, Stat } from 'obsidian'
import { PumlerDiskSvgCache } from './cache'
import type { RenderDiagramOptions } from './client'

const CACHE_DIR = 'custom-config/plugins/pumler/cache'

describe('PumlerDiskSvgCache', () => {
  test('stores and reads SVGs by render options', async () => {
    const adapter = new MemoryAdapter()
    const cache = new PumlerDiskSvgCache(adapter, CACHE_DIR, 30)
    const options = renderOptions('Alice -> Bob')

    await cache.set(options, '<svg>Alice</svg>')

    expect(await cache.get(options)).toBe('<svg>Alice</svg>')
    expect(await cache.get(renderOptions('Alice -> Carol'))).toBeNull()
  })

  test('keeps only the most recently used entries', async () => {
    const adapter = new MemoryAdapter()
    const cache = new PumlerDiskSvgCache(adapter, CACHE_DIR, 2)
    const first = renderOptions('A -> B')
    const second = renderOptions('B -> C')
    const third = renderOptions('C -> D')

    await cache.set(first, '<svg>first</svg>')
    await cache.set(second, '<svg>second</svg>')
    expect(await cache.get(first)).toBe('<svg>first</svg>')
    await cache.set(third, '<svg>third</svg>')

    expect(await cache.get(first)).toBe('<svg>first</svg>')
    expect(await cache.get(second)).toBeNull()
    expect(await cache.get(third)).toBe('<svg>third</svg>')
    expect(adapter.svgFileCount()).toBe(2)
  })

  test('ignores corrupt cache indexes', async () => {
    const adapter = new MemoryAdapter()
    await adapter.mkdir(CACHE_DIR)
    await adapter.write(`${CACHE_DIR}/index.json`, 'not json')

    const cache = new PumlerDiskSvgCache(adapter, CACHE_DIR, 30)
    const options = renderOptions('A -> B')

    await cache.set(options, '<svg>fresh</svg>')

    expect(await cache.get(options)).toBe('<svg>fresh</svg>')
  })
})

function renderOptions(source: string): RenderDiagramOptions {
  return {
    provider: 'plantuml',
    type: 'sequence',
    theme: 'light',
    source
  }
}

class MemoryAdapter implements DataAdapter {
  private readonly folders = new Set<string>()
  private readonly files = new Map<string, string>()

  getName(): string {
    return 'memory'
  }

  exists(normalizedPath: string): Promise<boolean> {
    return Promise.resolve(this.hasPath(normalizedPath))
  }

  stat(normalizedPath: string): Promise<Stat | null> {
    if (!this.hasPath(normalizedPath)) {
      return Promise.resolve(null)
    }

    return Promise.resolve({
      type: this.folders.has(normalizedPath) ? 'folder' : 'file',
      ctime: 0,
      mtime: 0,
      size: this.files.get(normalizedPath)?.length ?? 0
    })
  }

  list(normalizedPath: string): Promise<ListedFiles> {
    const prefix = `${normalizedPath}/`
    return Promise.resolve({
      files: Array.from(this.files.keys()).filter(path => path.startsWith(prefix)),
      folders: Array.from(this.folders).filter(path => path.startsWith(prefix))
    })
  }

  read(normalizedPath: string): Promise<string> {
    const data = this.files.get(normalizedPath)
    if (data === undefined) {
      return Promise.reject(new Error(`Missing file: ${normalizedPath}`))
    }

    return Promise.resolve(data)
  }

  readBinary(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('Not implemented'))
  }

  write(normalizedPath: string, data: string): Promise<void> {
    this.files.set(normalizedPath, data)
    return Promise.resolve()
  }

  writeBinary(): Promise<void> {
    return Promise.reject(new Error('Not implemented'))
  }

  append(normalizedPath: string, data: string): Promise<void> {
    this.files.set(normalizedPath, `${this.files.get(normalizedPath) ?? ''}${data}`)
    return Promise.resolve()
  }

  appendBinary(): Promise<void> {
    return Promise.reject(new Error('Not implemented'))
  }

  process(normalizedPath: string, fn: (data: string) => string): Promise<string> {
    const data = fn(this.files.get(normalizedPath) ?? '')
    this.files.set(normalizedPath, data)
    return Promise.resolve(data)
  }

  getResourcePath(normalizedPath: string): string {
    return normalizedPath
  }

  mkdir(normalizedPath: string): Promise<void> {
    this.folders.add(normalizedPath)
    return Promise.resolve()
  }

  trashSystem(): Promise<boolean> {
    return Promise.resolve(false)
  }

  trashLocal(): Promise<void> {
    return Promise.reject(new Error('Not implemented'))
  }

  rmdir(normalizedPath: string): Promise<void> {
    this.folders.delete(normalizedPath)
    return Promise.resolve()
  }

  remove(normalizedPath: string): Promise<void> {
    this.files.delete(normalizedPath)
    return Promise.resolve()
  }

  rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    const data = this.files.get(normalizedPath)
    if (data !== undefined) {
      this.files.delete(normalizedPath)
      this.files.set(normalizedNewPath, data)
      return Promise.resolve()
    }

    if (this.folders.delete(normalizedPath)) {
      this.folders.add(normalizedNewPath)
    }
    return Promise.resolve()
  }

  copy(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    const data = this.files.get(normalizedPath)
    if (data === undefined) {
      return Promise.reject(new Error(`Missing file: ${normalizedPath}`))
    }

    this.files.set(normalizedNewPath, data)
    return Promise.resolve()
  }

  svgFileCount(): number {
    return Array.from(this.files.keys()).filter(path => path.endsWith('.svg')).length
  }

  private hasPath(normalizedPath: string): boolean {
    return this.folders.has(normalizedPath) || this.files.has(normalizedPath)
  }
}
