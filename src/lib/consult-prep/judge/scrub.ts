// Scrubbers for model-written prose in the pre-consult brief.
//
// The model is told never to write a price; this is the backstop that makes
// "never" true. scrubCurrency runs on EVERY string the model writes (prose,
// flags, questions, package reasoning, PDF categories) before it is escaped
// and rendered. Each match becomes the literal "[amount removed]", so an edit
// is visible, never silent, and the count goes into the diagnostics.
//
// Verbatim client text (the inquiry and intake fields shown in the heads-up)
// and USPTO registry data are NOT scrubbed: the model never writes them, and
// they are reported as the client or the registry wrote them.
//
// scrubPriceSentences is the structural backstop behind the token patterns:
// any sentence (or list item) that still holds BOTH a currency marker and a
// number is replaced whole. The token patterns tidy the common forms; the
// backstop is what makes an unlisted phrasing ("1950 Canadian dollars", "a
// 1950-dollar fee", "USD: 1950") impossible to slip through, without
// enumerating it. makeScrubber runs both, token patterns first, but judges each
// sentence on its ORIGINAL text, so a token removal that also took the currency
// marker ("$1,500 to 2,000") cannot hide the amounts left beside it. It is applied
// ONLY to model-written strings: the price lines built from the firm config,
// the complimentary-consult line, the verbatim intake quote and the USPTO
// section never pass through it.
//
// scrubPackageNames runs on the general and dispute paths, where no trademark
// package applies and none may be named. The names are the FIRM'S OWN list
// (passed in), not a fixed set.
//
// PORTED from lawmatics-mcp src/consult-brief/scrub.ts (see PORTED_FROM.md).

export const AMOUNT_REMOVED = '[amount removed]';
export const PACKAGE_NAME_REMOVED = '[package name removed — not a filing matter]';
export const PRICE_SENTENCE_REMOVED = '[pricing detail removed — see the config-based package line]';

export type ScrubResult = { text: string; removed: number };

