import { describe, expect, it } from 'vitest';
import {
  AMOUNT_REMOVED,
  PACKAGE_NAME_REMOVED,
  PRICE_SENTENCE_REMOVED,
  isPriceSentence,
  makeScrubber,
  scrubCurrency,
  scrubPackageNames,
  scrubPriceSentences,
  splitSentences,
} from '@/lib/consult-prep/judge/scrub';

const NAMES = ['Essential', 'Enhanced', 'Concierge'];

describe('scrubCurrency', () => {
  describe('removes $ amounts, USD amounts, N dollars and number-word dollars', () => {
    const cases = [
      // $ forms
      '$1,950',
      '$1950',
      '$1950.00',
      '$ 1,950.00',
      'US$1,950',
      '$1.95k',
      '$2K',
      '$2,000.00',
      '$1,500',
      // USD forms
      'USD 1,950',
      'USD1950',
      'USD 1950.00',
      '1,950 USD',
      '1950.00 usd',
      'usd 2,000',
      'USD 2,000',
      // bare k-suffixed amounts
      '1.95k',
      '2k',
      '2K',
      // N dollars / bucks
      '1500 dollars',
      '1,950.00 dollars',
      '1,950 bucks',
      // spelled out
      'one thousand nine hundred fifty dollars',
      'nineteen hundred and fifty dollars',
      'two thousand dollars',
      'three hundred fifty dollars',
      'twenty-five hundred bucks',
      'fifteen hundred dollars',
      // the sign after the number
      '1950$',
      '1,950$',
      '1950 $',
      '1950€',
      '1,950.00$',
      // ISO codes and other currency words, before or after
      '1950 EUR',
      'EUR 1950',
      '1,950 GBP',
      'GBP 1,950',
      'CAD 1950',
      '1950 cad',
      '€1.950',
      '1950 euros',
      '1950 pounds',
      // "grand" after number words, digits or a vague quantity
      'two grand',
      '2 grand',
      'a couple grand',
      'a couple of grand',
      'a few grand',
      'twenty-five grand',
      // full-width and small-form signs and digits (NFKC-folded first)
      '＄1950',
      '$１９５０',
      '＄１，９５０',
      '１９５０＄',
      '﹩1950',
      // space-grouped thousands lose the WHOLE amount
      '1 950 dollars',
      '$1 950',
      '1 950 USD',
      // a dollar / a few bucks
      'a few bucks',
      // a qualifier between the amount and the currency word (fix attempt 3)
      '1950 US dollars',
      '1950 U.S. dollars',
      'fifteen hundred US dollars',
      '1950 Canadian dollars',
      '1950 American dollars',
      '1,950 Australian dollars',
      '1950 New Zealand dollars',
      '1950 Hong Kong dollars',
      '1950 Singapore dollars',
      '1950 USA dollars',
      '1950 CAD dollars',
      'two thousand Canadian dollars',
      // hyphenated compound amounts
      '1950-dollar',
      '1,950-dollar',
      '1950 - dollar',
      'nineteen-fifty-dollar',
      'fifteen-hundred-dollar',
      '1950-US-dollar',
      // punctuated ISO codes
      'USD: 1950',
      'USD:1950',
      '1950 (USD)',
      '1950 (CAD)',
      // tidy: no stray code or sign
      'USD$1950',
      '1,950 USD$',
    ];
    for (const c of cases) {
      it(`"${c}" -> [amount removed]`, () => {
        const r = scrubCurrency(`The fee is ${c} today.`);
        expect(r.text).toBe(`The fee is ${AMOUNT_REMOVED} today.`);
        expect(r.removed).toBe(1);
      });
    }

    it('a qualifier goes with the amount, leaving no stray "US" or "Canadian"', () => {
      for (const c of ['1950 US dollars', '1950 U.S. dollars', 'fifteen hundred US dollars', '1950 Canadian dollars']) {
        const r = scrubCurrency(`Quote ${c} now.`);
        expect(r.text).toBe(`Quote ${AMOUNT_REMOVED} now.`);
        expect(r.text).not.toMatch(/\bUS\b|U\.S\.|Canadian|\d/);
      }
    });

    it('hyphenated compound amounts keep the noun they modify', () => {
      expect(scrubCurrency('a 1950-dollar fee').text).toBe(`a ${AMOUNT_REMOVED} fee`);
      expect(scrubCurrency('nineteen-fifty-dollar fee').text).toBe(`${AMOUNT_REMOVED} fee`);
      expect(scrubCurrency('a 1,950-dollar retainer').text).toBe(`a ${AMOUNT_REMOVED} retainer`);
    });

    it('punctuated ISO codes lose their digits', () => {
      expect(scrubCurrency('USD: 1950').text).toBe(AMOUNT_REMOVED);
      expect(scrubCurrency('1950 (USD)').text).toBe(AMOUNT_REMOVED);
      expect(scrubCurrency('Total (USD 1950) due').text).not.toMatch(/\d/);
    });

    it('replaces the whole spelled-out phrase, never leaving a stray number word', () => {
      const r = scrubCurrency('Budget: one thousand nine hundred fifty dollars, or nineteen hundred and fifty dollars.');
      expect(r.text).toBe(`Budget: ${AMOUNT_REMOVED}, or ${AMOUNT_REMOVED}.`);
      expect(r.text).not.toMatch(/thousand|hundred|nineteen|fifty/i);
    });

    it('a false positive on a bare k number is visible, not silent', () => {
      expect(scrubCurrency('She has 10k followers').text).toBe(`She has ${AMOUNT_REMOVED} followers`);
    });

    it('counts every removal', () => {
      expect(scrubCurrency('$1,500 and 1500 dollars and USD 2,000 and two thousand dollars').removed).toBe(4);
    });
  });

  it('"1 950 dollars" leaves no stray digit behind', () => {
    const r = scrubCurrency('Roughly 1 950 dollars.');
    expect(r.text).toBe(`Roughly ${AMOUNT_REMOVED}.`);
    expect(r.text).not.toMatch(/\d/);
  });

  it('a mixed sentence loses every amount and keeps its non-price numbers', () => {
    const r = scrubCurrency('ESSENTIAL at 1950$ (two grand), or ＄3,250 for 3 classes in Class 41.');
    expect(r.text).toBe(`ESSENTIAL at ${AMOUNT_REMOVED} (${AMOUNT_REMOVED}), or ${AMOUNT_REMOVED} for 3 classes in Class 41.`);
    expect(r.text).not.toMatch(/\$|grand|1950/);
  });

  it('"grand" with no number before it is ordinary English', () => {
    for (const s of ['the grand opening in Atlanta', 'a grand jury subpoena', 'the grand total is open']) {
      expect(scrubCurrency(s)).toEqual({ text: s, removed: 0 });
    }
  });

  it('text with no amount comes back exactly as written (no NFKC rewrite)', () => {
    const s = 'CONCIERGE™ for the LegacyCon® brand… “quoted” ﬁne, Class 41';
    expect(scrubCurrency(s)).toEqual({ text: s, removed: 0 });
  });

  it('™ survives folding, so the package scrubber still sees CONCIERGE™', () => {
    const gen = makeScrubber(true, NAMES);
    const out = gen.scrub('CONCIERGE™ at ＄5,500');
    expect(out).not.toMatch(/CONCIERGE|\$|5,500/);
    expect(gen.counts).toEqual({ currency: 1, priceSentences: 0, packageNames: 1 });
  });

  it('a qualifier with no currency word after it is left alone', () => {
    for (const t of ['US 2026 expansion', 'Canadian classes 41', 'a US 500-store rollout', 'Hong Kong 2027 launch']) {
      expect(scrubCurrency(t)).toEqual({ text: t, removed: 0 });
    }
  });

  it('leaves non-currency numbers (class 41, 2026, 3 classes)', () => {
    const s =
      'Class 41 and IC 041 in 2026; 3 classes; first 500 attached; 10,000 cap; expires October 28, 2026; 8 to 18 months; ' +
      'Classes 41, 35: 989; serial 97 123 456; 2 marks; a grand opening; one mark in two classes.';
    const r = scrubCurrency(s);
    expect(r.text).toBe(s);
    expect(r.removed).toBe(0);
  });
});

