import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Root layout. Deliberately thin.
 *
 * It sets the document, the tokens (via globals.css) and nothing else. No font
 * downloads — the two faces this app uses are the system sans and the system
 * mono declared in `globals.css`, which means the shell paints on the first
 * frame with no FOUT and no network round trip on courthouse wifi.
 *
 * It also does NOT render the Shell. Auth lives one level down: `/sign-in/` and
 * the fail-closed "no firm access" screen must be able to render a bare page,
 * and a Shell here would put a firm's name above a screen belonging to nobody.
 * Signed-in screens wrap themselves in `<Shell firmName={…}>`.
 */

export const metadata: Metadata = {
  title: {
    default: "Docket — Lectual",
    template: "%s · Docket",
  },
  description: "Deadlines, matters and calendar for Cabanis Law.",
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
    <html lang="en">
      <body className="min-h-dvh bg-surface-2 text-ink antialiased">{children}</body>
    </html>
  );
}
