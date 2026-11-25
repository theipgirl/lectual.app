// Single-entry zip writer on Node built-ins only (raw deflate + a table-based
// CRC-32), so there is no new dependency and no reliance on a newer zlib.crc32.

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** A zip holding one deflated entry. `entryName` must already be ASCII-safe. */
export function createZip(entryName: string, data: Uint8Array, modified: Date = new Date()): Buffer {
  const name = Buffer.from(entryName, 'ascii');
  const raw = Buffer.from(data);
  const compressed = deflateRawSync(raw);
  const crc = crc32(raw);
  const { time, date } = dosDateTime(modified);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  // extra, comment, disk, internal/external attrs: zero. Local header offset: 0.

  const localSize = local.length + name.length + compressed.length;
  const centralSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // entries total
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localSize, 16);

  return Buffer.concat([local, name, compressed, central, name, eocd]);
}

/** ASCII-only, no path separators, quotes or control characters; falls back to "mark". */
export function safeFileStem(mark: string): string {
  const stem = String(mark)
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 60)
    .replace(/[_-]+$/g, '');
  return stem || 'mark';
}

export interface UsptoZip {
  filename: string;
  entryName: string;
  data: Buffer;
}

/** `<Mark>_USPTO_first500.csv.zip` holding `<Mark>_USPTO_first500.csv`. */
export function buildUsptoZip(mark: string, csv: string): UsptoZip {
  const entryName = `${safeFileStem(mark)}_USPTO_first500.csv`;
  return { filename: `${entryName}.zip`, entryName, data: createZip(entryName, Buffer.from(csv, 'utf8')) };
}
