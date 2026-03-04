"use client"

import { useEffect } from "react"

export default function ThemeProvider() {
  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
      let theme = stored
      if (!theme) {
        // Respect system preference if no stored preference
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        theme = prefersDark ? 'dark' : 'light'
      }
      if (theme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    } catch (e) {
      // ignore
    }
  }, [])

  return null
}
