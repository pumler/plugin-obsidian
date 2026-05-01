import { describe, expect, test } from 'vitest'
import { resolveTheme } from './theme'

describe('resolveTheme', () => {
  test('respects explicit dark theme', () => {
    document.body.className = 'theme-light'
    expect(resolveTheme('dark')).toBe('dark')
  })

  test('respects explicit light theme', () => {
    document.body.className = 'theme-dark'
    expect(resolveTheme('light')).toBe('light')
  })

  test('resolves auto to dark when Obsidian uses dark theme', () => {
    document.body.className = 'theme-dark'
    expect(resolveTheme('auto')).toBe('dark')
  })

  test('resolves auto to light by default', () => {
    document.body.className = 'theme-light'
    expect(resolveTheme('auto')).toBe('light')
  })
})
