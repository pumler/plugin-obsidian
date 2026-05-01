import { load } from 'js-yaml'
import {
  DEFAULT_THEME,
  PROVIDERS,
  SUPPORTED_DIAGRAM_TYPES,
  THEMES,
  type ParsedDiagram,
  type Provider,
  type Theme
} from './constants'

const HEADER_DELIMITER = '---'
const SUPPORTED_SETTINGS = ['provider', 'type', 'theme', 'title']

export class PumlerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PumlerValidationError'
  }
}

export function parsePumlerBlock(input: string): ParsedDiagram {
  const normalizedInput = input.replace(/\r\n/g, '\n')
  const lines = normalizedInput.split('\n')

  if (lines[0]?.trim() !== HEADER_DELIMITER) {
    throw new PumlerValidationError('Pumler block must start with a YAML header delimited by ---')
  }

  const closingDelimiterIndex = lines.findIndex((line, index) => index > 0 && line.trim() === HEADER_DELIMITER)
  if (closingDelimiterIndex < 0) {
    throw new PumlerValidationError('Pumler YAML header is missing the closing --- delimiter')
  }

  const rawHeader = lines.slice(1, closingDelimiterIndex).join('\n')
  const source = lines.slice(closingDelimiterIndex + 1).join('\n')
  if (source.trim() === '') {
    throw new PumlerValidationError('Pumler diagram source is required')
  }

  const metadata = parseMetadata(rawHeader)
  return { metadata, source }
}

function parseMetadata(rawHeader: string) {
  let parsed: unknown
  try {
    parsed = load(rawHeader)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid YAML'
    throw new PumlerValidationError(`Invalid Pumler YAML header: ${message}`)
  }

  if (!isPlainObject(parsed)) {
    throw new PumlerValidationError('Pumler YAML header must be an object')
  }

  const unsupportedSettings = Object.keys(parsed).filter(key => !SUPPORTED_SETTINGS.includes(key))
  if (unsupportedSettings.length > 0) {
    throw new PumlerValidationError(`Unsupported Pumler setting: ${unsupportedSettings.join(', ')}`)
  }

  const provider = parseProvider(parsed.provider)
  const diagramType = parseDiagramType(provider, parsed.type)
  const theme = parseTheme(parsed.theme)
  const title = parseTitle(parsed.title)

  return {
    provider,
    type: diagramType,
    theme,
    ...(title ? { title } : {})
  }
}

function parseProvider(value: unknown): Provider {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PumlerValidationError('Pumler setting "provider" is required')
  }

  const provider = value.trim()
  if (!isProvider(provider)) {
    throw new PumlerValidationError(`Unsupported Pumler provider "${provider}". Supported providers: ${PROVIDERS.join(', ')}`)
  }

  return provider
}

function parseDiagramType(provider: Provider, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PumlerValidationError('Pumler setting "type" is required')
  }

  const diagramType = value.trim()
  const supportedTypes = SUPPORTED_DIAGRAM_TYPES[provider]
  if (!supportedTypes.includes(diagramType as never)) {
    throw new PumlerValidationError(`Unsupported ${provider} diagram type "${diagramType}". Supported types: ${supportedTypes.join(', ')}`)
  }

  return diagramType
}

function parseTheme(value: unknown): Theme {
  if (value === undefined || value === null) {
    return DEFAULT_THEME
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PumlerValidationError('Pumler setting "theme" must be one of: auto, dark, light')
  }

  const theme = value.trim()
  if (!isTheme(theme)) {
    throw new PumlerValidationError(`Unsupported Pumler theme "${theme}". Supported themes: ${THEMES.join(', ')}`)
  }

  return theme
}

function parseTitle(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new PumlerValidationError('Pumler setting "title" must be a string')
  }

  const title = value.trim()
  return title.length > 0 ? title : null
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