describe('scrubPackageNames', () => {
  it('package names removed on non-filing paths, lower-case essential kept', () => {
    const r = scrubPackageNames(
      'Consider the Enhanced package or ESSENTIAL; the Concierge tier, an essential package, Enhanced review. Bring the essential documents.',
      NAMES,
    );
    expect(r.text).not.toMatch(/enhanced|concierge|essential package/i);
    expect(r.text).not.toMatch(/\bESSENTIAL\b|\bEssential\b/);
    expect(r.text).toContain('essential documents');
    expect(r.text).toContain(PACKAGE_NAME_REMOVED);
    expect(r.removed).toBeGreaterThanOrEqual(5);
  });

  it("uses the firm's own names, not a fixed set (any firm, any spelling)", () => {
    const names = ['Starter', 'Premier Plus', 'C++ Pro'];
    const r = scrubPackageNames('Offer the Premier   Plus package, or STARTER, or the starter plan; C++ Pro too. Starters are fine.', names);
    expect(r.text).not.toMatch(/premier|starter plan|C\+\+ Pro/i);
    expect(r.text).toContain('Starters are fine');
    // Another firm's names are not this firm's.
    expect(scrubPackageNames('Enhanced and Concierge', names)).toEqual({ text: 'Enhanced and Concierge', removed: 0 });
    expect(scrubPackageNames('Enhanced', [])).toEqual({ text: 'Enhanced', removed: 0 });
  });

  it('tier enum names in ALL CAPS are removed', () => {
    const r = scrubPackageNames('ESSENTIAL / ENHANCED / CONCIERGE™', NAMES);
    expect(r.text).not.toMatch(/ESSENTIAL|ENHANCED|CONCIERGE/);
  });
});

