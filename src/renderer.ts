import { parsePumlerBlock, PumlerValidationError } from './parser'
import { resolveTheme } from './theme'
import { createRenderDiagramCacheSeed, PumlerApiClient, PumlerRenderError, type RenderDiagramOptions } from './client'
import { cloneSanitizedSvgWithIdScope, sanitizeSvg } from './svg'
import type { PumlerSvgCache } from './cache'

export const DEFAULT_RENDER_DEBOUNCE_MS = 700
const SANITIZED_SVG_TEMPLATE_CACHE_LIMIT = 20
const MIN_MODAL_ZOOM = 0.5
const MAX_MODAL_ZOOM = 4
const MODAL_ZOOM_STEP = 0.25
const MODAL_WHEEL_ZOOM_STEP = 0.1
const DEFAULT_MODAL_ZOOM = 1

interface RenderOptions {
  debounceKey?: string
  debounceMs?: number
  requireConnected?: boolean
  signal?: AbortSignal
  registerModalCleanup?: (cleanup: () => void) => void
}

interface PendingRender {
  timer: ReturnType<typeof setTimeout> | null
  supersede: () => void
}

interface ModalZoomAnchor {
  clientX: number
  clientY: number
}

export class PumlerBlockRenderer {
  private readonly pendingRenders = new Map<string, PendingRender>()
  private readonly activeRenderTokens = new Map<string, number>()
  private readonly inFlightRemoteRenders = new Map<string, Promise<string>>()
  private readonly sanitizedSvgTemplates = new Map<string, SVGElement>()
  private nextRenderToken = 0
  private nextSvgIdScope = 0

  constructor(
    private readonly client: PumlerApiClient,
    private readonly cache?: PumlerSvgCache
  ) {}

  async render(source: string, element: HTMLElement, options: RenderOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      return
    }

    element.classList.add('pumler-render')
    element.replaceChildren(createStatusElement('Rendering Pumler diagram...'))

    const debounceKey = options.debounceKey || createElementDebounceKey(element)
    const token = ++this.nextRenderToken
    this.activeRenderTokens.set(debounceKey, token)

    const isCurrentRender = () => this.activeRenderTokens.get(debounceKey) === token
    let parsed: ReturnType<typeof parsePumlerBlock>
    let renderOptions: RenderDiagramOptions
    try {
      parsed = parsePumlerBlock(source)
      renderOptions = {
        provider: parsed.metadata.provider,
        type: parsed.metadata.type,
        theme: resolveTheme(parsed.metadata.theme),
        source: parsed.source
      }

      const cachedSvg = await this.cache?.get(renderOptions)
      if (cachedSvg) {
        if (options.signal?.aborted || !isCurrentRender()) {
          return
        }

        this.replaceWithDiagram(element, cachedSvg, parsed.metadata, renderOptions, options.registerModalCleanup)
        return
      }
    } catch (error) {
      if (!options.signal?.aborted && isCurrentRender()) {
        element.replaceChildren(createErrorElement(error))
      }
      return
    }

    const pendingRender = this.pendingRenders.get(debounceKey)
    if (pendingRender) {
      if (pendingRender.timer !== null) {
        clearTimeout(pendingRender.timer)
      }
      pendingRender.supersede()
    }

