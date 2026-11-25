// The packages PDF's colours, in one place.
//
// PALETTE is the RPB pre-2026-10-16 brand palette the product spec names for
// this document (lectual-plugin firm/brand/README.md). TINTS are the extra
// shades `render_package_proposal.py`'s CSS uses for text on burgundy, the
// alternate table row, cell dashes and the priority card's border. The renderer
// takes every colour from here and declares none of its own.

import { rgb, type RGB } from 'pdf-lib';

export const PALETTE = Object.freeze({
  burgundy: '#790D24',
  plum: '#3B2226',
  deep: '#4A1622',
  cream: '#FBF5E9',
  card: '#FEF7ED',
  line: '#E7D9C3',
  taupe: '#8C6E68',
  sand: '#F3E2CF',
  gold: '#FAF0DD',
});

export const TINTS = Object.freeze({
  /** Wordmark and footer text on burgundy. */
  onBurgundy: '#F6E7D6',
  /** EST 2024 rules and tier-band labels. */
  onBurgundyRule: '#F3D9B8',
  /** Italic text on burgundy (footer line 2, "+ Government Filing Fees"). */
  onBurgundySoft: '#F0D7B9',
  /** Even table rows. */
  rowAlt: '#FFFBF4',
  /** Plain (non-priority) category box. */
  categoryFill: '#FFFDF8',
  /** Priority category border. */
  priorityBorder: '#E7CFB1',
  /** "—" cells. */
  dash: '#C8B8A6',
});

export type ColorName = keyof typeof PALETTE | keyof typeof TINTS;

/** "#790D24" → pdf-lib RGB. */
export function hexToRgb(hex: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`palette: bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** A named palette/tint colour as pdf-lib RGB. */
export function color(name: ColorName): RGB {
  const hex = (PALETTE as Record<string, string>)[name] ?? (TINTS as Record<string, string>)[name];
  return hexToRgb(hex);
}
