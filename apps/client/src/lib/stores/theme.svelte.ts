export type Theme = 'light' | 'dark' | 'system'

const createThemeStore = () => {
  let theme = $state<Theme>('system')
  let isDark = $state(false)

  const updateIsDark = () => {
    if (theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    } else {
      isDark = theme === 'dark'
    }

    if (isDark) {
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.style.colorScheme = 'light'
    }
  }

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme') as Theme | null
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      theme = stored
    }

    updateIsDark()

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme === 'system') {
        updateIsDark()
      }
    })
  }

  return {
    get theme() {
      return theme
    },
    get isDark() {
      return isDark
    },
    setTheme(t: Theme) {
      theme = t
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', t)
        updateIsDark()
      }
    },
  }
}

export const themeStore = createThemeStore()