    const debounceMs = options.debounceMs ?? DEFAULT_RENDER_DEBOUNCE_MS
    return await new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      let pendingRender: PendingRender | null = null
      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        options.signal?.removeEventListener('abort', settle)
        resolve()
      }
      const cancelScheduledRender = () => {
        if (timer !== null) {
          clearTimeout(timer)
        }
        if (pendingRender && this.pendingRenders.get(debounceKey) === pendingRender) {
          this.pendingRenders.delete(debounceKey)
        }
        settle()
      }

      const execute = () => {
        if (pendingRender && this.pendingRenders.get(debounceKey) === pendingRender) {
          this.pendingRenders.delete(debounceKey)
        }
        void this.renderRemote(
          renderOptions,
          parsed.metadata,
          element,
          debounceKey,
          token,
          options.requireConnected,
          options.signal,
          options.registerModalCleanup
        ).finally(settle)
      }

      if (debounceMs <= 0) {
        execute()
        return
      }

      timer = setTimeout(execute, debounceMs)
      pendingRender = {
        timer,
        supersede: cancelScheduledRender
      }
      this.pendingRenders.set(debounceKey, pendingRender)
      options.signal?.addEventListener('abort', settle, { once: true })
      if (options.signal?.aborted) {
        settle()
      }
    })
  }

  private async renderRemote(
    options: RenderDiagramOptions,
    metadata: { provider: string, type: string, title?: string },
    element: HTMLElement,
    debounceKey: string,
    token: number,
    requireConnected: boolean | undefined,
    signal: AbortSignal | undefined,
    registerModalCleanup: ((cleanup: () => void) => void) | undefined
  ): Promise<void> {
    if (requireConnected && !element.isConnected) {
      return
    }

    const isCurrentRender = () => this.activeRenderTokens.get(debounceKey) === token

    try {
      const svg = await this.getOrStartRemoteRender(options)

      if (signal?.aborted || !isCurrentRender()) {
        return
      }

      this.replaceWithDiagram(element, svg, metadata, options, registerModalCleanup)
    } catch (error) {
      if (signal?.aborted || !isCurrentRender()) {
        return
      }
      element.replaceChildren(createErrorElement(error))
    }
  }

  private getOrStartRemoteRender(options: RenderDiagramOptions): Promise<string> {
    const key = createRenderDiagramCacheSeed(options)
    const existingRender = this.inFlightRemoteRenders.get(key)
    if (existingRender) {
      return existingRender
    }

    const render = this.client.renderDiagram(options)
      .then(async svg => {
        await this.cache?.set(options, svg)
        return svg
      })
      .finally(() => {
        this.inFlightRemoteRenders.delete(key)
      })

    this.inFlightRemoteRenders.set(key, render)
    return render
  }

  private replaceWithDiagram(
    element: HTMLElement,
    svg: string,
    metadata: { provider: string, type: string, title?: string },
    options: RenderDiagramOptions,
    registerModalCleanup: ((cleanup: () => void) => void) | undefined
  ): void {
    const renderSeed = createRenderDiagramCacheSeed(options)

    const template = this.getOrCreateSanitizedSvgTemplate(renderSeed, svg)
    const svgElement = cloneSanitizedSvgWithIdScope(template, this.createSvgIdScope())
    svgElement.classList.add('pumler-render__svg')

    element.replaceChildren(createDiagramFigure(svgElement, metadata, registerModalCleanup))
  }

  private getOrCreateSanitizedSvgTemplate(
    renderSeed: string,
    svg: string
  ): SVGElement {
    const cachedTemplate = this.sanitizedSvgTemplates.get(renderSeed)
    if (cachedTemplate) {
      this.sanitizedSvgTemplates.delete(renderSeed)
      this.sanitizedSvgTemplates.set(renderSeed, cachedTemplate)
      return cachedTemplate
    }

    const template = sanitizeSvg(svg)
    this.sanitizedSvgTemplates.set(renderSeed, template)
    while (this.sanitizedSvgTemplates.size > SANITIZED_SVG_TEMPLATE_CACHE_LIMIT) {
      const oldestKey = this.sanitizedSvgTemplates.keys().next().value
      if (!oldestKey) {
        break
      }
      this.sanitizedSvgTemplates.delete(oldestKey)
    }
    return template
  }

  private createSvgIdScope(): string {
    this.nextSvgIdScope += 1
    return `pumler-svg-${this.nextSvgIdScope}`
  }
}

const elementDebounceKeys = new WeakMap<HTMLElement, string>()
let nextElementDebounceKey = 0

function createElementDebounceKey(element: HTMLElement): string {
  const existingKey = elementDebounceKeys.get(element)
  if (existingKey) {
    return existingKey
  }

  nextElementDebounceKey += 1
  const key = `element-${nextElementDebounceKey}`
  elementDebounceKeys.set(element, key)
  return key
}

