/**
 * Keys for firm notes the person never types. `crm_firm_brain_entry.key` is required, so the form
 * generates one: `<type>-<slug of the title>-<6 character suffix>`. Stage rules are the exception:
 * their key IS the signal id the Stage Keeper reads, chosen from a list.
 */
const SLUG_MAX = 40;

export function slugOf(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

function suffix(random: () => number): string {
  let out = "";
  while (out.length < 6) out += Math.floor(random() * 36).toString(36);
  return out;
}

/** Lowercase, at most 64 characters, never empty (a title of only symbols reads "note"). */
export function generateEntryKey(type: string, title: string, random: () => number = Math.random): string {
  const base = slugOf(title) || "note";
  return `${slugOf(type) || "note"}-${base}-${suffix(random)}`.slice(0, 64);
}
