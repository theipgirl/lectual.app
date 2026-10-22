/**
 * What a matter is called on a list, a card or its header.
 *
 * The tracker import gives a matter without a serial number the number
 * `TM-<owner>-<mark>` (src/lib/matters/tracker-import.ts matterNumberFor), and
 * some imports copied that key into the title as well. A person reads
 * `TM-enisha-smith` as a database key, so a title that is a generated key
 * yields to the mark, then the client. Display only: nothing here is stored.
 */
export type DisplayTitleInput = {
  mark_text: string | null;
  title: string | null;
  owner_name?: string | null;
  matter_number: string;
};

/** Type prefix plus a lowercase slug: TM-enisha-smith, CR-acme-co. A serial key (TM-97123456) counts too. */
const GENERATED_KEY = /^[A-Z]{2,4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SERIAL_KEY = /^[A-Z]{2,4}-\d{6,}$/;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function isGeneratedMatterKey(value: string | null | undefined, matterNumber?: string): boolean {
  const v = clean(value);
  if (!v) return false;
  if (matterNumber && v === matterNumber.trim()) return true;
  return GENERATED_KEY.test(v) || SERIAL_KEY.test(v);
}

export type MatterDisplayTitle = {
  title: string;
  /** The matter number, shown beside the title; null when the title is the number itself. */
  secondary: string | null;
};

export function matterDisplayTitle(matter: DisplayTitleInput): MatterDisplayTitle {
  const number = clean(matter.matter_number);
  const candidates = [clean(matter.mark_text), clean(matter.title)];
  const readable = candidates.find((c) => c && !isGeneratedMatterKey(c, number));
  const client = clean(matter.owner_name);
  // Missing mark and client: keep whatever was stored rather than invent a name.
  const title = readable || (client && !isGeneratedMatterKey(client, number) ? client : "") || candidates.find(Boolean) || number;
  return { title, secondary: title === number ? null : number || null };
}
