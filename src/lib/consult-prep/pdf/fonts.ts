// Brand fonts for the packages PDF, read from the committed TTFs.
//
// The files live in ./assets/fonts (converted once from the lectual-plugin's
// WOFF2 by scripts/convert-brand-fonts.py, see assets/fonts/README.md). They are
// read from disk relative to process.cwd(), which is the project root both
// locally and in a Vercel function, and next.config.ts traces the directory into
// the routes that build the PDF (the agents and Lawmatics crons, the lead page) so the files are there at runtime.
//
// Nothing is read at import time: the first render loads the bytes and they are
// cached for the life of the process.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The nine static faces, keyed by the role the renderer gives them. */
export const FONT_FILES = Object.freeze({
  playfair600: 'PlayfairDisplay-600.ttf',
  playfair700: 'PlayfairDisplay-700.ttf',
  playfair500Italic: 'PlayfairDisplay-500Italic.ttf',
  serif400: 'SourceSerif4-400.ttf',
  serif600: 'SourceSerif4-600.ttf',
  serif700: 'SourceSerif4-700.ttf',
  serif400Italic: 'SourceSerif4-400Italic.ttf',
  serif600Italic: 'SourceSerif4-600Italic.ttf',
  serif700Italic: 'SourceSerif4-700Italic.ttf',
});

export type FaceKey = keyof typeof FONT_FILES;

export const FACE_KEYS = Object.keys(FONT_FILES) as FaceKey[];

/**
 * The name each face is embedded under. The six-letter tag + "+" is the PDF
 * convention for a subset font (pdffonts reports "sub yes" from it); fixing it
 * rather than letting pdf-lib add a random suffix keeps renders byte-stable.
 */
export const EMBED_NAMES: Readonly<Record<FaceKey, string>> = Object.freeze({
  playfair600: 'LCTPFA+PlayfairDisplay-SemiBold',
  playfair700: 'LCTPFB+PlayfairDisplay-Bold',
  playfair500Italic: 'LCTPFC+PlayfairDisplay-MediumItalic',
  serif400: 'LCTSSA+SourceSerif4-Regular',
  serif600: 'LCTSSB+SourceSerif4-SemiBold',
  serif700: 'LCTSSC+SourceSerif4-Bold',
  serif400Italic: 'LCTSSD+SourceSerif4-Italic',
  serif600Italic: 'LCTSSE+SourceSerif4-SemiBoldItalic',
  serif700Italic: 'LCTSSF+SourceSerif4-BoldItalic',
});

/** Path segments of the font directory, relative to the project root. */
export const FONT_DIR_SEGMENTS = ['src', 'lib', 'consult-prep', 'pdf', 'assets', 'fonts'] as const;

export function fontDir(root: string = process.cwd()): string {
  return path.join(root, ...FONT_DIR_SEGMENTS);
}

let cache: Promise<Record<FaceKey, Uint8Array>> | null = null;

async function readAll(dir: string): Promise<Record<FaceKey, Uint8Array>> {
  const entries = await Promise.all(
    FACE_KEYS.map(async (key) => {
      const bytes = await readFile(path.join(dir, FONT_FILES[key]));
      return [key, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FaceKey, Uint8Array>;
}

/**
 * Bytes of all nine faces, read once per process. A failed read is not cached,
 * so a transient filesystem error doesn't poison later renders.
 */
export function loadFonts(dir?: string): Promise<Record<FaceKey, Uint8Array>> {
  if (dir) return readAll(dir);
  if (!cache) {
    cache = readAll(fontDir()).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

/** Test hook: forget the cached bytes. */
export function resetFontCache(): void {
  cache = null;
}
