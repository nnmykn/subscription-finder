import type { Metadata } from 'next'
import { Noto_Sans_JP, Wix_Madefor_Display } from 'next/font/google'
import type React from 'react'
import { Toaster } from 'sonner'

import './global.css'

const font = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto-sans-jp',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://subscription-finder.kan.run/'),
  description: '不要なサブスク解約くん',
  title: '不要なサブスク解約くん',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang={'ja'}>
      <body className={font.variable}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
