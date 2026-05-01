import { describe, expect, test } from 'vitest'
import { sanitizeSvg } from './svg'

describe('sanitizeSvg', () => {
  test('returns an SVG element', () => {
    const svg = sanitizeSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')

    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.querySelector('circle')).not.toBeNull()
  })

  test('removes scripts and event attributes', () => {
    const svg = sanitizeSvg('<svg onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><text>link</text></a></svg>')

    expect(svg.querySelector('script')).toBeNull()
    expect(svg.querySelector('a')).toBeNull()
    expect(svg.getAttribute('onclick')).toBeNull()
  })

  test('removes external references and unsafe CSS', () => {
    const svg = sanitizeSvg(`
      <svg viewBox="0 0 10 10">
        <style>
          @import url("https://example.com/bad.css");
          .safe { fill: url(#safe); stroke: #fff; }
          .bad { fill: url("https://example.com/bad.svg#x"); background: red; }
        </style>
        <defs><linearGradient id="safe"><stop offset="0%" stop-color="#fff"/></linearGradient></defs>
        <image href="https://example.com/tracker.png" />
        <use href="https://example.com/sprite.svg#x" />
        <rect class="safe" style="fill: url(#safe); background-image: url(https://example.com/bad.png)" />
      </svg>
    `, 'diagram')

    expect(svg.querySelector('image')).toBeNull()
    expect(svg.querySelector('use')?.getAttribute('href')).toBeNull()
    expect(svg.querySelector('style')?.textContent).not.toContain('@import')
    expect(svg.querySelector('style')?.textContent).toContain('#diagram .safe { fill: url(#diagram-safe); stroke: #fff }')
    expect(svg.querySelector('style')?.textContent).not.toContain('https://example.com')
    expect(svg.querySelector('rect')?.getAttribute('style')).toBe('fill: url(#diagram-safe)')
  })

  test('normalizes percent dimensions to width-only responsive SVG', () => {
    const svg = sanitizeSvg('<svg viewBox="0 0 1200 800" width="100%" height="100%" style="width: 100%; height: 100%; color: red"></svg>')

    expect(svg.getAttribute('width')).toBe('100%')
    expect(svg.getAttribute('height')).toBeNull()
    expect(svg.getAttribute('viewBox')).toBe('0 0 1200 800')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('style')).toBe('color: red')
  })

  test('creates a viewBox from numeric dimensions when one is missing', () => {
    const svg = sanitizeSvg('<svg width="640px" height="480px"></svg>')

    expect(svg.getAttribute('viewBox')).toBe('0 0 640 480')
    expect(svg.getAttribute('width')).toBe('100%')
    expect(svg.getAttribute('height')).toBeNull()
  })

  test('scopes internal SVG ids and url references', () => {
    const svg = sanitizeSvg(`
      <svg viewBox="0 0 10 10">
        <defs>
          <linearGradient id="actor-bg"><stop offset="0%" stop-color="#fff"/></linearGradient>
          <clipPath id="clip"><rect width="10" height="10"/></clipPath>
        </defs>
        <style>.actor { fill: url(#actor-bg); }</style>
        <rect class="actor" fill="url(#actor-bg)" clip-path="url('#clip')" />
        <use href="#clip" />
      </svg>
    `, 'diagram 1')

    expect(svg.querySelector('[id="diagram-1-actor-bg"]')).not.toBeNull()
    expect(svg.querySelector('[id="diagram-1-clip"]')).not.toBeNull()
    expect(svg.querySelector('rect.actor')?.getAttribute('fill')).toBe('url(#diagram-1-actor-bg)')
    expect(svg.querySelector('rect.actor')?.getAttribute('clip-path')).toBe('url(#diagram-1-clip)')
    expect(svg.querySelector('use')?.getAttribute('href')).toBe('#diagram-1-clip')
    expect(svg.querySelector('style')?.textContent).toContain('#diagram-1 .actor { fill: url(#diagram-1-actor-bg) }')
  })

  test('keeps stylesheet rules scoped to the root SVG id', () => {
    const svg = sanitizeSvg(`
      <svg id="container" viewBox="0 0 10 10">
        <style>
          #container { fill: #111; }
          .node rect, text.label { stroke: #222; }
          p { margin: 0; }
          @keyframes dash { to { stroke-dashoffset: 0; } }
          body { color: red; }
        </style>
        <g class="node"><rect /></g>
        <text class="label">A</text>
      </svg>
    `, 'diagram')

    const style = svg.querySelector('style')?.textContent
    expect(svg.getAttribute('id')).toBe('diagram-container')
    expect(style).toContain('#diagram-container { fill: #111 }')
    expect(style).toContain('#diagram-container .node rect, #diagram-container text.label { stroke: #222 }')
    expect(style).toContain('#diagram-container p { margin: 0 }')
    expect(style).toContain('#diagram-container body { color: red }')
    expect(style).not.toContain('keyframes')
    expect(style).not.toContain('to { stroke-dashoffset')
  })

  test('preserves sanitized Mermaid foreignObject labels', () => {
    const svg = sanitizeSvg(`
      <svg id="container" viewBox="0 0 204 70">
        <g class="node default">
          <foreignObject width="9.171875" height="24">
            <div xmlns="http://www.w3.org/1999/xhtml" onclick="bad()" style="display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center; background-image: url(https://example.com/bad.png);">
              <span class="nodeLabel"><p>A</p></span>
            </div>
          </foreignObject>
        </g>
      </svg>
    `, 'diagram')

    const foreignObject = Array.from(svg.querySelectorAll('*')).find(element => element.localName === 'foreignObject')
    const label = svg.querySelector('.nodeLabel')
    const labelContainer = svg.querySelector('div')

    expect(foreignObject).not.toBeNull()
    expect(label?.textContent).toBe('A')
    expect(labelContainer?.getAttribute('onclick')).toBeNull()
    expect(labelContainer?.getAttribute('style')).toBe('display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center')
  })

  test('rejects invalid SVG', () => {
    expect(() => sanitizeSvg('<div></div>')).toThrow('Pumler API returned invalid SVG')
  })
})
