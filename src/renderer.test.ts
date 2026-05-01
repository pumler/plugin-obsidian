import { afterEach, describe, expect, test, vi } from 'vitest'
import { PumlerApiClient, PumlerRenderError } from './client'
import { PumlerBlockRenderer } from './renderer'
import type { PumlerSvgCache } from './cache'

describe('PumlerBlockRenderer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('shows a loading state before rendering resolves', async () => {
    const deferred = createDeferred<string>()
    const renderer = new PumlerBlockRenderer(createClient(() => deferred.promise))
    const element = document.createElement('div')

    const renderPromise = renderer.render(validBlock(), element, { debounceMs: 0 })

    expect(element.textContent).toContain('Rendering Pumler diagram...')
    deferred.resolve('<svg viewBox="0 0 1 1"></svg>')
    await renderPromise
  })

  test('renders sanitized SVG on success', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg onclick="bad()"><script>bad()</script><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)

    expect(element.querySelector('.pumler-render__viewport')).not.toBeNull()
    expect(element.querySelector('.pumler-render__open-button')?.getAttribute('aria-label')).toBe('Open large preview')
    expect(element.querySelector('.pumler-render__collapse-button')).toBeNull()
    expect(element.querySelector('.pumler-render__collapsed')?.getAttribute('aria-expanded')).toBe('true')
    expect(element.querySelector('.pumler-render__open-icon')).not.toBeNull()
    expect(element.querySelector('svg')).not.toBeNull()
    expect(element.querySelector('script')).toBeNull()
    expect(element.querySelector('svg')?.getAttribute('onclick')).toBeNull()
  })

  test('open preview action does not toggle the summary panel', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)
    element.querySelector<HTMLElement>('.pumler-render__open-button')?.click()

    expect(document.querySelector('.pumler-render__modal')).not.toBeNull()
    expect(element.querySelector<HTMLElement>('.pumler-render__viewport')?.hidden).toBe(false)
    expect(element.querySelector('.pumler-render__collapsed')?.getAttribute('aria-expanded')).toBe('true')

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-close')?.click()
  })

  test('collapses and expands the diagram summary with title', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlockWithTitle(), element)

    const summary = element.querySelector<HTMLButtonElement>('.pumler-render__collapsed')
    expect(summary?.hidden).toBe(false)
    expect(summary?.getAttribute('aria-expanded')).toBe('true')

    summary?.click()
    expect(element.querySelector<HTMLElement>('.pumler-render__viewport')?.hidden).toBe(true)
    expect(summary?.getAttribute('aria-expanded')).toBe('false')
    expect(summary?.getAttribute('aria-label')).toBe('Expand Pumler diagram')
    expect(element.querySelector('.pumler-render__collapsed-title')?.textContent).toBe('AI chat scheme')
    expect(element.querySelector('.pumler-render__collapsed-meta')?.textContent).toBe('plantuml / sequence')
    expect(element.querySelector('.pumler-render__collapsed-logo-primary')).not.toBeNull()
    expect(element.querySelector('.pumler-render__collapsed-logo-secondary')).not.toBeNull()

    summary?.click()
    expect(element.querySelector<HTMLElement>('.pumler-render__viewport')?.hidden).toBe(false)
    expect(summary?.getAttribute('aria-expanded')).toBe('true')
    expect(summary?.getAttribute('aria-label')).toBe('Collapse Pumler diagram')
  })

  test('opens and closes a large preview', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)
    element.querySelector<HTMLButtonElement>('.pumler-render__open-button')?.click()

    expect(document.querySelector('.pumler-render__modal')).not.toBeNull()
    expect(document.querySelector('.pumler-render__modal-svg')).not.toBeNull()
    expect(document.querySelector('.pumler-render__modal-zoom-value')?.textContent).toBe('100%')
    expect(document.querySelector('.pumler-render__modal-zoom-out')?.getAttribute('aria-label')).toBe('Zoom out')
    expect(document.querySelector('.pumler-render__modal-zoom-in')?.getAttribute('aria-label')).toBe('Zoom in')
    expect(document.querySelector('.pumler-render__modal-close')?.getAttribute('aria-label')).toBe('Close preview')
    expect(document.querySelector('.pumler-render__modal-close')?.textContent).toBe('')

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-zoom-in')?.click()
    expect(document.querySelector('.pumler-render__modal-zoom-value')?.textContent).toBe('125%')
    expect(document.querySelector('.pumler-render__modal-svg')?.getAttribute('style')).toBe('width: 125%;')

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-zoom-out')?.click()
    expect(document.querySelector('.pumler-render__modal-zoom-value')?.textContent).toBe('100%')
    expect(document.querySelector('.pumler-render__modal-svg')?.getAttribute('style')).toBe('width: 100%;')

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-close')?.click()
    expect(document.querySelector('.pumler-render__modal')).toBeNull()
  })

  test('button zoom keeps the diagram center as focal point', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)
    element.querySelector<HTMLElement>('.pumler-render__open-button')?.click()

    const viewport = document.querySelector<HTMLElement>('.pumler-render__modal-viewport')
    const modalSvg = document.querySelector<SVGElement>('.pumler-render__modal-svg')
    mockElementSize(viewport, { left: 0, top: 0, width: 500, height: 400 })
    mockZoomableSvgRect(modalSvg, { left: 0, top: 0, width: 1000, height: 800 })

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-zoom-in')?.click()

    expect(viewport?.scrollLeft).toBe(375)
    expect(viewport?.scrollTop).toBe(300)

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-close')?.click()
  })

  test('zooms the large preview with modified wheel events', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)
    element.querySelector<HTMLElement>('.pumler-render__open-button')?.click()

    const viewport = document.querySelector<HTMLElement>('.pumler-render__modal-viewport')
    viewport?.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -1,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }))

    expect(document.querySelector('.pumler-render__modal-zoom-value')?.textContent).toBe('110%')
    expect(document.querySelector('.pumler-render__modal-svg')?.getAttribute('style')).toBe('width: 110%;')

    viewport?.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 1,
      metaKey: true,
      bubbles: true,
      cancelable: true
    }))

    expect(document.querySelector('.pumler-render__modal-zoom-value')?.textContent).toBe('100%')
    expect(document.querySelector('.pumler-render__modal-svg')?.getAttribute('style')).toBe('width: 100%;')

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-close')?.click()
  })

  test('wheel zoom keeps the cursor position as focal point', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg viewBox="0 0 10 10"><circle /></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)
    element.querySelector<HTMLElement>('.pumler-render__open-button')?.click()

    const viewport = document.querySelector<HTMLElement>('.pumler-render__modal-viewport')
    const modalSvg = document.querySelector<SVGElement>('.pumler-render__modal-svg')
    mockElementSize(viewport, { left: 100, top: 50, width: 500, height: 400 })
    mockZoomableSvgRect(modalSvg, { left: 80, top: 30, width: 1000, height: 800 })
    if (viewport) {
      viewport.scrollLeft = 20
      viewport.scrollTop = 20
    }

    viewport?.dispatchEvent(new WheelEvent('wheel', {
      clientX: 300,
      clientY: 250,
      deltaY: -1,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }))

    expect(viewport?.scrollLeft).toBe(42)
    expect(viewport?.scrollTop).toBe(42)

    document.querySelector<HTMLButtonElement>('.pumler-render__modal-close')?.click()
  })

  test('renders validation errors', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg></svg>'))
    const element = document.createElement('div')

    await renderImmediately(renderer, 'Alice -> Bob', element)

    expect(element.querySelector('.pumler-render__error-title')?.textContent).toBe('Invalid Pumler diagram settings')
    expect(element.textContent).toContain('Pumler block must start with a YAML header')
  })

  test('renders API errors with source location', async () => {
    const renderer = new PumlerBlockRenderer(createClient(async () => {
      throw new PumlerRenderError('Syntax error', 3, 7)
    }))
    const element = document.createElement('div')

    await renderImmediately(renderer, validBlock(), element)

    expect(element.querySelector('.pumler-render__error-title')?.textContent).toBe('Pumler rendering failed')
    expect(element.textContent).toContain('Syntax error')
    expect(element.textContent).toContain('line 3, column 7')
  })

  test('renders cached SVGs immediately without waiting for debounce', async () => {
    vi.useFakeTimers()
    const renderDiagram = vi.fn(async () => '<svg viewBox="0 0 10 10"><circle /></svg>')
    const cache: PumlerSvgCache = {
      get: vi.fn(async () => '<svg viewBox="0 0 20 20"><rect /></svg>'),
      set: vi.fn(async () => undefined)
    }
    const renderer = new PumlerBlockRenderer(createClient(renderDiagram), cache)
    const element = document.createElement('div')

    await renderer.render(validBlock(), element, {
      debounceKey: 'note.md:1',
      debounceMs: 700
    })

    expect(renderDiagram).not.toHaveBeenCalled()
    expect(cache.get).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'plantuml',
      type: 'sequence',
      theme: 'light',
      source: 'Alice -> Bob'
    }))
    expect(cache.set).not.toHaveBeenCalled()
    expect(element.querySelector('rect')).not.toBeNull()
  })

  test('reuses sanitized SVG templates with unique scoped IDs per render', async () => {
    const cachedSvg = `
      <svg viewBox="0 0 20 20">
        <defs>
          <linearGradient id="grad"><stop offset="0%" stop-color="red" /></linearGradient>
        </defs>
        <rect fill="url(#grad)" width="20" height="20" onclick="bad()" />
      </svg>
    `
    const cache: PumlerSvgCache = {
      get: vi.fn(async () => cachedSvg),
      set: vi.fn(async () => undefined)
    }
    const renderer = new PumlerBlockRenderer(createClient(async () => '<svg></svg>'), cache)
    const firstElement = document.createElement('div')
    const secondElement = document.createElement('div')

    await renderer.render(validBlock(), firstElement, { debounceKey: 'note.md:1', debounceMs: 0 })
    await renderer.render(validBlock(), secondElement, { debounceKey: 'note.md:2', debounceMs: 0 })

    const firstGradientId = firstElement.querySelector('[id]')?.getAttribute('id')
    const secondGradientId = secondElement.querySelector('[id]')?.getAttribute('id')
    expect(firstGradientId).toBeTruthy()
    expect(secondGradientId).toBeTruthy()
    expect(firstGradientId).not.toBe(secondGradientId)
    expect(firstElement.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${firstGradientId})`)
    expect(secondElement.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${secondGradientId})`)
    expect(firstElement.querySelector('rect')?.getAttribute('onclick')).toBeNull()
    expect(secondElement.querySelector('rect')?.getAttribute('onclick')).toBeNull()
  })

  test('does not skip cached renders for detached Obsidian processor elements', async () => {
    const renderDiagram = vi.fn(async () => '<svg viewBox="0 0 10 10"><circle /></svg>')
    const cache: PumlerSvgCache = {
      get: vi.fn(async () => '<svg viewBox="0 0 20 20"><rect /></svg>'),
      set: vi.fn(async () => undefined)
    }
    const renderer = new PumlerBlockRenderer(createClient(renderDiagram), cache)
    const element = document.createElement('div')

    await renderer.render(validBlock(), element, {
      debounceMs: 0,
      requireConnected: true
    })

    expect(renderDiagram).not.toHaveBeenCalled()
    expect(element.querySelector('rect')).not.toBeNull()
  })

  test('debounces repeated render requests for the same block', async () => {
    vi.useFakeTimers()
    const renderDiagram = vi.fn(async () => '<svg viewBox="0 0 10 10"><circle /></svg>')
    const renderer = new PumlerBlockRenderer(createClient(renderDiagram))
    const element = document.createElement('div')

    const firstRender = renderer.render(validBlockWithSource('Alice -> Bob: H'), element, {
      debounceKey: 'note.md:1',
      debounceMs: 700
    })
    const secondRender = renderer.render(validBlockWithSource('Alice -> Bob: Hello'), element, {
      debounceKey: 'note.md:1',
      debounceMs: 700
    })

    await firstRender
    expect(renderDiagram).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(699)
    expect(renderDiagram).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await secondRender

    expect(renderDiagram).toHaveBeenCalledTimes(1)
    expect(renderDiagram).toHaveBeenCalledWith(expect.objectContaining({
      source: 'Alice -> Bob: Hello'
    }))
  })

  test('keeps a pending debounced render alive when its view aborts', async () => {
    vi.useFakeTimers()
    const renderDiagram = vi.fn(async () => '<svg viewBox="0 0 10 10"><circle /></svg>')
    const renderer = new PumlerBlockRenderer(createClient(renderDiagram))
    const element = document.createElement('div')
    const abortController = new AbortController()

    const renderPromise = renderer.render(validBlock(), element, {
      debounceKey: 'note.md:1',
      debounceMs: 700,
      signal: abortController.signal
    })
    abortController.abort()

    await renderPromise
    expect(renderDiagram).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(700)

    expect(renderDiagram).toHaveBeenCalledTimes(1)
    expect(element.textContent).toContain('Rendering Pumler diagram...')
  })

  test('keeps in-flight remote renders reusable after a view aborts', async () => {
    const deferred = createDeferred<string>()
    const renderDiagram = vi.fn(() => deferred.promise)
    const renderer = new PumlerBlockRenderer(createClient(renderDiagram))
    const firstElement = document.createElement('div')
    const secondElement = document.createElement('div')
    const abortController = new AbortController()

    const firstRender = renderer.render(validBlock(), firstElement, {
      debounceMs: 0,
      signal: abortController.signal
    })
    await Promise.resolve()
    expect(renderDiagram).toHaveBeenCalledTimes(1)

    abortController.abort()

    const secondRender = renderer.render(validBlock(), secondElement, {
      debounceMs: 0
    })
    await Promise.resolve()
    expect(renderDiagram).toHaveBeenCalledTimes(1)

    deferred.resolve('<svg viewBox="0 0 10 10"><circle /></svg>')
    await Promise.all([firstRender, secondRender])

    expect(firstElement.textContent).toContain('Rendering Pumler diagram...')
    expect(secondElement.querySelector('circle')).not.toBeNull()
  })
})

