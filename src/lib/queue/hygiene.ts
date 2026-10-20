/**
 * Draft hygiene: what keeps an agent's worksheet text, a stranger's signature
 * and a second copy of the same email out of the approval queue.
 *
 * Pure on purpose: no server imports, no React, no fetch. `createDraft` runs it
 * on the way in, `reviewQueueAction` on the way out, and the client ReviewPanel
 * runs it live on the text in the box, so all three agree on what counts.
 *
 * Model output is untrusted text. Nothing here deletes anything for good: text
 * taken out of a body is returned in `moved`, and the caller keeps it in the
 * queue item's "For the reviewer" summary.
 *
 * Every function is linear in the input and bounded per line, so a very long or
 * hostile body costs milliseconds (tests/queue/hygiene.test.ts times 200,000
 * characters).
 */

// ── Cleaning ────────────────────────────────────────────────────────────────

export type MovedKind = "banner" | "worksheet" | "placeholder";
export type MovedItem = { text: string; kind: MovedKind };

export type CleanOptions = {
  /**
   * Also remove bracketed instructions: [confirm …], [insert …], [verify …],
   * [TODO …], [TBD], [placeholder …]. Default true. createDraft turns it off
   * for everything but a client email, because the Document Center's letters
   * put [confirm from the report] in on purpose, as fill-ins for the attorney.
   */
  placeholders?: boolean;
};

/** Longest line that can be a banner. Longer lines are prose. */
const BANNER_MAX_LENGTH = 300;

/** Markdown and emoji decoration a banner or worksheet line may start with. */
const LEAD = /^[\s>*_#\-–—•|\p{Extended_Pictographic}‍️]+/u;

const BANNER_KEY = /\b(?:not sent|for attorney review)\b/i;

/**
 * A banner is a line made only of banner words, so "⚠️ DRAFT — FOR ATTORNEY
 * REVIEW. NOT SENT." goes but a heading like "Opinion Letter DRAFT — MARKNAME"
 * (no key phrase) or a sentence that merely mentions review stays.
 */
const BANNER_WORDS = new Set(
  (
    "draft drafts for attorney attorneys review reviewer not sent send do don't internal only pending approval human ai generated " +
    "by agent and the this is a an been yet has have awaiting please nothing email message until approved before it be to may must " +
    "should client facing use as of"
  ).split(" "),
);

const WORKSHEET_PATTERNS: RegExp[] = [
  /^hard\s+rule\s*#?\d+/i,
  /^rule\s*#?\d+\s*:/i,
  /^note\s+(?:to|for)\s+(?:the\s+)?(?:reviewer|attorney|approver|rebecca)s?\b/i,
  /^internal(?:\s*\([^)]{0,80}\))?\s*:/i,
  /^reviewer(?:'s)?\s+notes?\s*:/i,
];

const INTERNAL_BLOCK = /^internal(?:\s*\([^)]{0,80}\))?\s*:/i;
const SEPARATOR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** [confirm …], [insert …], [verify …], [TODO …], [placeholder …], [TBD]. Not a Markdown link. */
const INSTRUCTION = /[ \t]*\[(?:(?:confirm|insert|verify|todo|placeholder)\b[^\]\n]{0,200}|tbd)\](?!\()/gi;

function isBanner(core: string): boolean {
  if (core.length > BANNER_MAX_LENGTH || !BANNER_KEY.test(core)) return false;
  const words = core
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => BANNER_WORDS.has(w));
}

function isWorksheet(core: string): boolean {
  return WORKSHEET_PATTERNS.some((p) => p.test(core));
}

/**
 * Removes banner lines, worksheet lines, a trailing "---" + "Internal (…):"
 * paragraph (as a unit) and, optionally, bracketed instructions. A body with
 * nothing to remove comes back as the very same string. Idempotent.
 */
