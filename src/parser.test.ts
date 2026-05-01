import { describe, expect, test } from 'vitest'
import { parsePumlerBlock, PumlerValidationError } from './parser'

describe('parsePumlerBlock', () => {
  test('parses valid metadata and strips the YAML header', () => {
    const parsed = parsePumlerBlock(`---
provider: plantuml
type: sequence
theme: dark
---
Alice -> Bob: Hello`)

    expect(parsed.metadata).toEqual({
      provider: 'plantuml',
      type: 'sequence',
      theme: 'dark'
    })
    expect(parsed.source).toBe('Alice -> Bob: Hello')
  })

  test('defaults theme to auto', () => {
    const parsed = parsePumlerBlock(`---
provider: mermaid
type: flowchart
---
flowchart LR
A --> B`)

    expect(parsed.metadata.theme).toBe('auto')
  })

  test('parses optional title for local Obsidian UI', () => {
    const parsed = parsePumlerBlock(`---
provider: mermaid
type: flowchart
title: Checkout flow
---
flowchart LR
A --> B`)

    expect(parsed.metadata.title).toBe('Checkout flow')
  })

  test('supports structurizr metadata', () => {
    const parsed = parsePumlerBlock(`---
provider: structurizr
type: systemContext
theme: light
---
workspace {}`)

    expect(parsed.metadata).toEqual({
      provider: 'structurizr',
      type: 'systemContext',
      theme: 'light'
    })
  })

  test('rejects missing provider', () => {
    expect(() => parsePumlerBlock(`---
type: sequence
---
Alice -> Bob`)).toThrow(PumlerValidationError)
  })

  test('rejects missing type', () => {
    expect(() => parsePumlerBlock(`---
provider: plantuml
---
Alice -> Bob`)).toThrow('Pumler setting "type" is required')
  })

  test('rejects invalid theme', () => {
    expect(() => parsePumlerBlock(`---
provider: plantuml
type: sequence
theme: sepia
---
Alice -> Bob`)).toThrow('Unsupported Pumler theme "sepia"')
  })

  test('rejects non-string title', () => {
    expect(() => parsePumlerBlock(`---
provider: plantuml
type: sequence
title: 42
---
Alice -> Bob`)).toThrow('Pumler setting "title" must be a string')
  })

  test('rejects unsupported provider', () => {
    expect(() => parsePumlerBlock(`---
provider: graphviz
type: dot
---
digraph { a -> b }`)).toThrow('Unsupported Pumler provider "graphviz"')
  })

  test('rejects unsupported diagram type for provider', () => {
    expect(() => parsePumlerBlock(`---
provider: mermaid
type: state
---
stateDiagram-v2`)).toThrow('Unsupported mermaid diagram type "state"')
  })

  test('rejects unsupported settings', () => {
    expect(() => parsePumlerBlock(`---
provider: plantuml
type: sequence
scale: 2
---
Alice -> Bob`)).toThrow('Unsupported Pumler setting: scale')
  })
})