function validBlock(): string {
  return `---
provider: plantuml
type: sequence
theme: auto
---
Alice -> Bob`
}

function validBlockWithTitle(): string {
  return `---
provider: plantuml
type: sequence
theme: auto
title: AI chat scheme
---
Alice -> Bob`
}

function createClient(renderDiagram: PumlerApiClient['renderDiagram']): PumlerApiClient {
  return { renderDiagram } as PumlerApiClient
}

function renderImmediately(renderer: PumlerBlockRenderer, source: string, element: HTMLElement): Promise<void> {
  return renderer.render(source, element, { debounceMs: 0 })
}

function validBlockWithSource(source: string): string {
  return `---
provider: plantuml
type: sequence
theme: auto
---
${source}`
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function mockElementSize(
  element: HTMLElement | null,
  rect: { left: number, top: number, width: number, height: number }
): void {
  if (!element) return

  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: rect.width
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: rect.height
  })
  element.getBoundingClientRect = () => createDomRect(rect)
}

function mockZoomableSvgRect(
  element: SVGElement | null,
  rect: { left: number, top: number, width: number, height: number }
): void {
  if (!element) return

  element.getBoundingClientRect = () => {
    const widthPercent = parseWidthPercent(element.getAttribute('style'))
    return createDomRect({
      left: rect.left,
      top: rect.top,
      width: rect.width * widthPercent,
      height: rect.height * widthPercent
    })
  }
}

function parseWidthPercent(style: string | null): number {
  const match = style?.match(/width:\s*(\d+(?:\.\d+)?)%/)
  return match ? Number(match[1]) / 100 : 1
}

function createDomRect(rect: { left: number, top: number, width: number, height: number }): DOMRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({})
  } as DOMRect
}
