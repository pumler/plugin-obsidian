import type { ResolvedTheme, Theme } from './constants'

export function resolveTheme(theme: Theme, root: ParentNode = document): ResolvedTheme {
  if (theme === 'dark' || theme === 'light') {
    return theme
  }

  const body = root instanceof Document ? root.body : document.body
  if (body.classList.contains('theme-dark')) {
    return 'dark'
  }

  return 'light'
}
