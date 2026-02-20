import type { Metadata } from "next"
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"

/*
 * Google Sans is a proprietary Google font — it is NOT available on Google Fonts
 * and cannot be imported via next/font/google. Using it causes:
 *   ⚠ Failed to find font override values for font `Google Sans`
 *
 * Plus Jakarta Sans is the closest available substitute on Google Fonts:
 * same geometric humanist style, very similar weight/spacing.
 *
 * The CSS variables --font-geist-sans / --font-geist-mono are injected by
 * next/font as data attributes on <html>, which globals.css then picks up.
 */
const appFont = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
})

const monoFont = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Safety AnalystBot",
  description: "AI-powered safety incident analysis",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    /*
     * className="dark" — always render in dark mode.
     * Ensures SSR and client both have identical class, so .dark CSS vars
     * in globals.css apply correctly from first paint.
     *
     * suppressHydrationWarning — required because next-themes (or any theme
     * toggle script) may modify the className attribute client-side.
     * This prop ONLY suppresses the warning on <html> itself; child
     * component warnings are still surfaced normally.
     */
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
    >
      <body
        className={`${appFont.variable} ${monoFont.variable} font-sans antialiased min-h-screen h-screen overflow-hidden`}
      >
        {children}
      </body>
    </html>
  )
}
