// RFC 4180 CSV for the USPTO knockout rows: the script's exact columns,
// Python csv.DictWriter-compatible (QUOTE_MINIMAL, CRLF terminator). UTF-8, no BOM.

import type { UsptoRow } from './uspto';

export const USPTO_COLUMNS = [
  'tier',
  'serial',
  'wordmark',
  'status',
  'classes',
  'reg_no',
  'filed',
  'reg_date',
  'basis',
  'owner',
  'goods_services',
  'tsdr',
] as const satisfies ReadonlyArray<keyof UsptoRow>;

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function writeUsptoCsv(rows: UsptoRow[]): string {
  const lines = [USPTO_COLUMNS.join(',')];
  for (const row of rows) lines.push(USPTO_COLUMNS.map((c) => field(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
