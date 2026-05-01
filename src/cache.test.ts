import { describe, expect, test } from 'vitest'
import type { DataAdapter, ListedFiles, Stat } from 'obsidian'
import { PumlerDiskSvgCache } from './cache'
import type { RenderDiagramOptions } from './client'

describe('PumlerDiskSvgCache', () => {
  test('stores and reads SVGs by render options', async () => {
    const adapter = new MemoryAdapter()
    const cache = new PumlerDiskSvgCache(adapter, '.obsidian/plugins/pumler/cache', 30)
    const options = renderOptions('Alice -> Bob')

    await cache.set(options, '<svg>Alice</svg>')

    expect(await cache.get(options)).toBe('<svg>Alice</svg>')
    expect(await cache.get(renderOptions('Alice -> Carol'))).toBeNull()
  })

  test('keeps only the most recently used entries', async () => {
    const adapter = new MemoryAdapter()
    const cache = new PumlerDiskSvgCache(adapter, '.obsidian/plugins/pumler/cache', 2)
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
    await adapter.mkdir('.obsidian/plugins/pumler/cache')
    await adapter.write('.obsidian/plugins/pumler/cache/index.json', 'not json')

    const cache = new PumlerDiskSvgCache(adapter, '.obsidian/plugins/pumler/cache', 30)
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

  async exists(normalizedPath: string): Promise<boolean> {
    return this.folders.has(normalizedPath) || this.files.has(normalizedPath)
  }

  async stat(normalizedPath: string): Promise<Stat | null> {
    if (!await this.exists(normalizedPath)) {
      return null
    }

    return {
      type: this.folders.has(normalizedPath) ? 'folder' : 'file',
      ctime: 0,
      mtime: 0,
      size: this.files.get(normalizedPath)?.length ?? 0
    }
  }

  async list(normalizedPath: string): Promise<ListedFiles> {
    const prefix = `${normalizedPath}/`
    return {
      files: Array.from(this.files.keys()).filter(path => path.startsWith(prefix)),
      folders: Array.from(this.folders).filter(path => path.startsWith(prefix))
    }
  }

  async read(normalizedPath: string): Promise<string> {
    const data = this.files.get(normalizedPath)
    if (data === undefined) {
      throw new Error(`Missing file: ${normalizedPath}`)
    }

    return data
  }

  async readBinary(): Promise<ArrayBuffer> {
    throw new Error('Not implemented')
  }

  async write(normalizedPath: string, data: string): Promise<void> {
    this.files.set(normalizedPath, data)
  }

  async writeBinary(): Promise<void> {
    throw new Error('Not implemented')
  }

  async append(normalizedPath: string, data: string): Promise<void> {
    this.files.set(normalizedPath, `${this.files.get(normalizedPath) ?? ''}${data}`)
  }

  async appendBinary(): Promise<void> {
    throw new Error('Not implemented')
  }

  async process(normalizedPath: string, fn: (data: string) => string): Promise<string> {
    const data = fn(this.files.get(normalizedPath) ?? '')
    this.files.set(normalizedPath, data)
    return data
  }

  getResourcePath(normalizedPath: string): string {
    return normalizedPath
  }

  async mkdir(normalizedPath: string): Promise<void> {
    this.folders.add(normalizedPath)
  }

  async trashSystem(): Promise<boolean> {
    return false
  }

  async trashLocal(): Promise<void> {
    throw new Error('Not implemented')
  }

  async rmdir(normalizedPath: string): Promise<void> {
    this.folders.delete(normalizedPath)
  }

  async remove(normalizedPath: string): Promise<void> {
    this.files.delete(normalizedPath)
  }

  async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    const data = this.files.get(normalizedPath)
    if (data !== undefined) {
      this.files.delete(normalizedPath)
      this.files.set(normalizedNewPath, data)
      return
    }

    if (this.folders.delete(normalizedPath)) {
      this.folders.add(normalizedNewPath)
    }
  }

  async copy(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    const data = this.files.get(normalizedPath)
    if (data === undefined) {
      throw new Error(`Missing file: ${normalizedPath}`)
    }

    this.files.set(normalizedNewPath, data)
  }

  svgFileCount(): number {
    return Array.from(this.files.keys()).filter(path => path.endsWith('.svg')).length
  }
}
