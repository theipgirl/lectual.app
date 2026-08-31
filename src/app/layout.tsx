import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

/**
 * Root layout. Deliberately thin.
 *
 * It sets the document, the tokens (via globals.css) and the three Lectual
 * faces, and nothing else.
 *
 * FONTS. Bricolage Grotesque (wordmark), Hanken Grotesk (body) and Space Mono
 * (identifiers — case numbers, stage codes, counts) are Lectual's brand faces,
 * self-hosted by next/font so there is no runtime request to Google and no
 * third-party connection from an attorney's browser. `display: "swap"` plus the
 * real fallback stacks in globals.css mean a slow or failed font paints
 * readable text immediately rather than blank boxes — which matters when the
 * page is a list of court deadlines being read on courthouse wifi.
 *
 * It does NOT render the Shell. Auth lives one level down: `/sign-in/` and the
 * fail-closed "no firm access" screen must be able to render a bare page, and a
 * Shell here would put a firm's name above a screen belonging to nobody.
 * Signed-in screens wrap themselves in `<Shell firmName={…}>`.
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-loaded",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body-loaded",
});

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono-loaded",
});

export const metadata: Metadata = {
  title: {
    default: "Docket — Lectual",
    template: "%s · Docket",
  },
  // Deliberately names no firm: the active org comes from the session, and a
  // hardcoded firm here would mislabel the tab for anyone in another tenant.
  description: "Deadlines, matters and calendar.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No themeColor here on purpose: it would have to be a literal hex and would
  // silently drift from `--surface` in globals.css. The browser derives the
  // chrome colour from the painted background instead.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-dvh bg-surface-2 text-ink antialiased">{children}</body>
    </html>
  );
}