export function cleanDraftBodyDetailed(body: string, options: CleanOptions = {}): { body: string; moved: MovedItem[] } {
  const stripPlaceholders = options.placeholders !== false;
  const lines = body.split("\n");
  const out: string[] = [];
  const moved: MovedItem[] = [];
  let afterRemoval = false;

  const keep = (line: string) => {
    out.push(line);
    afterRemoval = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      // A removal must not leave a double blank line, or a blank line at the top.
      if (afterRemoval && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
      out.push(line);
      continue;
    }

    const core = line.replace(LEAD, "").trim();

    if (isBanner(core)) {
      moved.push({ text: line.trim(), kind: "banner" });
      afterRemoval = true;
      continue;
    }

    if (isWorksheet(core)) {
      // "---" then "Internal (not part of the email): …" is one trailer: the
      // separator and the whole paragraph go together.
      if (INTERNAL_BLOCK.test(core)) {
        let k = out.length - 1;
        while (k >= 0 && out[k].trim() === "") k--;
        if (k >= 0 && SEPARATOR.test(out[k])) {
          out.length = k;
          while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
          const paragraph = [line.trim()];
          while (i + 1 < lines.length && lines[i + 1].trim() !== "") paragraph.push(lines[++i].trim());
          moved.push({ text: paragraph.join(" "), kind: "worksheet" });
          afterRemoval = true;
          continue;
        }
      }
      moved.push({ text: line.trim(), kind: "worksheet" });
      afterRemoval = true;
      continue;
    }

    if (stripPlaceholders && line.includes("[")) {
      let hit = false;
      let next = line.replace(INSTRUCTION, (match) => {
        hit = true;
        moved.push({ text: match.trim(), kind: "placeholder" });
        return "";
      });
      if (hit) {
        if (next.trim() === "") {
          afterRemoval = true;
          continue;
        }
        if (line.trimStart().startsWith("[")) next = next.trimStart();
        keep(next);
        continue;
      }
    }

    keep(line);
  }

  if (moved.length === 0) return { body, moved };
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  const text = out.join("\n");
  return { body: body.endsWith("\n") && text !== "" ? `${text}\n` : text, moved };
}

/** `{ body, moved }` with the removed fragments as plain strings. */
export function cleanDraftBody(body: string, options: CleanOptions = {}): { body: string; moved: string[] } {
  const r = cleanDraftBodyDetailed(body, options);
  return { body: r.body, moved: r.moved.map((m) => m.text) };
}

/** What "Remove internal notes" does to the text in the box. */
export function removeInternalNotes(body: string, type: string): { body: string; moved: string[] } {
  return cleanDraftBody(body, { placeholders: type === "CLIENT_EMAIL" });
}

/** The reviewer-summary block for text that was taken out of a draft. Empty when nothing was. */
export function movedSummary(moved: readonly string[]): string {
  return moved.length === 0 ? "" : `Moved out of the draft:\n${moved.map((m) => `- ${m}`).join("\n")}`;
}

// ── Sign-off ────────────────────────────────────────────────────────────────

const VALEDICTION =
  /^(?:(?:best|warm|kind|warmest)\s+(?:regards|wishes)|all the best|many thanks|thanks again|thank you|thanks|sincerely|yours sincerely|yours truly|regards|respectfully|cordially|warmly|best)\s*[,!.]?$/i;

/** Only the last few lines are ever looked at: a "Thanks," mid-email is not a sign-off. */
const CLOSING_WINDOW = 8;
const SIGNATURE_MAX_LINES = 5;
const SIGNATURE_MAX_LINE_LENGTH = 100;

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

type Closing = { lines: string[]; valIdx: number; start: number; end: number; block: string };

/** The valediction near the end and the signature block under it, or null. */
function locateClosing(body: string): Closing | null {
  const lines = body.split("\n");
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;
  for (let i = last - 1; i >= Math.max(0, last - CLOSING_WINDOW); i--) {
    if (!VALEDICTION.test(lines[i].trim())) continue;
    let start = i + 1;
    while (start < last && lines[start].trim() === "") start++;
    let end = start;
    while (end < last && lines[end].trim() !== "") end++;
    const block = lines.slice(start, end);
    if (block.length > SIGNATURE_MAX_LINES || block.some((l) => l.length > SIGNATURE_MAX_LINE_LENGTH)) return null;
    return { lines, valIdx: i, start, end, block: block.join("\n").trim() };
  }
  return null;
}

/** Same words, or one is the other's leading words ("Rebecca" under "Rebecca P. Beliard, Esq."). */
function matchesSignOff(block: string, configured: string | null | undefined): boolean {
  const b = norm(block);
  const c = norm(configured);
  if (!b || !c) return false;
  return b === c || `${b} `.startsWith(`${c} `) || `${c} `.startsWith(`${b} `);
}

export type SignOffOptions = {
  /** The firm's configured sign-off (crm_org_profile.email_signature). */
  signOff?: string | null;
  /** The firm team sign-off ("The RPB Law Team"), which the proposal email deliberately uses. */
  teamSignOff?: string | null;
};

export type SignOffResult = {
  body: string;
  /** What the closing block said before it was replaced ("" when there was none). */
  replaced: string | null;
  /** A reviewer flag: the sign-off couldn't be verified and was left as written. */
  flag: string | null;
};

/**
 * Makes a client email end in the firm's own sign-off. If the block under the
 * closing ("Best,", "Thanks,", "Sincerely,"…) is neither the configured sign-off
 * nor the team sign-off, it is replaced. With no sign-off configured nothing is
 * rewritten and a reviewer flag comes back. A body with no closing is left alone.
 */
