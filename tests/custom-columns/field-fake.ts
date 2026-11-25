import { vi } from "vitest";
import type { FieldDeps, FieldGuard, FieldPatch, FieldRow, LiveField } from "@/lib/custom-columns/field-actions";

/**
 * A recording fake of the field actions' store. Its guarded single-row update is atomic (check every guard, then apply), like one
 * PostgREST UPDATE. `readLiveFields` returns the live rows in the database's order: position, then label in byte (C collation) order,
 * then id; a test may override the order. Invented names only.
 */
export const ORG = "00000000-0000-4000-8000-0000000000aa";
export const fid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type FakeField = FieldRow;
export type Call = { name: string; args: unknown[] };

let clock = 0;
export const stamp = () => `2026-11-20T10:00:${String(clock++ % 60).padStart(2, "0")}.${String(100000 + clock).slice(-6)}+00:00`;

export function field(n: number, over: Partial<FakeField> = {}): FakeField {
  return { id: fid(n), section: "trademarks", kind: "text", label: `Column ${n}`, options: [], position: n, archived: false, updated_at: stamp(), ...over };
}

const byteCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function makeStore(initial: FakeField[], opts: { role?: string | null | (() => Promise<string | null>); use?: Record<string, number>; order?: (live: FakeField[]) => FakeField[] } = {}) {
  const rows: FakeField[] = initial.map((f) => ({ ...f, options: Array.isArray(f.options) ? [...(f.options as string[])] : f.options }));
  const calls: Call[] = [];
  const rec = (name: string, args: unknown[]) => calls.push({ name, args });
  const live = (): LiveField[] => {
    const l = rows.filter((f) => !f.archived);
    const sorted = opts.order ? opts.order(l) : [...l].sort((a, b) => a.position - b.position || byteCmp(a.label, b.label) || byteCmp(a.id, b.id));
    return sorted.map(({ id, section, label, kind, options, position }) => ({ id, section, label, kind, options, position }));
  };
  const given = opts.role;
  let role: () => Promise<string | null>;
  if (typeof given === "function") role = given;
  else {
    const fixed: string | null = given === undefined ? "owner" : given;
    role = async () => fixed;
  }
  const deps = {
    // An owner by the caller's own membership row: the fake's `role` option says what that row holds.
    owner: vi.fn(async () => (await role()) === "owner"),
    orgId: vi.fn(async () => ORG),
    readField: vi.fn(async (id: string) => {
      rec("readField", [id]);
      const f = rows.find((r) => r.id === id);
      return f ? { ...f, options: Array.isArray(f.options) ? [...(f.options as string[])] : f.options } : null;
    }),
    readLiveFields: vi.fn(async () => {
      rec("readLiveFields", []);
      return live();
    }),
    readOptionUse: vi.fn(async (fieldId: string, options: string[]) => {
      rec("readOptionUse", [fieldId, options]);
      return Object.fromEntries(options.map((o) => [o, opts.use?.[o] ?? 0]));
    }),
    insertField: vi.fn(async (row: Record<string, unknown>) => {
      rec("insertField", [row]);
      rows.push({ id: fid(900 + rows.length), section: String(row.section), kind: String(row.kind), label: String(row.label), options: row.options, position: Number(row.position), archived: false, updated_at: stamp() });
    }),
    updateField: vi.fn(async (id: string, patch: FieldPatch, guards: FieldGuard) => {
      rec("updateField", [id, patch, guards]);
      const f = rows.find((r) => r.id === id);
      if (!f) return 0;
      for (const [k, v] of Object.entries(guards)) if ((f as Record<string, unknown>)[k] !== v) return 0;
      Object.assign(f, patch, { updated_at: stamp() });
      return 1;
    }),
    revalidate: vi.fn(),
  } satisfies FieldDeps;
  return { deps, rows, calls, live, writes: () => calls.filter((c) => c.name === "insertField" || c.name === "updateField") };
}
