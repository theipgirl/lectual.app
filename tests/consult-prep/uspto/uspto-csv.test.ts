import { describe, expect, it } from 'vitest';
import { USPTO_COLUMNS, writeUsptoCsv } from '@/lib/consult-prep/uspto/uspto-csv';
import { toRow } from '@/lib/consult-prep/uspto/uspto';

const row = (over: Record<string, unknown> = {}) => toRow('1-near-identical', '123', { wordmark: 'ACME', alive: true, ...over });

/** Minimal RFC 4180 parser for the round-trip check. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let rec: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { rec.push(cur); cur = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { rec.push(cur); out.push(rec); rec = []; cur = ''; i++; }
    else cur += ch;
  }
  return out;
}

describe('writeUsptoCsv', () => {
  it('writes the exact header row in order', () => {
    expect(writeUsptoCsv([]).split('\r\n')[0]).toBe('tier,serial,wordmark,status,classes,reg_no,filed,reg_date,basis,owner,goods_services,tsdr');
    expect([...USPTO_COLUMNS]).toHaveLength(12);
  });

  it('uses CRLF line endings and a trailing CRLF', () => {
    const csv = writeUsptoCsv([row(), row({ wordmark: 'B' })]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('quotes fields containing commas', () => {
    expect(writeUsptoCsv([row({ ownerName: ['Acme, Inc.'] })])).toContain('"Acme, Inc."');
  });

  it('quotes fields containing double quotes (doubled)', () => {
    expect(writeUsptoCsv([row({ wordmark: 'THE "BEST"' })])).toContain('"THE ""BEST"""');
  });

  it('quotes fields containing newlines (LF and CRLF)', () => {
    const csv = writeUsptoCsv([row({ goodsAndServices: ['a\nb', 'c\r\nd'] })]);
    expect(csv).toContain('"a\nb | c\r\nd"');
  });

  it('leaves plain fields unquoted', () => {
    const line = writeUsptoCsv([row()]).split('\r\n')[1];
    expect(line.startsWith('1-near-identical,123,ACME,LIVE,')).toBe(true);
    expect(line).not.toContain('"');
  });

  it('round-trips tricky rows through a minimal RFC 4180 parser', () => {
    const rows = [
      row({ wordmark: 'A,B', ownerName: ['Q "Q" Co', 'Second; Owner'], goodsAndServices: ['line1\nline2', 'x,y'] }),
      row({ wordmark: '' }),
    ];
    const parsed = parseCsv(writeUsptoCsv(rows));
    expect(parsed[0]).toEqual([...USPTO_COLUMNS]);
    expect(parsed.slice(1)).toEqual(rows.map((r) => USPTO_COLUMNS.map((c) => r[c])));
  });

  it('emits only the header for zero rows and no BOM', () => {
    const csv = writeUsptoCsv([]);
    expect(csv.split('\r\n')).toEqual([USPTO_COLUMNS.join(','), '']);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});
