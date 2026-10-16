import { Instrument_Serif, Geist, Courier_Prime } from "next/font/google";

/**
 * The three faces of the Lectual design (design/README.md):
 * Instrument Serif for titles, Geist for UI, Courier Prime for labels and
 * numbers. Instantiated once here — next/font only runs at module scope, and a
 * second call elsewhere would be a second font file behind the same variable.
 */
export const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

export const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const FONT_VARS = [instrumentSerif.variable, geist.variable, courierPrime.variable].join(" ");