describe('makeScrubber', () => {
  it('scrubs currency always and package names only on non-filing paths, with counts', () => {
    const tm = makeScrubber(false);
    expect(tm.scrub('Enhanced at $3,250')).toBe(`Enhanced at ${AMOUNT_REMOVED}`);
    expect(tm.counts).toEqual({ currency: 1, priceSentences: 0, packageNames: 0 });
    const gen = makeScrubber(true, NAMES);
    expect(gen.scrub('Enhanced package at $3,250')).toBe(`${PACKAGE_NAME_REMOVED} at ${AMOUNT_REMOVED}`);
    expect(gen.counts).toEqual({ currency: 1, priceSentences: 0, packageNames: 1 });
  });
});

// ------------------------------------------------------------ sentence backstop

/** The non-price corpus: every string must pass through the FULL brief scrubber unchanged. */
const NON_PRICE = [
  'Class 41 and IC 041 in 2026.',
  'Expires October 28, 2026.',
  'First 500 attached.',
  'There are 10,000 marks in the register.',
  'Serial 97 123 456 is live.',
  'Serial 97123456 and Reg. No. 6,123,456 are live.',
  'Classes 41, 35: 989.',
  'A grand opening in Atlanta.',
  'US 2026 expansion is planned.',
  'Canadian classes 41 and 35 are not in scope.',
  'One mark in two classes; 3 classes; 2 marks.',
  'Section 2(d) risk is moderate; 8 to 18 months to registration.',
  'The call is at 9:00 AM on October 28, 2026.',
  'She runs 4.5-star workshops for 200 attendees.',
  'Ask whether the conference has run since 2019. Confirm the 14 days left on the response.',
  'CONCIERGE™ for the LegacyCon® brand, Class 41.',
];

