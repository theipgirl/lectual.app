/**
 * What changed between two versions of a proposal's content, field by field.
 *
 * Pure and total. The store writes the result into the `edited` event's
 * payload so the version history can say "Rebecca changed Concierge base price
 * from $4,950 to $4,500" without storing whole documents in the event log.
 * Money stays in cents and is tagged with a `format`; formatting is the
 * renderer's job.
 *
 * Items with an id (brand names, marks, classes, adjustments) are matched by id,
 * not by position, so reordering is not a change and adding one is a single
 * "added" row rather than a cascade of shifted fields. Includes rows have no id
 * and are matched by label.
 */

import type { ProposalChange } from "./types";

type Leaf = { label: string; format: ProposalChange["format"]; value: string | number | boolean | null };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function scalar(v: unknown): string | number | boolean | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  return null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function flatten(content: unknown): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  const set = (path: string, label: string, format: Leaf["format"], value: unknown) => {
    out.set(path, { label, format, value: scalar(value) });
  };
  if (!isObj(content)) return out;

  const client = isObj(content.client) ? content.client : {};
  set("client.full_name", "Client name", "text", client.full_name);
  set("client.first_name", "Client first name", "text", client.first_name);
  set("client.company", "Client company", "text", client.company);
  set("greeting", "Greeting", "text", content.greeting);
  set("recommendation", "Recommendation", "text", content.recommendation);
  set("office_action_note", "Office action note", "text", content.office_action_note);

  const p = isObj(content.pricing) ? content.pricing : {};
  const pkg = text(p.package) || "Package";
  set("pricing.package", "Package name", "text", p.package);
  set("pricing.base_cents", `${pkg} base price`, "cents", p.base_cents);
  set("pricing.included_classes", `${pkg} classes included`, "count", p.included_classes);
  set("pricing.per_class_cents", `${pkg} price per class`, "cents", p.per_class_cents);
  set("pricing.second_mark_discount_pct", "Second-mark discount", "pct", p.second_mark_discount_pct);
  set("pricing.gov_per_class_cents", "USPTO fee per class", "cents", p.gov_per_class_cents);

  for (const nm of arr(content.names)) {
    const id = text(nm.id);
    if (!id) continue;
    const base = `names[${id}]`;
    const who = text(nm.name) || id;
    set(base, "Brand name", "text", nm.name);
    set(`${base}.what`, `${who}: what it is`, "text", nm.what);
    set(`${base}.note`, `${who}: note`, "text", nm.note);
    const o = isObj(nm.price_override) ? nm.price_override : {};
    set(`${base}.price_override.base_cents`, `${who}: base price`, "cents", o.base_cents);
    set(`${base}.price_override.per_class_cents`, `${who}: price per class`, "cents", o.per_class_cents);
    for (const m of arr(nm.marks)) {
      const mid = text(m.id);
      if (!mid) continue;
      const mp = `${base}.marks[${mid}]`;
      const mlabel = m.kind === "logo" ? "Logo mark" : "Word mark";
      set(mp, `${who}: mark`, "text", mlabel);
      set(`${mp}.desc`, `${who}: ${mlabel} description`, "text", m.desc);
      set(`${mp}.preselected`, `${who}: ${mlabel} starts ticked`, "bool", m.preselected);
    }
    for (const c of arr(nm.classes)) {
      const cid = text(c.id);
      if (!cid) continue;
      const cp = `${base}.classes[${cid}]`;
      const clabel = text(c.label) || cid;
      set(cp, `${who}: class`, "text", c.label);
      set(`${cp}.preselected`, `${who}: "${clabel}" starts ticked`, "bool", c.preselected);
    }
  }

  for (const a of arr(content.adjustments)) {
    const id = text(a.id);
    if (!id) continue;
    const base = `adjustments[${id}]`;
    const label = text(a.label) || id;
    set(base, "Adjustment", "text", a.label);
    set(`${base}.value`, `${label}`, a.kind === "percent" ? "pct" : "cents", a.value);
  }

  const seen = new Map<string, number>();
  for (const row of arr(content.includes)) {
    const label = text(row.label);
    if (!label) continue;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    const base = `includes[${label}${n > 1 ? `#${n}` : ""}]`;
    set(base, "Included item", "text", label);
    set(`${base}.value`, `${label}: value`, "text", row.value);
    set(`${base}.included`, `${label}: included`, "text", row.included);
    set(`${base}.note`, `${label}: note`, "text", row.note);
  }
  return out;
}

/** Every field-level difference between two content documents, in a stable order. */
export function contentChanges(before: unknown, after: unknown): ProposalChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths: string[] = [...b.keys(), ...[...a.keys()].filter((k) => !b.has(k))];
  const changes: ProposalChange[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    const xv = x?.value ?? null;
    const yv = y?.value ?? null;
    if (xv === yv) continue;
    const leaf = y ?? x;
    if (!leaf) continue;
    changes.push({ path, label: leaf.label, format: leaf.format, before: xv, after: yv });
  }
  return changes;
}

/** The row columns that sit beside `content` and are editable while a proposal is a draft. */
export const EDITABLE_COLUMNS = [
  "content",
  "client_name",
  "client_email",
  "title",
  "expires_on",
  "pay_url",
  "lead_id",
  "matter_id",
] as const;
export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];

/** JSON with object keys sorted: jsonb hands keys back in its own order, so plain stringify would call an untouched document changed. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The editable columns whose value differs between two rows (content compared structurally). */
export function changedColumns(
  before: Partial<Record<EditableColumn, unknown>>,
  after: Partial<Record<EditableColumn, unknown>>,
): EditableColumn[] {
  return EDITABLE_COLUMNS.filter((col) => {
    if (!(col in after)) return false;
    return canonical(before[col] ?? null) !== canonical(after[col] ?? null);
  });
}
