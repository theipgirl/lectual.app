/**
 * The engagement letter's merge fields (lectual 0106 allows exactly these seven).
 *
 * Pure: no database, no server imports, no HTML. The firm's letter is plain text
 * with `{{field}}` markers; this file is the one list of fields and the one
 * place that finds them in a body. The same seven names are enforced again by
 * the database when a version is approved (`client_proposal_loe_template_rules`).
 */

export const LOE_FIELDS = [
  "date",
  "client_name",
  "entity_name",
  "address_block",
  "client_email",
  "signer_name",
  "signed_date",
] as const;

export type LoeField = (typeof LOE_FIELDS)[number];

export type LoeValues = Partial<Record<LoeField, string>>;

export const LOE_MAX_BODY = 60_000;
export const LOE_MAX_TITLE = 200;

/** One `{{ ... }}` marker. A marker never contains a brace. */
const TOKEN = /\{\{([^{}]*)\}\}/g;

export function isLoeField(name: string): name is LoeField {
  return (LOE_FIELDS as readonly string[]).includes(name);
}

export type FoundField = { name: string; allowed: boolean };

/**
 * Every marker in `text`, in order, each with whether it is one of the seven.
 * `unclosed` is true when a `{{` or `}}` is left over once the well-formed markers
 * are taken out ("Dear {{client_name,", "price}} due").
 */
export function findMergeFields(text: string): { fields: FoundField[]; unclosed: boolean } {
  const fields: FoundField[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1].trim();
    fields.push({ name, allowed: isLoeField(name) });
  }
  const unclosed = /(\{\{|\}\})/.test(text.replace(TOKEN, ""));
  return { fields, unclosed };
}

/** Values the Settings preview merges, so a firm sees a whole letter. Plainly made-up people. */
export const SAMPLE_VALUES: Readonly<Record<LoeField, string>> = {
  date: "January 15, 2027",
  client_name: "Alex Sample",
  entity_name: "Sample Goods LLC",
  address_block: "100 Example Street\nSuite 4\nMiami, FL 33101",
  client_email: "alex@example.com",
  signer_name: "Alex Sample",
  signed_date: "January 15, 2027",
};

export { TOKEN as MERGE_TOKEN };
