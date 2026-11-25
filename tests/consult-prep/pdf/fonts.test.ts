import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FACE_KEYS, FONT_DIR_SEGMENTS, FONT_FILES, fontDir, loadFonts, resetFontCache } from '@/lib/consult-prep/pdf/fonts';

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network is not allowed in packages PDF tests');
  });
  resetFontCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function isTrueType(bytes: Uint8Array): boolean {
  const magic = Buffer.from(bytes.subarray(0, 4));
  return magic.equals(Buffer.from([0, 1, 0, 0])) || magic.toString('latin1') === 'true';
}

describe('brand fonts', () => {
  it('the nine TTF files are on disk and each starts with the TrueType magic', () => {
    const names = Object.values(FONT_FILES).sort();
    expect(names).toEqual(
      [
        'PlayfairDisplay-500Italic.ttf',
        'PlayfairDisplay-600.ttf',
        'PlayfairDisplay-700.ttf',
        'SourceSerif4-400.ttf',
        'SourceSerif4-400Italic.ttf',
        'SourceSerif4-600.ttf',
        'SourceSerif4-600Italic.ttf',
        'SourceSerif4-700.ttf',
        'SourceSerif4-700Italic.ttf',
      ].sort(),
    );
    const dir = fontDir();
    const onDisk = readdirSync(dir).filter((f) => f.endsWith('.ttf')).sort();
    expect(onDisk).toEqual(names);
    for (const n of names) expect(isTrueType(readFileSync(path.join(dir, n))), n).toBe(true);
    // The README and the OFL travel with them.
    expect(existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'OFL.txt'))).toBe(true);
  });

  it('loadFonts returns bytes for all nine faces and caches them per process', async () => {
    const a = await loadFonts();
    expect(Object.keys(a).sort()).toEqual([...FACE_KEYS].sort());
    for (const k of FACE_KEYS) {
      expect(a[k].byteLength, k).toBeGreaterThan(10_000);
      expect(isTrueType(a[k]), k).toBe(true);
    }
    expect(await loadFonts()).toBe(a);
  });

  it('a failed read is reported and not cached', async () => {
    await expect(loadFonts('/nonexistent/fonts')).rejects.toThrow();
    expect(Object.keys(await loadFonts())).toHaveLength(9);
  });

  it('next.config.ts traces the font directory into the routes that build the PDF', () => {
    const src = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
    const dirGlob = `./${FONT_DIR_SEGMENTS.slice(0, -2).join('/')}/assets/**/*`;
    expect(src).toContain(`const PACKAGES_PDF_ASSETS = "${dirGlob}"`);
    for (const route of ['/api/cron/agents', '/api/cron/lawmatics-matters', '/dashboard/leads/*']) {
      expect(src).toContain(`"${route}": [PACKAGES_PDF_ASSETS]`);
      const dir = route.replace('/*', '').split('/').filter(Boolean);
      const base = path.join(process.cwd(), 'src', 'app', ...dir);
      expect(existsSync(base), route).toBe(true);
    }
    // The glob really covers the directory the loader reads.
    const rel = path.relative(process.cwd(), fontDir()).split(path.sep).join('/');
    expect(rel.startsWith(dirGlob.slice(2, -'/**/*'.length))).toBe(true);
  });

  it('loading the module reads nothing (fonts load lazily on first render)', async () => {
    vi.resetModules();
    const readFile = vi.fn();
    vi.doMock('node:fs/promises', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      readFile,
    }));
    await import('@/lib/consult-prep/pdf/fonts');
    await import('@/lib/consult-prep/pdf/render');
    expect(readFile).not.toHaveBeenCalled();
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});