function createDiagramFigure(
  svgElement: SVGElement,
  metadata: { provider: string, type: string, title?: string },
  registerModalCleanup: ((cleanup: () => void) => void) | undefined
): HTMLElement {
  const figure = document.createElement('div')
  figure.className = 'pumler-render__figure'

  const viewport = document.createElement('div')
  viewport.className = 'pumler-render__viewport'
  viewport.appendChild(svgElement)

  let isExpanded = true
  const summary = createCollapsedSummary(metadata, svgElement, registerModalCleanup, () => {
    setExpanded(!isExpanded)
  })
  const setExpanded = (expanded: boolean) => {
    isExpanded = expanded
    viewport.hidden = !expanded
    summary.button.setAttribute('aria-expanded', String(expanded))
    summary.button.setAttribute('aria-label', expanded ? 'Collapse Pumler diagram' : 'Expand Pumler diagram')
    summary.button.setAttribute('title', expanded ? 'Collapse diagram' : 'Expand diagram')
    summary.stateIcon.replaceChildren(expanded ? createChevronUpIcon() : createChevronDownIcon())
    figure.classList.toggle('is-collapsed', !expanded)
  }
  setExpanded(true)

  figure.appendChild(summary.button)
  figure.appendChild(viewport)

  return figure
}

function createCollapsedSummary(
  metadata: { provider: string, type: string, title?: string },
  svgElement: SVGElement,
  registerModalCleanup: ((cleanup: () => void) => void) | undefined,
  onToggle: () => void
): { button: HTMLButtonElement, stateIcon: HTMLSpanElement } {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pumler-render__collapsed'
  button.addEventListener('click', onToggle)

  const iconWrap = document.createElement('span')
  iconWrap.className = 'pumler-render__collapsed-icon'
  iconWrap.appendChild(createDiagramIcon())

  const openButton = document.createElement('span')
  openButton.className = 'pumler-render__panel-action pumler-render__open-button'
  openButton.setAttribute('role', 'button')
  openButton.setAttribute('tabindex', '0')
  openButton.setAttribute('aria-label', 'Open large preview')
  openButton.setAttribute('title', 'Open large preview')
  openButton.appendChild(createMagnifierIcon())
  openButton.addEventListener('click', event => {
    event.stopPropagation()
    openRegisteredLargePreview(svgElement, registerModalCleanup)
  })
  openButton.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      openRegisteredLargePreview(svgElement, registerModalCleanup)
    }
  })

  const text = document.createElement('span')
  text.className = 'pumler-render__collapsed-text'

  const title = document.createElement('span')
  title.className = 'pumler-render__collapsed-title'
  title.textContent = metadata.title || 'Pumler diagram'

  const meta = document.createElement('span')
  meta.className = 'pumler-render__collapsed-meta'
  meta.textContent = `${metadata.provider} / ${metadata.type}`

  const expandIcon = document.createElement('span')
  expandIcon.className = 'pumler-render__collapsed-expand'

  text.appendChild(title)
  text.appendChild(meta)
  button.appendChild(iconWrap)
  button.appendChild(text)
  button.appendChild(openButton)
  button.appendChild(expandIcon)

  return { button, stateIcon: expandIcon }
}

function openRegisteredLargePreview(
  svgElement: SVGElement,
  registerModalCleanup: ((cleanup: () => void) => void) | undefined
): void {
  const cleanup = openLargePreview(svgElement)
  registerModalCleanup?.(cleanup)
}

function createMagnifierIcon(): SVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('class', 'pumler-render__open-icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('cx', '11')
  circle.setAttribute('cy', '11')
  circle.setAttribute('r', '7')

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', '16.5')
  line.setAttribute('y1', '16.5')
  line.setAttribute('x2', '21')
  line.setAttribute('y2', '21')

  icon.appendChild(circle)
  icon.appendChild(line)
  return icon
}

function createChevronUpIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__control-icon')
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', '6 15 12 9 18 15')
  icon.appendChild(polyline)
  return icon
}

function createChevronDownIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__control-icon')
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', '6 9 12 15 18 9')
  icon.appendChild(polyline)
  return icon
}

function createCloseIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__control-icon')
  const firstLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  firstLine.setAttribute('x1', '18')
  firstLine.setAttribute('y1', '6')
  firstLine.setAttribute('x2', '6')
  firstLine.setAttribute('y2', '18')

  const secondLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  secondLine.setAttribute('x1', '6')
  secondLine.setAttribute('y1', '6')
  secondLine.setAttribute('x2', '18')
  secondLine.setAttribute('y2', '18')

  icon.appendChild(firstLine)
  icon.appendChild(secondLine)
  return icon
}

function createDiagramIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__collapsed-diagram-icon')
  icon.setAttribute('viewBox', '0 0 400 400')

  const topLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  topLine.setAttribute('x1', '70')
  topLine.setAttribute('y1', '155')
  topLine.setAttribute('x2', '298')
  topLine.setAttribute('y2', '155')
  topLine.setAttribute('class', 'pumler-render__collapsed-logo-primary')

  const topArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  topArrow.setAttribute('points', '340,155 294,132 294,178')
  topArrow.setAttribute('class', 'pumler-render__collapsed-logo-primary-fill')

  const bottomLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  bottomLine.setAttribute('x1', '330')
  bottomLine.setAttribute('y1', '245')
  bottomLine.setAttribute('x2', '102')
  bottomLine.setAttribute('y2', '245')
  bottomLine.setAttribute('class', 'pumler-render__collapsed-logo-secondary')

  const bottomArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  bottomArrow.setAttribute('points', '60,245 106,222 106,268')
  bottomArrow.setAttribute('class', 'pumler-render__collapsed-logo-secondary-fill')

  icon.appendChild(topLine)
  icon.appendChild(topArrow)
  icon.appendChild(bottomLine)
  icon.appendChild(bottomArrow)
  return icon
}

function createBaseIcon(className: string): SVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('class', className)
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  return icon
}

