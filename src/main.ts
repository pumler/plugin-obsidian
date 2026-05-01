import { MarkdownRenderChild, Plugin, type App, type MarkdownPostProcessorContext, type WorkspaceLeaf } from 'obsidian'
import { PumlerDiskSvgCache } from './cache'
import { PumlerApiClient } from './client'
import { createLogDigest, NOOP_PUMLER_LOGGER, PumlerDiskLogger, type PumlerLogger } from './logger'
import { parsePumlerBlock } from './parser'
import { PumlerBlockRenderer } from './renderer'

export default class PumlerPlugin extends Plugin {
  async onload(): Promise<void> {
    const logger = this.manifest.dir
      ? new PumlerDiskLogger(this.app.vault.adapter, `${this.manifest.dir}/pumler-debug.log`)
      : NOOP_PUMLER_LOGGER
    const cache = this.manifest.dir
      ? new PumlerDiskSvgCache(this.app.vault.adapter, `${this.manifest.dir}/cache`, undefined, logger)
      : undefined
    const renderer = new PumlerBlockRenderer(new PumlerApiClient(logger), cache, logger)

    logger.info('plugin.load', {
      pluginDir: this.manifest.dir,
      version: this.manifest.version
    })
    this.registerWorkspaceLogging(logger)

    this.registerMarkdownCodeBlockProcessor('pumler', (source, element, context) => {
      const debounceKey = createDebounceKey(source, element, context)
      logger.info('processor.block', {
        sourcePath: context.sourcePath,
        docId: context.docId,
        debounceKey,
        sourceLength: source.length,
        sourceDigest: createLogDigest(source)
      })
      context.addChild(new PumlerMarkdownRenderChild(
        this.app,
        element,
        source,
        renderer,
        debounceKey,
        context.sourcePath,
        logger
      ))
    })
  }

  private registerWorkspaceLogging(logger: PumlerLogger): void {
    this.registerEvent(this.app.workspace.on('file-open', file => {
      logger.info('workspace.file_open', {
        path: file?.path,
        activeLeaf: describeLeaf(this.app.workspace.activeLeaf)
      })
      window.setTimeout(() => {
        logger.info('workspace.file_open.after_tick', describeWorkspace(this.app))
      }, 0)
    }))

    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      logger.info('workspace.active_leaf_change', {
        leaf: describeLeaf(leaf)
      })
    }))

    this.registerEvent(this.app.workspace.on('layout-change', () => {
      logger.info('workspace.layout_change', describeWorkspace(this.app))
    }))
  }

}

class PumlerMarkdownRenderChild extends MarkdownRenderChild {
  private abortController: AbortController | null = null

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly renderer: PumlerBlockRenderer,
    private readonly debounceKey: string,
    private readonly sourcePath: string,
    private readonly logger: PumlerLogger
  ) {
    super(containerEl)
  }

  onload(): void {
    this.logger.info('render_child.load', this.createLogData())
    this.registerEvent(this.app.workspace.on('css-change', () => {
      if (usesAutoTheme(this.source)) {
        this.logger.info('render_child.css_change_rerender', this.createLogData())
        this.render()
      }
    }))
    this.render()
  }

  onunload(): void {
    this.logger.info('render_child.unload', this.createLogData())
    this.abortActiveRender()
  }

  private render(): void {
    this.abortActiveRender()
    const abortController = new AbortController()
    this.abortController = abortController

    this.logger.info('render_child.render', this.createLogData())
    void this.renderer.render(this.source, this.containerEl, {
      debounceKey: this.debounceKey,
      signal: abortController.signal
    })
  }

  private abortActiveRender(): void {
    if (this.abortController) {
      this.logger.debug('render_child.abort_active', this.createLogData())
      this.abortController.abort()
    }
    this.abortController = null
  }

  private createLogData(): Record<string, unknown> {
    return {
      sourcePath: this.sourcePath,
      debounceKey: this.debounceKey,
      sourceLength: this.source.length,
      sourceDigest: createLogDigest(this.source)
    }
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

function describeWorkspace(app: App): Record<string, unknown> {
  return {
    activeLeaf: describeLeaf(app.workspace.activeLeaf),
    markdownLeafCount: app.workspace.getLeavesOfType('markdown').length
  }
}

function describeLeaf(leaf: WorkspaceLeaf | null): Record<string, unknown> | null {
  if (!leaf) {
    return null
  }

  const view = leaf.view as {
    getViewType?: () => string
    getMode?: () => string
    file?: { path?: string }
  }
  const state = leaf.getViewState()

  return {
    viewType: typeof view.getViewType === 'function' ? view.getViewType() : state.type,
    stateType: state.type,
    mode: typeof view.getMode === 'function' ? view.getMode() : undefined,
    stateMode: typeof state.state?.mode === 'string' ? state.state.mode : undefined,
    filePath: view.file?.path,
    stateFile: typeof state.state?.file === 'string' ? state.state.file : undefined
  }
}
