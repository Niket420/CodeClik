import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'CodeClik — Build in the browser',
  description: 'A focused, browser-based development workspace.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-black text-[#e6edf3]">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: '#ffffff',
              colorPrimaryForeground: '#000000',
              colorBackground: '#0a0a0a',
              colorForeground: '#e6edf3',
              colorMutedForeground: '#8b949e',
              colorNeutral: '#525252',
              colorInput: '#000000',
              colorInputForeground: '#e6edf3',
              colorBorder: '#262626',
              borderRadius: '0.5rem',
            },
            elements: {
              card: 'border border-[#262626] shadow-2xl shadow-black/50',
              formButtonPrimary:
                'bg-white text-black hover:bg-[#d4d4d4] transition-colors shadow-none',
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
