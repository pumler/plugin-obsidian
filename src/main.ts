import { MarkdownRenderChild, Plugin, type App, type MarkdownPostProcessorContext } from 'obsidian'
import { PumlerDiskSvgCache } from './cache'
import { PumlerApiClient } from './client'
import { parsePumlerBlock } from './parser'
import { PumlerBlockRenderer } from './renderer'

export default class PumlerPlugin extends Plugin {
  async onload(): Promise<void> {
    const cache = this.manifest.dir
      ? new PumlerDiskSvgCache(this.app.vault.adapter, `${this.manifest.dir}/cache`)
      : undefined
    const renderer = new PumlerBlockRenderer(new PumlerApiClient(), cache)

    this.registerMarkdownCodeBlockProcessor('pumler', (source, element, context) => {
      const debounceKey = createDebounceKey(source, element, context)
      context.addChild(new PumlerMarkdownRenderChild(
        this.app,
        element,
        source,
        renderer,
        debounceKey
      ))
    })
  }
}

class PumlerMarkdownRenderChild extends MarkdownRenderChild {
  private abortController: AbortController | null = null
  private readonly modalCleanups = new Set<() => void>()

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly renderer: PumlerBlockRenderer,
    private readonly debounceKey: string
  ) {
    super(containerEl)
  }

  onload(): void {
    this.registerEvent(this.app.workspace.on('css-change', () => {
      if (usesAutoTheme(this.source)) {
        this.render()
      }
    }))
    this.render()
  }

  onunload(): void {
    this.abortActiveRender()
    this.closeOpenModals()
  }

  private render(): void {
    this.abortActiveRender()
    this.closeOpenModals()
    const abortController = new AbortController()
    this.abortController = abortController

    void this.renderer.render(this.source, this.containerEl, {
      debounceKey: this.debounceKey,
      signal: abortController.signal,
      registerModalCleanup: cleanup => {
        this.modalCleanups.add(cleanup)
      }
    })
  }

  private abortActiveRender(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.abortController = null
  }

  private closeOpenModals(): void {
    const cleanups = Array.from(this.modalCleanups)
    this.modalCleanups.clear()
    cleanups.forEach(cleanup => cleanup())
  }
}

function usesAutoTheme(source: string): boolean {
  try {
    return parsePumlerBlock(source).metadata.theme === 'auto'
  } catch {
    return false
  }
}

function createDebounceKey(source: string, element: HTMLElement, context: MarkdownPostProcessorContext): string {
  const section = context.getSectionInfo(element)
  if (section) {
    return `${context.docId}:${context.sourcePath}:${findBlockLineStart(source, section.text, section.lineStart)}`
  }

  return `${context.docId}:${context.sourcePath}:${element.dataset.pumlerDebounceKey ?? createElementDebounceKey(element)}`
}

function findBlockLineStart(source: string, sectionText: string, sectionLineStart: number): number {
  const normalizedSectionText = sectionText.replace(/\r\n/g, '\n')
  const normalizedSource = source.replace(/\r\n/g, '\n')
  const sourceIndex = normalizedSectionText.indexOf(normalizedSource)
  if (sourceIndex < 0) {
    return sectionLineStart
  }

  return sectionLineStart + countNewlines(normalizedSectionText.slice(0, sourceIndex))
}

function countNewlines(value: string): number {
  return value.split('\n').length - 1
}

let nextElementDebounceKey = 0

function createElementDebounceKey(element: HTMLElement): string {
  nextElementDebounceKey += 1
  const key = `element-${nextElementDebounceKey}`
  element.dataset.pumlerDebounceKey = key
  return key
}
