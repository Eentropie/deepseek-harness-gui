export type DesktopPlatform = 'darwin' | 'win32' | 'linux' | 'web'

export function desktopPlatform(): DesktopPlatform {
  if (typeof window !== 'undefined') {
    const platform = window.dshDesktop?.platform
    if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
    if (typeof navigator !== 'undefined') {
      if (/Windows/i.test(navigator.userAgent)) return 'win32'
      if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return 'darwin'
      if (/Linux/i.test(navigator.userAgent)) return 'linux'
    }
  }
  return 'web'
}

export function shortcutLabel(key: string, shift = false): string {
  return desktopPlatform() === 'win32'
    ? `Ctrl+${shift ? 'Shift+' : ''}${key}`
    : `⌘${shift ? '⇧' : ''}${key}`
}

export function platformBasename(path?: string): string | undefined {
  if (path === undefined) return undefined
  return path.split(/[\\/]/).filter(Boolean).at(-1)
}

export function platformDisplayName(): string {
  const platform = desktopPlatform()
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return 'Desktop'
}

export function desktopArchitecture(): string {
  return typeof window === 'undefined' ? 'web' : window.dshDesktop?.arch ?? 'web'
}