describe('scrubPriceSentences (backstop)', () => {
  it('replaces a whole sentence that holds a currency marker and a number, and keeps the others', () => {
    const r = scrubPriceSentences('The client runs a conference. The fee of 1950 was quoted. Ask about Class 41.');
    expect(r.text).toBe(`The client runs a conference. ${PRICE_SENTENCE_REMOVED} Ask about Class 41.`);
    expect(r.removed).toBe(1);
  });

  it('list items are units too', () => {
    const r = scrubPriceSentences('Docs:\n- the signed contract\n- invoice for 1950\n- the logo file');
    expect(r.text).toBe(`Docs:\n- the signed contract\n- ${PRICE_SENTENCE_REMOVED}\n- the logo file`);
  });

  it('"U.S." does not split a sentence into a number half and a currency half', () => {
    expect(splitSentences('It is 1950 U.S. dollars total.')).toEqual(['It is 1950 U.S. dollars total.']);
    expect(scrubPriceSentences('It is 1950 U.S. dollars total.').text).toBe(PRICE_SENTENCE_REMOVED);
  });

  it('split pieces join back to the original text exactly', () => {
    const t = 'One. Two!  "Three?" (Four.)\nFive\n\n- six; e.g. seven. Mr. Eight.';
    expect(splitSentences(t).join('')).toBe(t);
  });

  it('leaves text with no price sentence exactly as written', () => {
    for (const s of NON_PRICE) expect(scrubPriceSentences(s)).toEqual({ text: s, removed: 0 });
  });

  it('"fee" with a number is removed on purpose (the package line carries fees from config)', () => {
    expect(isPriceSentence('Ask whether the 2 classes fit the fee.')).toBe(true);
    expect(isPriceSentence('Ask what the client expects to pay in fees.')).toBe(false);
  });

  it('every bypass from both evaluation rounds, and the former acceptable misses that name money, are gone', () => {
    const forms = [
      // round 2 bypasses
      '1950 US dollars', 'fifteen hundred US dollars', '1950 Canadian dollars', 'a 1950-dollar fee',
      'nineteen-fifty-dollar fee', '1950 (USD)', 'USD: 1950',
      // round 1 bypasses
      '1950$', '1,950$', '1950 $', '1950€', '1,950.00$', '1950 EUR', 'EUR 1950', 'GBP 1,950', 'CAD1950',
      'two grand', '2 grand', 'a couple grand', '＄１９５０', '１９５０ dollars', '1 950 dollars',
      // former acceptable misses where a currency marker and a number both appear
      'fee of 1950', '1950 in fees', 'hundreds of dollars', '1950 smackers', 'Rs 1950', 'Rs. 1950/-',
      'a retainer of nineteen fifty', 'the price is twelve-fifty', 'a payment of two thousand',
      'cost: 1950', 'invoice #1950', 'rate 1950/hr', 'twenty pounds sterling', 'USD$1950', '1,950 USD$',
    ];
    for (const f of forms) {
      const gen = makeScrubber(true, NAMES);
      const out = gen.scrub(`Note that ${f} came up.`);
      expect(out, f).not.toMatch(/\d|１|nineteen|fifty|thousand|hundred|twelve|twenty/i);
      expect(gen.counts.currency + gen.counts.priceSentences, f).toBeGreaterThan(0);
    }
  });

  it('property: {qualifier} x {number form} x {separator} x {currency form} is always removed', () => {
    const qualifiers = ['', 'US ', 'U.S. ', 'USA ', 'American ', 'Canadian ', 'Australian ', 'New Zealand ', 'Hong Kong ', 'Singapore ', 'CAD ', 'AUD '];
    // A second amount in the same sentence, after the token-scrubbed one (round 3's leak).
    const suffixes = ['', ' to 2,000', ' or 2100', ' plus 350 per class', ' (or 3,075 after the credit)', '/1950'];
    const numbers = ['1950', '1,950', '1,950.00', '1 950', '1.95k', '2K', '１９５０', 'nineteen fifty', 'nineteen-fifty', 'one thousand nine hundred fifty', 'two thousand', 'fifteen hundred'];
    const currencies = ['dollars', 'dollar', 'bucks', 'euros', 'pounds sterling', 'quid', 'grand', 'cents', 'USD', 'EUR', 'GBP', '$', '€', '£', '¥', '₹', 'fee', 'retainer', 'payment', 'price', 'cost', 'rate', 'invoice'];
    const separators: Array<(n: string, q: string, c: string) => string> = [
      (n, q, c) => `${n} ${q}${c}`,
      (n, q, c) => `${n}-${q.trim() ? q.trim() + '-' : ''}${c}`,
      (n, q, c) => `${q}${c}: ${n}`,
      (n, q, c) => `${n} (${q}${c})`,
      (n, q, c) => `${q}${c} (${n})`,
      // glued, as in "USD1950" / "$1950" (digit forms only; "dollarsnineteen" is not English)
      (n, q, c) => (/^[\d０-９]/.test(n) ? `${q}${c}${n}` : `${q}${c} ${n}`),
    ];
    let checked = 0;
    for (const q of qualifiers)
      for (const n of numbers)
        for (const c of currencies)
          for (const sep of separators)
            for (const suffix of suffixes) {
            const phrase = sep(n, q, c) + suffix;
            const s = makeScrubber(false);
            const out = s.scrub(`The client said ${phrase} on the call. Ask about Class 41.`);
            // The amount is gone, and the unrelated sentence survives as written.
            expect(out.endsWith(' Ask about Class 41.'), phrase).toBe(true);
            const head = out.slice(0, -' Ask about Class 41.'.length);
            expect(head, phrase).not.toMatch(/[\d０-９]|nineteen|fifteen|fifty|thousand|hundred|two/i);
            checked++;
          }
    expect(checked).toBe(qualifiers.length * numbers.length * currencies.length * separators.length * suffixes.length);
  }, 180_000);

  it('non-price corpus is unchanged through the full scrubber on every path', () => {
    for (const nonFiling of [false, true]) {
      const s = makeScrubber(nonFiling, NAMES);
      for (const t of NON_PRICE) {
        if (nonFiling && /CONCIERGE/.test(t)) continue; // package names go on non-filing paths by design
        expect(s.scrub(t), t).toBe(t);
      }
      expect(s.counts.currency + s.counts.priceSentences).toBe(0);
    }
  });

  it('a second amount beside a token-scrubbed one: the whole sentence goes (round 3 F1)', () => {
    const inputs = [
      'Quote $1,500 to 2,000 for both classes.',
      'Quote $1,500–2,000 for both classes.',
      'Quote $1,500-2,000 for both classes.',
      'Quote $1,500 - 2,000 for both classes.',
      'Somewhere between $1,500 and 2,000.',
      'Expect $1,950 plus 350 per class.',
      'Expect 1,950 dollars plus 350 per class.',
      'Quote $3,250 (or 3,075 after the credit).',
      'Quote USD 1950 or 2100.',
      'Two classes at $350 each, so 700.',
      'Quote €1950/1950.',
      'They pay $ 1 9 5 0.',
      'Quote 1950 francs or 2100.',
      'Quote 1950 yuan, maybe 2100.',
      'It costs a grand.',
    ];
    for (const input of inputs) {
      for (const nonFiling of [false, true]) {
        const s = makeScrubber(nonFiling, NAMES);
        const out = s.scrub(`${input} Ask about Class 41.`);
        expect(out, input).toBe(`${PRICE_SENTENCE_REMOVED} Ask about Class 41.`);
        expect(s.counts.priceSentences, input).toBe(1);
      }
    }
  });

  it('a sentence whose only number was the token keeps its visible [amount removed]', () => {
    const s = makeScrubber(false);
    expect(s.scrub('Mr. Paul paid 1950 dollars.')).toBe(`Mr. Paul paid ${AMOUNT_REMOVED}.`);
    expect(s.counts).toEqual({ currency: 1, priceSentences: 0, packageNames: 0 });
    expect(makeScrubber(false).scrub('It costs a couple of grand.')).toBe(`It costs ${AMOUNT_REMOVED}.`);
  });

  it('price-ness is judged per sentence: a neighbouring sentence with a number survives', () => {
    const s = makeScrubber(false);
    expect(s.scrub('Quote $1,500 to 2,000. Ask about Class 41 and the 2026 launch.')).toBe(
      `${PRICE_SENTENCE_REMOVED} Ask about Class 41 and the 2026 launch.`,
    );
    // "$\n1950" is still tokenised as one amount across the line break.
    expect(makeScrubber(false).scrub('$\n1950')).toBe(AMOUNT_REMOVED);
  });

  it('rarer currencies count after a number; "a yen for", "a grand opening", "won" stay English', () => {
    for (const f of ['1950 francs', '1950 yuan', '1950 yen', '1950 rupees', '1950 pesos', '1950 lira']) {
      expect(scrubCurrency(f).text, f).toBe(AMOUNT_REMOVED);
    }
    for (const t of ['She has a yen for travel.', 'A grand opening in Atlanta.', 'She won 3 awards in 2024.']) {
      expect(makeScrubber(false).scrub(t), t).toBe(t);
    }
  });

  it('counts backstop removals separately from token removals', () => {
    const s = makeScrubber(false);
    expect(s.scrub('A 1950 Canadian dollar fee. Then a fee of 1950.')).toBe(`A ${AMOUNT_REMOVED} fee. ${PRICE_SENTENCE_REMOVED}`);
    expect(s.counts).toEqual({ currency: 1, priceSentences: 1, packageNames: 0 });
  });
});

