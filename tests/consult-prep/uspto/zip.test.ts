import { describe, expect, it } from 'vitest';
import * as zlib from 'node:zlib';
import { buildUsptoZip, crc32, createZip, safeFileStem } from '@/lib/consult-prep/uspto/zip';

function parse(z: Buffer) {
  const nameLen = z.readUInt16LE(26);
  const extraLen = z.readUInt16LE(28);
  const csize = z.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  return {
    sig: z.readUInt32LE(0),
    method: z.readUInt16LE(8),
    crc: z.readUInt32LE(14),
    csize,
    usize: z.readUInt32LE(22),
    name: z.subarray(30, 30 + nameLen).toString('ascii'),
    inflated: zlib.inflateRawSync(z.subarray(start, start + csize)),
  };
}

describe('zip writer', () => {
  it('starts with the local file header signature 0x04034b50', () => {
    expect(createZip('a.csv', Buffer.from('x')).readUInt32LE(0)).toBe(0x04034b50);
  });

  it('round-trips: inflating the entry returns the original CSV', () => {
    const csv = 'tier,serial\r\n1-near-identical,123\r\n— unicode ✓\r\n';
    const z = buildUsptoZip('LegacyCon', csv);
    const p = parse(z.data);
    expect(p.name).toBe('LegacyCon_USPTO_first500.csv');
    expect(p.method).toBe(8);
    expect(p.inflated.toString('utf8')).toBe(csv);
  });

  it('stores a CRC-32 equal to an independently computed CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const data = Buffer.from('some,csv\r\nrows,here\r\n'.repeat(50));
    expect(crc32(data)).toBe(zlib.crc32 ? zlib.crc32(data) : crc32(data));
    expect(parse(createZip('a.csv', data)).crc).toBe(crc32(data));
  });

  it('stores correct compressed and uncompressed sizes in local header and central directory', () => {
    const data = Buffer.from('abc,def\r\n'.repeat(500));
    const z = createZip('a.csv', data);
    const p = parse(z);
    expect(p.usize).toBe(data.length);
    expect(p.csize).toBe(zlib.deflateRawSync(data).length);
    const cd = z.length - 22 - (46 + 5);
    expect(z.readUInt32LE(cd)).toBe(0x02014b50);
    expect(z.readUInt32LE(cd + 16)).toBe(p.crc);
    expect(z.readUInt32LE(cd + 20)).toBe(p.csize);
    expect(z.readUInt32LE(cd + 24)).toBe(p.usize);
  });

  it('ends with a valid end-of-central-directory record with one entry', () => {
    const z = createZip('a.csv', Buffer.from('hello'));
    const e = z.length - 22;
    expect(z.readUInt32LE(e)).toBe(0x06054b50);
    expect(z.readUInt16LE(e + 8)).toBe(1);
    expect(z.readUInt16LE(e + 10)).toBe(1);
    expect(z.readUInt32LE(e + 12)).toBe(46 + 5);
    expect(z.readUInt32LE(e + 16)).toBe(e - 46 - 5);
    expect(z.readUInt16LE(e + 20)).toBe(0);
    expect(z.readUInt32LE(e - 46 - 5)).toBe(0x02014b50);
  });

  it('handles an empty and a multi-megabyte buffer', () => {
    const empty = parse(createZip('e.csv', Buffer.alloc(0)));
    expect(empty.usize).toBe(0);
    expect(empty.inflated.length).toBe(0);
    const big = Buffer.alloc(5 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 8)) & 0xff;
    const p = parse(createZip('big.csv', big));
    expect(p.usize).toBe(big.length);
    expect(p.crc).toBe(crc32(big));
    expect(p.inflated.equals(big)).toBe(true);
  });

  it('is valid for a zero-row CSV (header only)', () => {
    const z = buildUsptoZip('X', 'tier,serial\r\n');
    expect(parse(z.data).inflated.toString()).toBe('tier,serial\r\n');
  });
});

describe('zip names', () => {
  it('names the zip and entry <Mark>_USPTO_first500.csv(.zip)', () => {
    const z = buildUsptoZip('LegacyCon', 'x');
    expect(z.filename).toBe('LegacyCon_USPTO_first500.csv.zip');
    expect(z.entryName).toBe('LegacyCon_USPTO_first500.csv');
  });

  it('makes a hostile mark filename-safe, ASCII only, with a fallback', () => {
    for (const hostile of ['../Le/gacy Con"', 'Café ☃ Bar\u0007', '..\\..\\x', '   ', '"""', '日本語']) {
      const z = buildUsptoZip(hostile, 'x');
      for (const n of [z.filename, z.entryName, parse(z.data).name]) {
        expect(n).toMatch(/^[A-Za-z0-9_.-]+$/);
        expect(n).not.toMatch(/\.\./);
      }
    }
    expect(safeFileStem('../Le/gacy Con"')).toBe('Le_gacy_Con');
    expect(safeFileStem('日本語')).toBe('mark');
    expect(safeFileStem('')).toBe('mark');
  });
});
