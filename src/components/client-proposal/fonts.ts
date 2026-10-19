import { Bodoni_Moda, Source_Serif_4 } from "next/font/google";

/**
 * RPB's two faces for the client proposal page: Bodoni Moda for headings,
 * Source Serif 4 for body text. Instantiated once here (next/font only runs at
 * module scope) and applied by `ProposalDocument` to its own root element, so
 * the same component renders correctly inside the dashboard editor's live
 * preview, where the page layout is not the proposal layout.
 */
export const bodoniModa = Bodoni_Moda({
  variable: "--font-cp-heading",
  subsets: ["latin"],
  display: "swap",
});

export const sourceSerif4 = Source_Serif_4({
  variable: "--font-cp-body",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const RPB_FONT_VARS = [bodoniModa.variable, sourceSerif4.variable].join(" ");
