const SIZING_STYLE_PROPERTIES = ['width', 'height', 'max-width', 'max-height', 'min-width', 'min-height']
const CSS_SELECTOR_SEPARATOR_PATTERN = /,(?![^\[]*\])/

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'desc',
  'title',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'foreignobject',
  'div',
  'span',
  'p',
  'br',
  'use',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'style',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'fedropshadow',
  'feflood',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'feoffset'
])
const GLOBAL_ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
  'transform',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'color',
  'display',
  'visibility',
  'white-space'
])
const ELEMENT_ATTRIBUTES = new Map([
  ['svg', ['viewbox', 'width', 'height', 'x', 'y', 'preserveaspectratio', 'version', 'xmlns']],
  ['path', ['d', 'pathlength']],
  ['rect', ['x', 'y', 'width', 'height', 'rx', 'ry']],
  ['circle', ['cx', 'cy', 'r']],
  ['ellipse', ['cx', 'cy', 'rx', 'ry']],
  ['line', ['x1', 'y1', 'x2', 'y2']],
  ['polyline', ['points']],
  ['polygon', ['points']],
  ['text', ['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'word-spacing']],
  ['tspan', ['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'word-spacing']],
  ['textpath', ['href', 'xlink:href', 'startoffset', 'method', 'spacing']],
  ['foreignobject', ['x', 'y', 'width', 'height']],
  ['use', ['href', 'xlink:href', 'x', 'y', 'width', 'height']],
  ['marker', ['refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'viewbox', 'preserveaspectratio']],
  ['clippath', ['clippathunits']],
  ['mask', ['x', 'y', 'width', 'height', 'maskunits', 'maskcontentunits']],
  ['pattern', ['x', 'y', 'width', 'height', 'patternunits', 'patterncontentunits', 'patterntransform', 'viewbox', 'preserveaspectratio']],
  ['lineargradient', ['x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform', 'spreadmethod', 'href', 'xlink:href']],
  ['radialgradient', ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientunits', 'gradienttransform', 'spreadmethod', 'href', 'xlink:href']],
  ['stop', ['offset', 'stop-color', 'stop-opacity']],
  ['filter', ['x', 'y', 'width', 'height', 'filterunits', 'primitiveunits', 'color-interpolation-filters']],
  ['feblend', ['in', 'in2', 'mode', 'result']],
  ['fecolormatrix', ['in', 'type', 'values', 'result']],
  ['fecomponenttransfer', ['in', 'result']],
  ['fecomposite', ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result']],
  ['fedropshadow', ['dx', 'dy', 'stddeviation', 'flood-color', 'flood-opacity', 'result']],
  ['feflood', ['flood-color', 'flood-opacity', 'result']],
  ['fegaussianblur', ['in', 'stddeviation', 'edgemode', 'result']],
  ['femerge', ['result']],
  ['femergenode', ['in']],
  ['feoffset', ['in', 'dx', 'dy', 'result']]
].map(([element, attributes]) => [element, new Set(attributes)]))
const URL_ATTRIBUTES = new Set(['href', 'xlink:href'])
const CSS_PROPERTIES = new Set([
  'alignment-baseline',
  'background',
  'background-color',
  'border',
  'border-radius',
  'clip-path',
  'clip-rule',
  'color',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'font',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'opacity',
  'overflow',
  'padding',
  'pointer-events',
  'position',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-align',
  'vertical-align',
  'visibility',
  'white-space',
  'word-spacing',
  'z-index',
  ...SIZING_STYLE_PROPERTIES
])

export function sanitizeSvg(svg: string, idScope?: string): SVGElement {
  const parser = new DOMParser()
  const svgDocument = parser.parseFromString(svg, 'image/svg+xml')
  const parserError = svgDocument.querySelector('parsererror')
  const svgElement = svgDocument.querySelector('svg')

  if (parserError || !svgElement) {
    throw new Error('Pumler API returned invalid SVG')
  }

  svgDocument.querySelectorAll('*').forEach(element => {
    const elementName = getElementName(element)
    if (!ALLOWED_ELEMENTS.has(elementName)) {
      element.remove()
      return
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()

      if (!isAllowedAttribute(elementName, name)) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (URL_ATTRIBUTES.has(name) && !isSafeFragmentReference(value)) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === 'style') {
        const sanitizedStyle = sanitizeStyleDeclarations(value)
        if (sanitizedStyle) {
          element.setAttribute(attribute.name, sanitizedStyle)
        } else {
          element.removeAttribute(attribute.name)
        }
        continue
      }

      if (!hasSafeAttributeValue(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  const normalizedSvg = document.importNode(svgElement, true)
  if (idScope) {
    scopeSvgIds(normalizedSvg, idScope)
  }
  scopeStyleElementsToRoot(normalizedSvg, idScope)
  normalizeSvgLayout(normalizedSvg)
  return normalizedSvg
}

export function cloneSanitizedSvgWithIdScope(svgElement: SVGElement, idScope: string): SVGElement {
  const clone = svgElement.cloneNode(true) as SVGElement
  scopeSvgIds(clone, idScope)
  scopeStyleElementsToRoot(clone, idScope)
  return clone
}

function getElementName(element: Element): string {
  return element.localName.toLowerCase()
}

function isAllowedAttribute(elementName: string, attributeName: string): boolean {
  return GLOBAL_ATTRIBUTES.has(attributeName) || Boolean(ELEMENT_ATTRIBUTES.get(elementName)?.has(attributeName))
}

function isSafeFragmentReference(value: string): boolean {
  return /^#[^\s"'<>]+$/.test(value.trim())
}

function hasSafeAttributeValue(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase()
  if (
    normalizedValue.includes('javascript:') ||
    normalizedValue.includes('vbscript:') ||
    normalizedValue.includes('data:') ||
    normalizedValue.includes('expression(') ||
    normalizedValue.includes('-moz-binding') ||
    normalizedValue.includes('behavior:')
  ) {
    return false
  }

  return hasOnlySafeCssUrls(value)
}

function sanitizeStyleSheet(styleSheet: string, rootSelector: string): string {
  const rules = []
  const styleSheetWithoutImports = stripCssAtRules(styleSheet.replace(/@import[^;]+;/gi, ''))
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(styleSheetWithoutImports)) !== null) {
    const selector = match[1]?.trim()
    const declarations = sanitizeStyleDeclarations(match[2] ?? '')
    const scopedSelector = selector ? scopeCssSelector(selector, rootSelector) : null
    if (scopedSelector && declarations) {
      rules.push(`${scopedSelector} { ${declarations} }`)
    }
  }

  return rules.join('\n')
}

function stripCssAtRules(styleSheet: string): string {
  return styleSheet.replace(/@[\w-]+\s+[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
}

function scopeCssSelector(selector: string, rootSelector: string): string | null {
  if (selector.includes('@')) {
    return null
  }

  const scopedSelectors = selector
    .split(CSS_SELECTOR_SEPARATOR_PATTERN)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => scopeSingleCssSelector(part, rootSelector))
    .filter((part): part is string => Boolean(part))

  return scopedSelectors.length > 0 ? scopedSelectors.join(', ') : null
}

function scopeSingleCssSelector(selector: string, rootSelector: string): string | null {
  if (!/^[a-zA-Z0-9\s.#:[\],>+~*="'()_-]+$/.test(selector)) {
    return null
  }
  if (selector === ':root') {
    return rootSelector
  }
  if (selector.startsWith(rootSelector)) {
    return selector
  }
  return `${rootSelector} ${selector}`
}

function sanitizeStyleDeclarations(style: string): string {
  return style
    .split(';')
    .map(declaration => declaration.trim())
    .filter(Boolean)
    .map(declaration => {
      const separatorIndex = declaration.indexOf(':')
      if (separatorIndex <= 0) {
        return null
      }

      const property = declaration.slice(0, separatorIndex).trim().toLowerCase()
      const value = declaration.slice(separatorIndex + 1).trim()
      if (!CSS_PROPERTIES.has(property) || !hasSafeAttributeValue(value)) {
        return null
      }

      return `${property}: ${value}`
    })
    .filter((declaration): declaration is string => Boolean(declaration))
    .join('; ')
}

function hasOnlySafeCssUrls(value: string): boolean {
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = urlPattern.exec(value)) !== null) {
    if (!isSafeFragmentReference(match[2] ?? '')) {
      return false
    }
  }

  return true
}

function scopeSvgIds(svgElement: SVGElement, idScope: string): void {
  const scopedIds = new Map<string, string>()
  const sanitizedScope = idScope.replace(/[^a-zA-Z0-9_-]/g, '-')

  const elementsWithId = [
    ...(svgElement.hasAttribute('id') ? [svgElement] : []),
    ...Array.from(svgElement.querySelectorAll<SVGElement>('[id]'))
  ]

  elementsWithId.forEach(element => {
    const id = element.getAttribute('id')
    if (!id) {
      return
    }

    const scopedId = `${sanitizedScope}-${id}`
    scopedIds.set(id, scopedId)
    element.setAttribute('id', scopedId)
  })

  if (scopedIds.size === 0) {
    return
  }

  svgElement.querySelectorAll('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      const rewrittenValue = rewriteSvgIdReferences(attribute.value, scopedIds)
      if (rewrittenValue !== attribute.value) {
        element.setAttribute(attribute.name, rewrittenValue)
      }
    }
  })

  svgElement.querySelectorAll('style').forEach(element => {
    const content = element.textContent
    if (!content) {
      return
    }

    element.textContent = rewriteSvgIdReferences(content, scopedIds)
  })
}

function rewriteSvgIdReferences(value: string, scopedIds: Map<string, string>): string {
  let rewrittenValue = value
  scopedIds.forEach((scopedId, id) => {
    const escapedId = escapeRegExp(id)
    rewrittenValue = rewrittenValue.replace(new RegExp(`url\\(\\s*(["']?)#${escapedId}\\1\\s*\\)`, 'g'), `url(#${scopedId})`)
    rewrittenValue = rewrittenValue.replace(new RegExp(`#${escapedId}(?![a-zA-Z0-9_-])`, 'g'), `#${scopedId}`)
    if (rewrittenValue === `#${id}`) {
      rewrittenValue = `#${scopedId}`
    }
  })
  return rewrittenValue
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSvgLayout(svgElement: SVGElement): void {
  ensureViewBox(svgElement)
  removeSizingStyleProperties(svgElement)

  svgElement.setAttribute('width', '100%')
  svgElement.removeAttribute('height')
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svgElement.setAttribute('focusable', 'false')
}

let nextGeneratedSvgScopeId = 0

function scopeStyleElementsToRoot(svgElement: SVGElement, idScope?: string): void {
  const styleElements = Array.from(svgElement.querySelectorAll('style'))
  if (styleElements.length === 0) {
    return
  }

  const rootSelector = `#${ensureRootSvgId(svgElement, idScope)}`
  styleElements.forEach(element => {
    const sanitizedStyleSheet = sanitizeStyleSheet(element.textContent ?? '', rootSelector)
    if (sanitizedStyleSheet) {
      element.textContent = sanitizedStyleSheet
    } else {
      element.remove()
    }
  })
}

function ensureRootSvgId(svgElement: SVGElement, idScope?: string): string {
  const existingId = svgElement.getAttribute('id')
  if (existingId) {
    return existingId
  }

  const nextId = idScope ? sanitizeId(idScope) : createGeneratedSvgScopeId()
  svgElement.setAttribute('id', nextId)
  return nextId
}

function createGeneratedSvgScopeId(): string {
  nextGeneratedSvgScopeId += 1
  return `pumler-svg-scope-${nextGeneratedSvgScopeId}`
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '-')
  return sanitized || createGeneratedSvgScopeId()
}

function ensureViewBox(svgElement: SVGElement): void {
  if (svgElement.getAttribute('viewBox')) {
    return
  }

  const width = parseLength(svgElement.getAttribute('width'))
  const height = parseLength(svgElement.getAttribute('height'))
  if (width === null || height === null) {
    return
  }

  svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`)
}

function parseLength(value: string | null): number | null {
  if (!value) {
    return null
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i)
  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function removeSizingStyleProperties(svgElement: SVGElement): void {
  const style = svgElement.getAttribute('style')
  if (!style) {
    return
  }

  const declarations = style
    .split(';')
    .map(declaration => declaration.trim())
    .filter(Boolean)
    .filter(declaration => {
      const property = declaration.split(':', 1)[0]?.trim().toLowerCase()
      return property ? !SIZING_STYLE_PROPERTIES.includes(property) : false
    })

  if (declarations.length === 0) {
    svgElement.removeAttribute('style')
    return
  }

  svgElement.setAttribute('style', declarations.join('; '))
}
