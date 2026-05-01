import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PumlerApiClient, PumlerRenderError } from './client'

describe('PumlerApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('renders a diagram through the Pumler API', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse(200, { diagram: '<svg></svg>' }))

    const client = new PumlerApiClient()
    const result = await client.renderDiagram({
      provider: 'plantuml',
      type: 'sequence',
      theme: 'dark',
      source: 'Alice -> Bob'
    })

    expect(result).toBe('<svg></svg>')
    expect(fetchMock).toHaveBeenCalledWith('https://api.pumler.com/api/diagram/render', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        source: 'Alice -> Bob',
        metadata: {
          provider: 'plantuml',
          diagramType: 'sequence',
          theme: {
            mode: 'dark'
          }
        }
      })
    }))
  })

  test('maps structured API errors', async () => {
    vi.mocked(fetch).mockResolvedValue(createResponse(400, {
      error: {
        message: 'Syntax error',
        line: 2,
        column: 5
      }
    }))

    const client = new PumlerApiClient()
    await expect(client.renderDiagram({
      provider: 'plantuml',
      type: 'sequence',
      theme: 'light',
      source: 'bad'
    })).rejects.toMatchObject({
      name: 'PumlerRenderError',
      message: 'Syntax error',
      line: 2,
      column: 5
    })
  })

  test('maps network failures', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))

    const client = new PumlerApiClient()
    await expect(client.renderDiagram({
      provider: 'mermaid',
      type: 'flowchart',
      theme: 'light',
      source: 'flowchart LR'
    })).rejects.toThrow('Network error: unable to reach the Pumler rendering API')
  })

  test('does not cache repeated render requests by itself', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse(200, { diagram: '<svg></svg>' }))

    const client = new PumlerApiClient()
    const options = {
      provider: 'mermaid' as const,
      type: 'flowchart',
      theme: 'dark' as const,
      source: 'flowchart LR\nA --> B'
    }

    await client.renderDiagram(options)
    await client.renderDiagram(options)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function createResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as Response
}