function openLargePreview(svgElement: SVGElement): () => void {
  const overlay = document.createElement('div')
  overlay.className = 'pumler-render__modal'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')

  const preview = document.createElement('div')
  preview.className = 'pumler-render__modal-preview'

  const modalToolbar = document.createElement('div')
  modalToolbar.className = 'pumler-render__modal-toolbar'

  const zoomOutButton = document.createElement('button')
  zoomOutButton.type = 'button'
  zoomOutButton.className = 'pumler-render__icon-button pumler-render__modal-zoom-out'
  zoomOutButton.setAttribute('aria-label', 'Zoom out')
  zoomOutButton.setAttribute('title', 'Zoom out')
  zoomOutButton.appendChild(createMinusIcon())

  const zoomValue = document.createElement('span')
  zoomValue.className = 'pumler-render__modal-zoom-value'

  const zoomInButton = document.createElement('button')
  zoomInButton.type = 'button'
  zoomInButton.className = 'pumler-render__icon-button pumler-render__modal-zoom-in'
  zoomInButton.setAttribute('aria-label', 'Zoom in')
  zoomInButton.setAttribute('title', 'Zoom in')
  zoomInButton.appendChild(createPlusIcon())

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'pumler-render__icon-button pumler-render__modal-close'
  closeButton.setAttribute('aria-label', 'Close preview')
  closeButton.setAttribute('title', 'Close preview')
  closeButton.appendChild(createCloseIcon())

  modalToolbar.appendChild(zoomOutButton)
  modalToolbar.appendChild(zoomValue)
  modalToolbar.appendChild(zoomInButton)
  modalToolbar.appendChild(closeButton)

  const modalViewport = document.createElement('div')
  modalViewport.className = 'pumler-render__modal-viewport'

  const modalSvg = svgElement.cloneNode(true) as SVGElement
  modalSvg.classList.remove('pumler-render__svg')
  modalSvg.classList.add('pumler-render__modal-svg')

  const activePointers = new Map<number, { x: number, y: number }>()
  let zoom = DEFAULT_MODAL_ZOOM
  let pinchStartDistance: number | null = null
  let pinchStartZoom = DEFAULT_MODAL_ZOOM
  const applyZoom = (nextZoom = zoom, anchor?: ModalZoomAnchor | 'diagram-center') => {
    const previousZoom = zoom
    const previousSvgRect = modalSvg.getBoundingClientRect()
    const previousViewportRect = modalViewport.getBoundingClientRect()
    const svgStartX = modalViewport.scrollLeft + previousSvgRect.left - previousViewportRect.left
    const svgStartY = modalViewport.scrollTop + previousSvgRect.top - previousViewportRect.top
    const focal = resolveZoomFocal(anchor, previousSvgRect, previousViewportRect)

    zoom = Math.min(MAX_MODAL_ZOOM, Math.max(MIN_MODAL_ZOOM, nextZoom))
    const zoomPercent = Math.round(zoom * 100)
    modalSvg.setAttribute('style', `width: ${zoomPercent}%;`)
    zoomValue.textContent = `${zoomPercent}%`
    zoomOutButton.disabled = zoom <= MIN_MODAL_ZOOM
    zoomInButton.disabled = zoom >= MAX_MODAL_ZOOM

    const scale = previousZoom > 0 ? zoom / previousZoom : 1
    const newWidth = getZoomedSize(modalSvg.getBoundingClientRect().width, previousSvgRect.width, scale)
    const newHeight = getZoomedSize(modalSvg.getBoundingClientRect().height, previousSvgRect.height, scale)

    if (anchor === 'diagram-center') {
      modalViewport.scrollLeft = roundScrollPosition(svgStartX + newWidth / 2 - getViewportWidth(modalViewport, previousViewportRect) / 2)
      modalViewport.scrollTop = roundScrollPosition(svgStartY + newHeight / 2 - getViewportHeight(modalViewport, previousViewportRect) / 2)
      return
    }

    if (focal) {
      modalViewport.scrollLeft = roundScrollPosition(svgStartX + focal.ratioX * newWidth - focal.offsetX)
      modalViewport.scrollTop = roundScrollPosition(svgStartY + focal.ratioY * newHeight - focal.offsetY)
    }
  }

  zoomOutButton.addEventListener('click', () => {
    applyZoom(zoom - MODAL_ZOOM_STEP, 'diagram-center')
  })
  zoomInButton.addEventListener('click', () => {
    applyZoom(zoom + MODAL_ZOOM_STEP, 'diagram-center')
  })
  modalViewport.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }

    event.preventDefault()
    applyZoom(zoom + (event.deltaY < 0 ? MODAL_WHEEL_ZOOM_STEP : -MODAL_WHEEL_ZOOM_STEP), {
      clientX: event.clientX,
      clientY: event.clientY
    })
  }, { passive: false })
  modalViewport.addEventListener('pointerdown', event => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size === 2) {
      pinchStartDistance = getPointerDistance(activePointers)
      pinchStartZoom = zoom
    }
  })
  modalViewport.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) {
      return
    }

    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size !== 2 || pinchStartDistance === null || pinchStartDistance <= 0) {
      return
    }

    event.preventDefault()
    applyZoom(pinchStartZoom * (getPointerDistance(activePointers) / pinchStartDistance), getPointerCenter(activePointers))
  })
  const clearPointer = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (activePointers.size < 2) {
      pinchStartDistance = null
      pinchStartZoom = zoom
    }
  }
  modalViewport.addEventListener('pointerup', clearPointer)
  modalViewport.addEventListener('pointercancel', clearPointer)
  modalViewport.addEventListener('pointerleave', clearPointer)
  modalViewport.addEventListener('lostpointercapture', clearPointer)
  modalViewport.addEventListener('dblclick', () => {
    applyZoom(DEFAULT_MODAL_ZOOM)
  })
  applyZoom()

  let closed = false
  const close = () => {
    if (closed) {
      return
    }
    closed = true
    document.removeEventListener('keydown', handleKeydown)
    overlay.remove()
  }
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
    }
  }

  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      close()
    }
  })
  document.addEventListener('keydown', handleKeydown)

  modalViewport.appendChild(modalSvg)
  preview.appendChild(modalToolbar)
  preview.appendChild(modalViewport)
  overlay.appendChild(preview)
  document.body.appendChild(overlay)
  closeButton.focus()

  return close
}