export function enforceSignOff(body: string, options: SignOffOptions = {}): SignOffResult {
  const closing = locateClosing(body);
  if (!closing) return { body, replaced: null, flag: null };

  const { block } = closing;
  const team = norm(options.teamSignOff);
  if (block && (matchesSignOff(block, options.signOff) || (team !== "" && norm(block) === team))) {
    return { body, replaced: null, flag: null };
  }

  const configured = options.signOff?.trim();
  if (!configured) {
    return {
      body,
      replaced: null,
      flag: "Sign-off not checked: this firm has no sign-off set, so who the email is signed by couldn't be verified. Check it before approving.",
    };
  }

  const { lines, valIdx, start, end } = closing;
  const next = block
    ? [...lines.slice(0, start), ...configured.split("\n"), ...lines.slice(end)]
    : [...lines.slice(0, valIdx + 1), ...configured.split("\n"), ...lines.slice(valIdx + 1)];
  return { body: next.join("\n"), replaced: block, flag: null };
}

/** The reviewer-summary line for a sign-off change or flag. Null when there is nothing to say. */
export function signOffSummary(result: SignOffResult): string | null {
  if (result.flag) return result.flag;
  if (result.replaced === null) return null;
  return result.replaced
    ? `Sign-off replaced: the draft was signed "${result.replaced.replace(/\s*\n\s*/g, " / ")}" and now carries the firm's sign-off.`
    : "Sign-off added: the draft had a closing but no name under it.";
}

// ── Near-duplicates ─────────────────────────────────────────────────────────

export const NEAR_DUPLICATE_WINDOW_MS = 30 * 60_000;
export const NEAR_DUPLICATE_SIMILARITY = 0.9;

/** The few fields that decide whether two drafts are the same email. */
export type DraftProbe = {
  type: string;
  recipient?: string | null;
  clientName?: string | null;
  createdAt: number | string | Date;
  body: string;
};

type Prepared = { probe: DraftProbe; at: number; recipient: string; client: string; shingles: () => Set<string> };

function prepare(probe: DraftProbe): Prepared {
  let cache: Set<string> | null = null;
  return {
    probe,
    at: new Date(probe.createdAt).getTime(),
    recipient: (probe.recipient ?? "").trim().toLowerCase(),
    client: (probe.clientName ?? "").trim().toLowerCase(),
    shingles: () => (cache ??= wordShingles(probe.body)),
  };
}

