import type { Metadata } from 'next';
import './globals.css';

/* No `next/font/google`. It downloads a font file at build time, and this
 * project ships zero external assets — the small amount of UI text uses the
 * platform stack. */

export const metadata: Metadata = {
  title: 'Night Street',
  description: 'A walkable city street at golden hour. Procedural geometry, materials and sound. MIT reference replica of StarKnightt/night-street.',
};

export const viewport = {
  themeColor: '#05070b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full overflow-hidden bg-black text-white">{children}</body>
    </html>
  );
}