function getPointerDistance(pointers: Map<number, { x: number, y: number }>): number {
  const [first, second] = Array.from(pointers.values())
  if (!first || !second) {
    return 0
  }

  return Math.hypot(second.x - first.x, second.y - first.y)
}

function getPointerCenter(pointers: Map<number, { x: number, y: number }>): ModalZoomAnchor {
  const [first, second] = Array.from(pointers.values())
  if (!first || !second) {
    return { clientX: 0, clientY: 0 }
  }

  return {
    clientX: (first.x + second.x) / 2,
    clientY: (first.y + second.y) / 2
  }
}

function resolveZoomFocal(
  anchor: ModalZoomAnchor | 'diagram-center' | undefined,
  svgRect: DOMRect,
  viewportRect: DOMRect
): { ratioX: number, ratioY: number, offsetX: number, offsetY: number } | null {
  if (!anchor || anchor === 'diagram-center' || svgRect.width <= 0 || svgRect.height <= 0) {
    return null
  }

  return {
    ratioX: clamp((anchor.clientX - svgRect.left) / svgRect.width, 0, 1),
    ratioY: clamp((anchor.clientY - svgRect.top) / svgRect.height, 0, 1),
    offsetX: anchor.clientX - viewportRect.left,
    offsetY: anchor.clientY - viewportRect.top
  }
}

function getZoomedSize(measured: number, previous: number, scale: number): number {
  if (measured > 0) {
    return measured
  }
  if (previous > 0) {
    return previous * scale
  }
  return 0
}

function getViewportWidth(viewport: HTMLElement, fallbackRect: DOMRect): number {
  return viewport.clientWidth > 0 ? viewport.clientWidth : fallbackRect.width
}

function getViewportHeight(viewport: HTMLElement, fallbackRect: DOMRect): number {
  return viewport.clientHeight > 0 ? viewport.clientHeight : fallbackRect.height
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundScrollPosition(value: number): number {
  return Math.max(0, Math.round(value))
}

function createMinusIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__control-icon')
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', '5')
  line.setAttribute('y1', '12')
  line.setAttribute('x2', '19')
  line.setAttribute('y2', '12')
  icon.appendChild(line)
  return icon
}

function createPlusIcon(): SVGElement {
  const icon = createBaseIcon('pumler-render__control-icon')
  const horizontal = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  horizontal.setAttribute('x1', '5')
  horizontal.setAttribute('y1', '12')
  horizontal.setAttribute('x2', '19')
  horizontal.setAttribute('y2', '12')

  const vertical = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  vertical.setAttribute('x1', '12')
  vertical.setAttribute('y1', '5')
  vertical.setAttribute('x2', '12')
  vertical.setAttribute('y2', '19')

  icon.appendChild(horizontal)
  icon.appendChild(vertical)
  return icon
}

function createStatusElement(message: string): HTMLElement {
  const status = document.createElement('div')
  status.className = 'pumler-render__status'
  status.textContent = message
  return status
}

function createErrorElement(error: unknown): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'pumler-render__error'

  const title = document.createElement('div')
  title.className = 'pumler-render__error-title'
  title.textContent = getErrorTitle(error)
  wrapper.appendChild(title)

  const message = document.createElement('div')
  message.className = 'pumler-render__error-message'
  message.textContent = error instanceof Error ? error.message : 'Unknown Pumler rendering error'
  wrapper.appendChild(message)

  if (error instanceof PumlerRenderError && (error.line !== undefined || error.column !== undefined)) {
    const location = document.createElement('div')
    location.className = 'pumler-render__error-location'
    location.textContent = formatErrorLocation(error.line, error.column)
    wrapper.appendChild(location)
  }

  return wrapper
}

function getErrorTitle(error: unknown): string {
  if (error instanceof PumlerValidationError) {
    return 'Invalid Pumler diagram settings'
  }
  return 'Pumler rendering failed'
}

function formatErrorLocation(line?: number, column?: number): string {
  const parts = []
  if (line !== undefined) {
    parts.push(`line ${line}`)
  }
  if (column !== undefined) {
    parts.push(`column ${column}`)
  }
  return parts.join(', ')
}