// A number: 1,950 / 1,950.00 / 1950 / 1950.00 / 1.95 / 1 950 (space-grouped) / 1.950 (dot-grouped)
const NUM = String.raw`\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
// Magnitude suffix after a number: k, K, m, M, thousand, million, bn
const MAG = String.raw`(?:\s?(?:k|m|bn|thousand|million|billion)\b)?`;
// Any currency sign: $ ¢ £ ¤ ¥ and the whole Currency Symbols block (€ ₹ ₩ …).
const SYM = String.raw`[$¢-¥₠-⃏]`;
// ISO 4217 codes a price might carry.
const ISO = String.raw`(?:USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|CNY|RMB|INR|MXN|SGD|HKD|SEK|NOK|DKK|ZAR|BRL|KRW)`;
// Currency words. "grand" counts only after a number (see the patterns below).
const MONEY_WORD = String.raw`(?:usd|dollars?|bucks|euros?|pounds?(?:\s+sterling)?|quid|cents?)\b`;
// Rarer currencies count only after a number ("1950 francs"): "a yen for" stays English.
const CURRENCY_WORD = String.raw`(?:${MONEY_WORD}|(?:francs?|yuan|renminbi|yen|rupees?|pesos?|lira|lire|rupiah)\b|grand\b)`;
// A nationality/ISO qualifier between an amount and its currency word: "1950 US dollars",
// "1950 U.S. dollars", "fifteen hundred Canadian dollars". It only fires when a currency
// word follows, so "US 2026 expansion" and "Canadian classes 41" are left alone.
const QUAL = String.raw`(?:U\.S\.A\.|U\.S\.|USA|US|American|Canadian|Australian|New\s+Zealand|Hong\s+Kong|Singapore(?:an)?|${ISO})`;
// Between the amount and the currency word: a space, nothing, or a hyphen ("1950-dollar fee"),
// then an optional qualifier.
const TO_WORD = String.raw`(?:\s*-\s*|\s*)(?:${QUAL}(?:\s*-\s*|\s+))?`;

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'thousand', 'million', 'billion', 'hundreds', 'thousands', 'millions', 'billions',
].join('|');
const WORD = `(?:${NUMBER_WORDS})`;
// "a couple", "a few", "couple of": a vague quantity that still names a price before "grand"/"dollars".
const VAGUE = String.raw`(?:a\s+)?(?:couple|few)(?:\s+of)?`;

const PATTERNS: RegExp[] = [
  // $1,950  $1950.00  $ 1,950.00  US$1,950  $1.95k  $2K  €1.950  (and a trailing "USD"/"dollars"/"EUR")
  // (a leading ISO code goes too: "USD$1950")
  new RegExp(String.raw`(?:\b(?:US|${ISO})\s?)?${SYM}\s?(?:${NUM})${MAG}(?:\s?(?:${CURRENCY_WORD}|${ISO}\b))?`, 'gi'),
  // The sign after the number: 1950$  1,950$  1950 $  1950€
  new RegExp(String.raw`(?<![\w.,])(?:${NUM})${MAG}\s?${SYM}`, 'gi'),
  // ISO code first: USD 1,950  USD1950  EUR 1950  GBP 1,950.00  USD: 1950  (USD 1950
  new RegExp(String.raw`\b${ISO}[\s:(]*(?:${NUM})${MAG}`, 'gi'),
  // Number then a currency word or ISO code: 1,950 USD  1950 EUR  1500 dollars  1 950 dollars
  // 1,950 bucks  2 grand  1.5 thousand dollars  1950 US dollars  1950 Canadian dollars
  // 1950-dollar  1950 (USD)  1,950 USD$
  new RegExp(
    String.raw`(?<![\w.,])(?:${NUM})${MAG}(?:${TO_WORD}${CURRENCY_WORD}|\s*\(?${ISO}\b\)?)(?:\s?${SYM})?`,
    'gi',
  ),
  // Spelled out: "one thousand nine hundred fifty dollars", "nineteen hundred and fifty
  // dollars", "twenty-five hundred bucks", "two grand", "a couple grand",
  // "fifteen hundred US dollars", "nineteen-fifty-dollar". The WHOLE phrase goes.
  new RegExp(String.raw`\b(?:${VAGUE}|${WORD})(?:(?:[\s-]+and)?[\s-]+${WORD})*(?:\s*-\s*|\s+)(?:${QUAL}(?:\s*-\s*|\s+))?${CURRENCY_WORD}`, 'gi'),
  // "a dollar", "a few bucks" without a number word ("a grand" alone is left: "a grand opening").
  new RegExp(String.raw`\ban?\s+${MONEY_WORD}`, 'gi'),
  // Bare k-suffixed amounts standing alone: "1.95k", "2k", "2K". "10k followers"
  // also goes; a visible false positive beats a price slipping through.
  new RegExp(String.raw`(?<![\w.,$])\d+(?:\.\d+)?\s?k\b`, 'gi'),
];

/**
 * Fold look-alike characters (full-width "＄１９５０", small "﹩", non-breaking
 * spaces) to their plain forms with NFKC so they match the patterns above.
 * ™ ® © ℠ are kept as they are: NFKC would turn ™ into the letters "TM" and
 * glue them onto a package name ("CONCIERGETM"), hiding it from the package scrubber.
 */
export function foldForScrub(text: string): string {
  return text
    .split(/([™®©℠])/)
    .map((part, i) => (i % 2 ? part : part.normalize('NFKC')))
    .join('');
}

function replaceAll(text: string, patterns: RegExp[], replacement: string): ScrubResult {
  let removed = 0;
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, () => {
      removed++;
      return replacement;
    });
  }
  return { text: out, removed };
}

/** Replace every currency amount with "[amount removed]". */
export function scrubCurrency(text: string): ScrubResult {
  const r = replaceAll(foldForScrub(text), PATTERNS, AMOUNT_REMOVED);
  // Nothing removed: hand back the model's text exactly as written.
  return r.removed ? r : { text, removed: 0 };
}

// ---------------------------------------------------------------- sentence backstop

// (a) A currency marker: any currency symbol (Unicode Sc, checked after NFKC), an
// ISO 4217 code as an upper-case whole word, or a money word.
const SC = /\p{Sc}/u;
const ISO_WORD = new RegExp(
  String.raw`(?<![A-Za-z])(?:${ISO}|ILS|PLN|AED|THB|IDR|MYR|TWD|CZK|HUF|ARS|CLP|COP|PEN|NGN|KES|EGP|SAR|QAR|Rs\.?)(?![A-Za-z])`,
);
const MONEY_MARKER = new RegExp(
  String.raw`(?<![a-z])(?:usd|dollars?|bucks?|cents?|euros?|pounds?\s+sterling|quid|grand|rupees?|yen|pesos?|smackers|francs?|yuan|renminbi|lira|lire|rupiah|` +
    String.raw`fees?|pric(?:e|es|ed|ing)|costs?|costing|rates?|retainers?|invoices?|invoiced|payments?)(?![a-z])`,
  'i',
);
// (b) A number: any digit (NFKC folds full-width digits), or a spelled-out number word.
const NUMBER_MARKER = new RegExp(
  String.raw`\d|(?<![a-z])(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|` +
    String.raw`sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|` +
    String.raw`hundreds?|thousands?|millions?|billions?|` +
    // "a grand" / "a couple of grand" is a number too, unless a word follows ("a grand opening").
    String.raw`a\s+(?:couple\s+(?:of\s+)?|few\s+)?grand(?!\s*[a-z]))(?![a-z])`,
  'i',
);

const hasNumber = (s: string): boolean => NUMBER_MARKER.test(foldForScrub(s));
const hasCurrencyMarker = (s: string): boolean => {
  const f = foldForScrub(s);
  return SC.test(f) || ISO_WORD.test(f) || MONEY_MARKER.test(f);
};

/** True when a sentence names money AND a number: a price, however it is spelled. */
export function isPriceSentence(sentence: string): boolean {
  return hasNumber(sentence) && hasCurrencyMarker(sentence);
}

// Letter boundaries rather than \b, so a number glued on ("dollars1950", "fee1950")
// still leaves the word recognisable.
// Words whose trailing period does not end a sentence. Splitting there would cut
// "1950 U.S. dollars" into a number half and a currency half.
const ABBREVIATIONS = new Set([
  'no', 'nos', 'rs', 'reg', 'ser', 'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'approx', 'inc', 'llc', 'co', 'corp',
  'ltd', 'jr', 'sr', 'cf', 'fig', 'sec', 'ch', 'para', 'pp', 'ca', 'est', 'dept', 'misc', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

function endsWithAbbreviation(before: string): boolean {
  const token = before.match(/(\S+)$/)?.[1] ?? '';
  const word = token.replace(/^[("'“‘[]+/, '');
  // Initials and dotted abbreviations: "U.S", "e.g", "i.e", "J".
  if (/^(?:[A-Za-z]\.)*[A-Za-z]$/.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

// A line that opens a list item: "- ", "* ", "• ", "– ", "1. ", "1) ".
const LIST_ITEM_START = /^(?:[-*•–]|\d+[.)])[^\S\n]/;

/**
 * Split prose into sentences and list items, keeping every separator so the
 * pieces join back to the original text exactly. Even indexes are sentences,
 * odd indexes are the separators between them.
 *
 * A line break starts a new unit only when it is a blank line or the next line
 * opens a list item. A single line break inside prose is just whitespace: it
 * ends a sentence only where a space would ("Fee.\nNext" splits, "Fee:\n1950"
 * and "Quote $1,500\nor 2,000" stay one unit), so a price cannot hide its
 * currency marker and its number on two adjacent lines.
 */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /\s*(?:\r?\n)+\s*|(?<=[.!?…])["'”’)\]]*\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // The boundary sits after closing quotes/brackets; look at what precedes them.
    const closers = m[0].match(/^["'”’)\]]*/)?.[0] ?? '';
    const newlines = (m[0].match(/\n/g) ?? []).length;
    const hardBreak = newlines >= 2 || (newlines === 1 && LIST_ITEM_START.test(text.slice(m.index + m[0].length)));
    if (!hardBreak) {
      const before = text.slice(start, m.index);
      const lastChar = before.slice(-1);
      // A soft line break with no sentence end before it: same unit.
      if (!closers && !/[.!?…]/.test(lastChar)) continue;
      if (lastChar === '.' && !closers && endsWithAbbreviation(before.slice(0, -1))) continue;
      // "1. file": the number of a numbered list item, not a sentence.
      if (lastChar === '.' && !closers && /^\d+\.$/.test(before)) continue;
    }
    // Keep the closing quotes/brackets with their sentence.
    parts.push(text.slice(start, m.index + closers.length), m[0].slice(closers.length));
    start = m.index + m[0].length;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Replace each sentence (or list item) the predicate marks with PRICE_SENTENCE_REMOVED. */
function replaceSentences(text: string, isPrice: (sentence: string) => boolean): { parts: string[]; removed: number } {
  const parts = splitSentences(text);
  let removed = 0;
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] && isPrice(parts[i])) {
      // Keep a leading list marker ("- ", "• ") so the list still reads as a list.
      const bullet = parts[i].match(/^\s*(?:[-*•–]\s+)/)?.[0] ?? '';
      parts[i] = `${bullet}${PRICE_SENTENCE_REMOVED}`;
      removed++;
    }
  }
  return { parts, removed };
}

/**
 * The backstop on its own: replace every sentence (or list item) that holds both
 * a currency marker and a number with PRICE_SENTENCE_REMOVED. Model-written
 * strings only. makeScrubber combines it with the token patterns.
 */
export function scrubPriceSentences(text: string): ScrubResult {
  const { parts, removed } = replaceSentences(text, isPriceSentence);
  return removed ? { text: parts.join(''), removed } : { text, removed: 0 };
}

// ------------------------------------------------------- tokens + backstop, together

// While the token patterns run, each match is held as a private-use slot
// (START, its index in private-use digits, END) instead of "[amount removed]", so
// the backstop can still see the sentence as the model wrote it.
const SLOT_START = '\uE000';
const SLOT_END = '\uE001';
const SLOT_DIGIT0 = 0xe010;
const SLOT_RE = /\uE000([\uE010-\uE019]+)\uE001/g;
const PRIVATE_SLOT_CHARS = /[\uE000-\uE019]/g;

function slotFor(index: number): string {
  const digits = String(index)
    .split('')
    .map((d) => String.fromCharCode(SLOT_DIGIT0 + Number(d)))
    .join('');
  return `${SLOT_START}${digits}${SLOT_END}`;
}

function slotIndex(digits: string): number {
  return Number(
    digits
      .split('')
      .map((c) => c.charCodeAt(0) - SLOT_DIGIT0)
      .join(''),
  );
}

/**
 * Token patterns first, then the sentence backstop, deciding price-ness on the
 * ORIGINAL sentence. A sentence is replaced whole when, after its tokens are
 * removed, it still holds a number AND either the original sentence named money
 * or a token was removed from it. That is what stops "Quote $1,500 to 2,000":
 * the token pass eats "$1,500" (and with it the only currency marker), but the
 * sentence had one, and "2,000" is still there. A sentence whose only number
 * WAS the token ("Mr. Paul paid 1950 dollars.") keeps its visible
 * "[amount removed]".
 */
function scrubModelText(text: string): { text: string; currency: number; priceSentences: number } {
  const folded = foldForScrub(text).replace(PRIVATE_SLOT_CHARS, '');
  const originals: string[] = [];
  const marked = PATTERNS.reduce(
    (out, re) =>
      out.replace(re, (m) => {
        originals.push(m);
        return slotFor(originals.length - 1);
      }),
    folded,
  );
  // No token removed: decide on the model's text exactly as written.
  const base = originals.length ? marked : text;
  const restore = (s: string, to: (original: string) => string): string =>
    s.replace(SLOT_RE, (_m, digits: string) => to(originals[slotIndex(digits)] ?? ''));
  const { parts, removed: priceSentences } = replaceSentences(base, (sentence) => {
    const tokenised = restore(sentence, () => AMOUNT_REMOVED);
    if (!hasNumber(tokenised)) return false;
    const hadToken = tokenised !== sentence;
    return hadToken || hasCurrencyMarker(restore(sentence, (o) => o));
  });
  if (!originals.length && !priceSentences) return { text, currency: 0, priceSentences: 0 };
  const out = restore(parts.join(''), () => AMOUNT_REMOVED);
  return { text: out, currency: originals.length, priceSentences };
}

/** Escape a firm's package name for a regular expression. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The patterns that find THIS firm's package names. The names come from the firm's own list (never a fixed set), longest first
 * so "Enhanced Plus" goes whole before "Enhanced". Two forms: any case when followed by package / tier / plan ("essential package"),
 * and the name as the firm wrote it, or in ALL CAPS, as a whole word ("Enhanced", "CONCIERGE™"). A name in lower case with no such
 * word after it ("essential documents") is ordinary English and stays.
 */
function packagePatterns(names: readonly string[]): RegExp[] {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  if (clean.length === 0) return [];
  const patterns: RegExp[] = [];
  for (const n of clean) {
    const e = escapeRe(n).replace(/\s+/g, String.raw`\s+`);
    patterns.push(new RegExp(String.raw`(?<![\p{L}\p{N}])${e}™?\s+(?:packages?|tiers?|plans?)(?![\p{L}\p{N}])`, "giu"));
  }
  for (const n of clean) {
    const e = escapeRe(n).replace(/\s+/g, String.raw`\s+`);
    const upper = escapeRe(n.toUpperCase()).replace(/\s+/g, String.raw`\s+`);
    patterns.push(new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${e}|${upper})(?![\p{L}\p{N}])™?`, "gu"));
  }
  return patterns;
}

/** Remove the firm's trademark package names (general and dispute paths only). */
export function scrubPackageNames(text: string, names: readonly string[]): ScrubResult {
  return replaceAll(text, packagePatterns(names), PACKAGE_NAME_REMOVED);
}

/** Running totals for the diagnostics. */
export type ScrubCounts = { currency: number; priceSentences: number; packageNames: number };

/**
 * A scrubber bound to one brief, for MODEL-WRITTEN strings only: scrubs
 * currency tokens, then replaces any sentence that named money (as written, or
 * through a removed token) and still holds a number (the backstop), then
 * package names when `nonFiling`, counting what it removed.
 */
export function makeScrubber(nonFiling: boolean, packageNames: readonly string[] = []): { scrub: (s: string) => string; counts: ScrubCounts } {
  const counts: ScrubCounts = { currency: 0, priceSentences: 0, packageNames: 0 };
  const scrub = (s: string): string => {
    const b = scrubModelText(s);
    counts.currency += b.currency;
    counts.priceSentences += b.priceSentences;
    if (!nonFiling) return b.text;
    const p = scrubPackageNames(b.text, packageNames);
    counts.packageNames += p.removed;
    return p.text;
  };
  return { scrub, counts };
}
