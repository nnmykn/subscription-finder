import type { Metadata } from 'next'
import { Noto_Sans_JP, Wix_Madefor_Display } from 'next/font/google'
import type React from 'react'

import './global.css'

const font = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto-sans-jp',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://calendar.kan.run/'),
  description: 'calendar.kan.run',
  title: 'calendar.kan.run',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang={'ja'}>
      <body className={font.variable}>{children}</body>
    </html>
  )
}