describe('line breaks inside model prose (Sprint 5)', () => {
  it('a single line break does not split a price: "Quote $1,500\\nor 2,000" is replaced whole', () => {
    const s = makeScrubber(false);
    expect(s.scrub('Quote $1,500\nor 2,000')).toBe(PRICE_SENTENCE_REMOVED);
    expect(s.scrub('Quote $1,500\nor 2,000')).not.toContain('2,000');
  });

  it('"Fee:\\n1950" is one unit and is replaced whole', () => {
    expect(makeScrubber(false).scrub('Fee:\n1950')).toBe(PRICE_SENTENCE_REMOVED);
    expect(scrubPriceSentences('Fee:\n1950').text).toBe(PRICE_SENTENCE_REMOVED);
    expect(splitSentences('Fee:\n1950')).toEqual(['Fee:\n1950']);
  });

  it('a blank line still starts a new unit: only the price paragraph goes', () => {
    // The token is the unit's only number, so it keeps its visible "[amount removed]".
    expect(makeScrubber(false).scrub('Line one.\n\nPrice is $5.')).toBe(`Line one.\n\nPrice is ${AMOUNT_REMOVED}.`);
    expect(makeScrubber(false).scrub('Line one.\n\nPrice is $5 or 6.')).toBe(`Line one.\n\n${PRICE_SENTENCE_REMOVED}`);
  });

  it('a list item still starts a new unit: only the priced item goes', () => {
    expect(makeScrubber(false).scrub('- a $5 item\n- a clean item')).toBe(`- a ${AMOUNT_REMOVED} item\n- a clean item`);
    expect(makeScrubber(false).scrub('- a $5 or 6 item\n- a clean item')).toBe(`- ${PRICE_SENTENCE_REMOVED}\n- a clean item`);
    expect(splitSentences('Steps:\n1. file\n2) pay 1950')).toEqual(['Steps:', '\n', '1. file', '\n', '2) pay 1950']);
    expect(splitSentences('a\n* b\n• c\n– d')).toEqual(['a', '\n', '* b', '\n', '• c', '\n', '– d']);
  });

  it('a soft line break after a sentence end still ends the sentence, like a space', () => {
    expect(splitSentences('The fee is 1950.\nAsk about Class 41.')).toEqual(['The fee is 1950.', '\n', 'Ask about Class 41.']);
    expect(makeScrubber(false).scrub('The fee is 1950.\nAsk about Class 41.')).toBe(`${PRICE_SENTENCE_REMOVED}\nAsk about Class 41.`);
  });

  it('keeps original whitespace in text it does not replace', () => {
    const t = 'Runs a conference\n  in Atlanta.\nClean line two';
    expect(makeScrubber(false).scrub(t)).toBe(t);
    expect(splitSentences(t).join('')).toBe(t);
  });
});

