export const PUMLER_API_URL = 'https://api.pumler.com/api/diagram/render'
export const DEFAULT_THEME = 'auto'

export const PROVIDERS = ['plantuml', 'structurizr', 'mermaid'] as const
export const THEMES = ['auto', 'dark', 'light'] as const

export const SUPPORTED_DIAGRAM_TYPES = {
  plantuml: [
    'sequence',
    'usecase',
    'class',
    'object',
    'activity',
    'component',
    'deployment',
    'state',
    'timing',
    'archimate',
    'mindmap',
    'wbs',
    'json',
    'yaml',
    'er',
    'nwdiag'
  ],
  structurizr: [
    'systemContext',
    'container',
    'component',
    'deployment'
  ],
  mermaid: [
    'flowchart',
    'sequence',
    'class',
    'er',
    'journey',
    'gantt',
    'pie',
    'quadrant',
    'requirement',
    'gitgraph',
    'c4',
    'mindmap',
    'timeline',
    'sankey',
    'xychart',
    'block',
    'packet',
    'kanban',
    'architecture',
    'radar',
    'treemap'
  ]
} as const

export type Provider = typeof PROVIDERS[number]
export type Theme = typeof THEMES[number]
export type ResolvedTheme = Exclude<Theme, 'auto'>

export interface DiagramMetadata {
  provider: Provider
  type: string
  theme: Theme
  title?: string
}

export interface ParsedDiagram {
  metadata: DiagramMetadata
  source: string
}
