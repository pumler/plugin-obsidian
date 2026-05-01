import { PUMLER_API_URL, type Provider, type ResolvedTheme } from './constants'

export interface RenderDiagramOptions {
  provider: Provider
  type: string
  theme: ResolvedTheme
  source: string
}

export interface RenderDiagramRequestOptions {
  signal?: AbortSignal
}

interface PumlerErrorPayload {
  error?: {
    message?: unknown
    line?: unknown
    column?: unknown
  }
}

export class PumlerRenderError extends Error {
  readonly line?: number
  readonly column?: number

  constructor(message: string, line?: number, column?: number) {
    super(message)
    this.name = 'PumlerRenderError'
    this.line = line
    this.column = column
  }
}

export class PumlerApiClient {
  async renderDiagram(options: RenderDiagramOptions, requestOptions: RenderDiagramRequestOptions = {}): Promise<string> {
    let response: Response
    try {
      response = await fetch(PUMLER_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: options.source,
          metadata: {
            provider: options.provider,
            diagramType: options.type,
            theme: {
              mode: options.theme
            }
          }
        }),
        signal: requestOptions.signal
      })
    } catch (error) {
      if (requestOptions.signal?.aborted) {
        throw error
      }
      throw new PumlerRenderError('Network error: unable to reach the Pumler rendering API')
    }

    const data = await readJson(response)
    if (!response.ok) {
      throw mapApiError(data)
    }

    const diagram = data && typeof data === 'object' && 'diagram' in data ? data.diagram : undefined
    if (typeof diagram !== 'string' || diagram.trim() === '') {
      throw new PumlerRenderError('Unexpected response from the Pumler rendering API')
    }

    return diagram
  }
}

export function createRenderDiagramCacheSeed(options: RenderDiagramOptions): string {
  return JSON.stringify([
    PUMLER_API_URL,
    options.provider,
    options.type,
    options.theme,
    options.source
  ])
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function mapApiError(payload: PumlerErrorPayload | Record<string, unknown> | null): PumlerRenderError {
  const errorPayload = payload && typeof payload === 'object' && 'error' in payload
    ? (payload as PumlerErrorPayload).error
    : null

  const message = typeof errorPayload?.message === 'string'
    ? errorPayload.message
    : 'Pumler rendering API returned an error'
  const line = typeof errorPayload?.line === 'number' ? errorPayload.line : undefined
  const column = typeof errorPayload?.column === 'number' ? errorPayload.column : undefined

  return new PumlerRenderError(message, line, column)
}