/** Lower-cased words, punctuation and spacing ignored, as a set of word pairs (single words for a one-word body). */
function wordShingles(text: string): Set<string> {
  const words = norm(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length === 1) out.add(words[0]);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function sameDraftPrepared(a: Prepared, b: Prepared): boolean {
  if (a.probe.type !== b.probe.type) return false;
  if (a.recipient || b.recipient) {
    if (a.recipient !== b.recipient) return false;
  } else if (!a.client || a.client !== b.client) {
    return false;
  }
  if (Number.isNaN(a.at) || Number.isNaN(b.at) || Math.abs(a.at - b.at) > NEAR_DUPLICATE_WINDOW_MS) return false;
  return dice(a.shingles(), b.shingles()) >= NEAR_DUPLICATE_SIMILARITY;
}

/**
 * The same type and recipient (or client name, when there is no recipient),
 * created within 30 minutes, with bodies at least 90% alike once case,
 * punctuation and spacing are ignored. Symmetric. Never true on a guess: no
 * recipient and no client name on either side is false.
 */
export function isNearDuplicate(a: DraftProbe, b: DraftProbe): boolean {
  return sameDraftPrepared(prepare(a), prepare(b));
}

type DuplicateCandidate = {
  id: string;
  type: string;
  recipient: string | null;
  client_name: string | null;
  created_at: string;
  draft_body: string;
  final_body: string | null;
  status: string;
};

/** Ids of the NEWER item in every pending near-duplicate pair. Does not reorder or change the input. */
export function markNearDuplicates(items: readonly DuplicateCandidate[]): Set<string> {
  const pending = items
    .filter((i) => i.status === "pending")
    .map((item, index) => ({
      id: item.id,
      index,
      p: prepare({
        type: item.type,
        recipient: item.recipient,
        clientName: item.client_name,
        createdAt: item.created_at,
        body: item.final_body ?? item.draft_body,
      }),
    }))
    .sort((x, y) => x.p.at - y.p.at || x.index - y.index);

  const marked = new Set<string>();
  for (let i = 1; i < pending.length; i++) {
    for (let j = 0; j < i; j++) {
      if (sameDraftPrepared(pending[j].p, pending[i].p)) {
        marked.add(pending[i].id);
        break;
      }
    }
  }
  return marked;
}

// ── Audit ───────────────────────────────────────────────────────────────────

export type AuditLevel = "error" | "warning";
export type AuditCode = "banner" | "worksheet" | "placeholder" | "other-signer" | "unverified-signer" | "signer-unchecked" | "markdown-marks";
export type AuditIssue = { code: AuditCode; level: AuditLevel; message: string };

export type AuditContext = {
  type: string;
  signOff?: string | null;
  teamSignOff?: string | null;
  /** Display names of the firm's members. Null or absent when the directory couldn't be read. */
  memberNames?: readonly string[] | null;
};

const NAME_PLACEHOLDER = /\[(?:your (?:full )?name|(?:client|first|last|full|recipient)(?:'s)? name|name|date|company|firm name)\](?!\()/i;

function hasMarkdownMarks(body: string): boolean {
  if (/\*\*[^*\n]{1,200}\*\*/.test(body) || /`[^`\n]{1,200}`/.test(body)) return true;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (/^#{1,6}\s+\S/.test(t)) return true;
    if (t.length < 500 && t.includes("|") && t.includes("---") && /^[|:\-\s]+$/.test(t)) return true;
  }
  return false;
}

function wordsOf(name: string): string[] {
  return norm(name).split(" ").filter(Boolean);
}

/** The members the closing block names, other than whoever the configured sign-off belongs to. */
function membersNamedIn(block: string, memberNames: readonly string[], signOff: string | null | undefined): string[] {
  const blockWords = new Set(wordsOf(block));
  const signOffWords = new Set(wordsOf(signOff ?? ""));
  const hits: string[] = [];
  for (const name of memberNames) {
    const words = wordsOf(name);
    if (words.length === 0 || words.some((w) => signOffWords.has(w))) continue;
    // The full name, or the first name alone ("Best,\nDawn").
    if (words.every((w) => blockWords.has(w)) || (words[0].length >= 2 && blockWords.has(words[0]))) hits.push(name.trim());
  }
  return hits;
}

/**
 * What is still wrong with a draft body. Errors block an approval, warnings are
 * shown. Only a client email can have errors: a Document Center letter keeps its
 * deliberate [confirm …] fill-ins and is edited in Word, so the same findings
 * are warnings there. Markdown marks and an unchecked signature are always warnings.
 */
export function auditDraft(body: string, ctx: AuditContext): AuditIssue[] {
  const isEmail = ctx.type === "CLIENT_EMAIL";
  const level: AuditLevel = isEmail ? "error" : "warning";
  const issues: AuditIssue[] = [];
  const found = cleanDraftBodyDetailed(body, { placeholders: true }).moved;
  const has = (kind: MovedKind) => found.some((m) => m.kind === kind);

  if (has("banner")) {
    issues.push({ code: "banner", level, message: "The draft still has a banner line such as \"DRAFT\" or \"NOT SENT\". Remove it before this goes anywhere." });
  }
  if (has("worksheet")) {
    issues.push({ code: "worksheet", level, message: "The draft still has internal worksheet text, such as a rule number or a note to the reviewer." });
  }
  if (has("placeholder") || (isEmail && NAME_PLACEHOLDER.test(body))) {
    issues.push({ code: "placeholder", level, message: "The draft still has a bracketed instruction or fill-in, such as [confirm …] or [Your name], that hasn't been resolved." });
  }

  if (isEmail) {
    const closing = locateClosing(body);
    if (closing && !(closing.block && (matchesSignOff(closing.block, ctx.signOff) || (norm(ctx.teamSignOff) !== "" && norm(closing.block) === norm(ctx.teamSignOff))))) {
      const names = ctx.memberNames;
      if (!closing.block) {
        issues.push({ code: "unverified-signer", level: "warning", message: "The email has a closing but no name under it." });
      } else if (!names) {
        issues.push({ code: "signer-unchecked", level: "warning", message: "We couldn't check who signed this, because the firm's sign-off or member list couldn't be read. Check the signature yourself." });
      } else if (!norm(ctx.signOff)) {
        issues.push({ code: "signer-unchecked", level: "warning", message: "This firm has no sign-off set, so who the email is signed by couldn't be verified. Check the signature yourself." });
      } else {
        const other = membersNamedIn(closing.block, names, ctx.signOff);
        issues.push(
          other.length > 0
            ? { code: "other-signer", level: "error", message: `This email is signed by ${other.join(" and ")}, not the firm's sign-off. Change the signature to the firm's sign-off.` }
            : { code: "unverified-signer", level: "warning", message: "The closing isn't the firm's sign-off. Check who it is signed by." },
        );
      }
    }
    if (hasMarkdownMarks(body)) {
      issues.push({
        code: "markdown-marks",
        level: "warning",
        message: "The body has formatting marks (such as ** or #) that may reach the client as plain characters. The Preview above shows them formatted; the email won't.",
      });
    }
  }

  return issues;
}

/** The sentence that refuses an approval, or null when nothing blocks it. */
export function approvalBlock(issues: readonly AuditIssue[]): string | null {
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length === 0) return null;
  return `This draft can't be approved yet. ${errors.map((e) => e.message).join(" ")} Fix it in the draft, then approve again.`;
}
