import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type AppLocale = 'en' | 'zh'

const LOCALE_STORAGE_KEY = 'dsh-workbench-locale'

interface I18nValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  tr: (english: string, chinese: string) => string
}

const I18nContext = createContext<I18nValue | undefined>(undefined)

function initialLocale(): AppLocale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'zh') return stored
  return navigator.language.toLocaleLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale)
  const setLocale = useCallback((next: AppLocale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
    setLocaleState(next)
  }, [])
  const tr = useCallback((english: string, chinese: string) => locale === 'zh' ? chinese : english, [locale])
  const value = useMemo(() => ({ locale, setLocale, tr }), [locale, setLocale, tr])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.dataset['locale'] = locale
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (value === undefined) throw new Error('useI18n must be used within I18nProvider')
  return value
}

export function isAppLocale(value: string): value is AppLocale {
  return value === 'en' || value === 'zh'
}
