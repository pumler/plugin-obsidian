import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RequestUrlResponse } from 'obsidian'
import { PumlerApiClient, type PumlerRequestUrl } from './client'

describe('PumlerApiClient', () => {
  let requestUrlMock: ReturnType<typeof vi.fn<PumlerRequestUrl>>

  beforeEach(() => {
    requestUrlMock = vi.fn<PumlerRequestUrl>()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('renders a diagram through the Pumler API', async () => {
    requestUrlMock.mockResolvedValue(createResponse(200, { diagram: '<svg></svg>' }))

    const client = new PumlerApiClient(requestUrlMock)
    const result = await client.renderDiagram({
      provider: 'plantuml',
      type: 'sequence',
      theme: 'dark',
      source: 'Alice -> Bob'
    })

    expect(result).toBe('<svg></svg>')
    expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.pumler.com/api/diagram/render',
      method: 'POST',
      contentType: 'application/json',
      throw: false,
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
    requestUrlMock.mockResolvedValue(createResponse(400, {
      error: {
        message: 'Syntax error',
        line: 2,
        column: 5
      }
    }))

    const client = new PumlerApiClient(requestUrlMock)
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
    requestUrlMock.mockRejectedValue(new Error('offline'))

    const client = new PumlerApiClient(requestUrlMock)
    await expect(client.renderDiagram({
      provider: 'mermaid',
      type: 'flowchart',
      theme: 'light',
      source: 'flowchart LR'
    })).rejects.toThrow('Network error: unable to reach the Pumler rendering API')
  })

  test('does not cache repeated render requests by itself', async () => {
    requestUrlMock.mockResolvedValue(createResponse(200, { diagram: '<svg></svg>' }))

    const client = new PumlerApiClient(requestUrlMock)
    const options = {
      provider: 'mermaid' as const,
      type: 'flowchart',
      theme: 'dark' as const,
      source: 'flowchart LR\nA --> B'
    }

    await client.renderDiagram(options)
    await client.renderDiagram(options)

    expect(requestUrlMock).toHaveBeenCalledTimes(2)
  })
})

function createResponse(status: number, data: unknown): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: data,
    text: JSON.stringify(data)
  }
}
