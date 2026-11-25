import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPB_PACKAGES_ART, packagesArtForSlug } from '@/lib/consult-prep/pdf/art';
import {
  PACKAGES_SPEC_ERROR_CODES,
  PACKAGES_SPEC_ERROR_REASONS,
  PackagesSpecError,
  buildPackagesSpec,
  eyebrowText,
  formatUsd,
  packagesFilename,
  proposalExpiry,
  type PackageTemplate,
  type PackagesArt,
  type PackagesFirm,
  type PackagesSpec,
  type PackagesSpecInput,
} from '@/lib/consult-prep/pdf/spec';
import { HARBOR_FIRM, HARBOR_PACKAGES, LEGACYCON_INPUT, RPB_FIRM, RPB_PACKAGES } from './fixtures';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const build = (input: PackagesSpecInput, firm: PackagesFirm = RPB_FIRM) => buildPackagesSpec(input, firm);
const TEMPLATE = RPB_PACKAGES_ART.template;

/** Every string in a spec, for "this value appears nowhere" checks. */
function allStrings(spec: PackagesSpec): string {
  return JSON.stringify(spec);
}

function expectSpecError(fn: () => unknown, code: string, field?: string): PackagesSpecError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PackagesSpecError);
    const e = err as PackagesSpecError;
    expect(e.code).toBe(code);
    if (field) expect(e.field).toBe(field);
    return e;
  }
  throw new Error('expected PackagesSpecError');
}

/** RPB's firm with its package list repriced, and a template rewritten to agree. */
function repriced(): PackagesFirm {
  const packages = clone(RPB_PACKAGES);
  packages[0].base_cents = 200_000;
  packages[1].base_cents = 350_000;
  packages[2].base_cents = 550_000;
  for (const p of packages) {
    p.per_class_cents = 90_000;
    p.gov_per_class_cents = 40_000;
  }
  const t = clone(TEMPLATE);
  const usd = (n: number) => `$${(n / 100).toLocaleString('en-US')}`;
  t.packages.tiers.forEach((tier, i) => (tier.price = usd(packages[i].base_cents)));
  for (const row of t.packages.rows) {
    if (row.label === 'YOU PAY') row.cells = packages.map((p) => usd(p.base_cents));
    if (row.label === 'Additional Class Fee') row.cells = packages.map((p) => `${usd(p.per_class_cents)} per class`);
  }
  return { ...RPB_FIRM, packages, art: { ...RPB_PACKAGES_ART, template: t } };
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network is not allowed in packages PDF tests');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPackagesSpec: list-true content', () => {
  it('RPB: the firm list agrees with the art template (tier prices, YOU PAY, class cells)', () => {
    const spec = build(LEGACYCON_INPUT);
    expect(spec.tiers.map((t) => t.price)).toEqual(TEMPLATE.packages.tiers.map((t) => t.price));
    expect(spec.tiers.map((t) => t.name)).toEqual(['ESSENTIAL™', 'ENHANCED™', 'CONCIERGE™']);
    for (const label of ['YOU PAY', 'Classes Included', 'Additional Class Fee']) {
      const built = spec.rows.find((r) => r.label === label)!;
      const tpl = TEMPLATE.packages.rows.find((r) => r.label === label)!;
      expect(built.cells).toEqual(tpl.cells.map((text) => ({ kind: 'text', text })));
    }
    expect(spec.rows).toHaveLength(TEMPLATE.packages.rows.length);
    expect(spec.fees.governmentPerClass).toBe('$350 per class');
    expect(spec.fees.additionalClass).toBe('$825');
  });

  it('a repriced list changes tier headers, YOU PAY, per-class cells and the government fee', () => {
    const spec = build(LEGACYCON_INPUT, repriced());
    expect(spec.tiers.map((t) => t.price)).toEqual(['$2,000', '$3,500', '$5,500']);
    const cells = (label: string) =>
      spec.rows.find((r) => r.label === label)!.cells.map((c) => (c.kind === 'text' ? c.text : c.kind));
    expect(cells('YOU PAY')).toEqual(['$2,000', '$3,500', '$5,500']);
    expect(cells('Additional Class Fee')).toEqual(['$900 per class', '$900 per class', '$900 per class']);
    expect(spec.fees.additionalClass).toBe('$900');
    expect(spec.fees.governmentPerClass).toBe('$400 per class');
    const s = allStrings(spec);
    for (const old of ['1,950', '3,250', '4,950', '$825', '$350 per class']) expect(s).not.toContain(old);
  });

  it('every price and class count is read from the passed-in list', () => {
    const reads = new Set<string>();
    const track = <T extends object>(obj: T, prefix: string): T =>
      new Proxy(obj, {
        get(target, key, recv) {
          const v = Reflect.get(target, key, recv);
          if (typeof key === 'string') {
            const p = prefix ? `${prefix}.${key}` : key;
            reads.add(p.replace(/\.\d+\./, '.#.').replace(/^\d+\./, '#.'));
            if (v && typeof v === 'object') return track(v as object, p);
          }
          return v;
        },
      });
    build(LEGACYCON_INPUT, { ...RPB_FIRM, packages: track(clone(RPB_PACKAGES), '') });
    for (const k of ['package', 'base_cents', 'included_classes', 'per_class_cents', 'gov_per_class_cents']) {
      expect(reads, k).toContain(`#.${k}`);
    }
  });

  it('a firm with no art gets a plain table built only from its list, under its own name', () => {
    const spec = build(LEGACYCON_INPUT, HARBOR_FIRM);
    expect(spec.tiers).toEqual([
      { name: 'STARTER™', price: '$1,200' },
      { name: 'STANDARD™', price: '$2,100.50' },
    ]);
    expect(spec.rows.map((r) => r.label)).toEqual(['Classes Included', 'YOU PAY', 'Additional Class Fee']);
    const cells = (label: string) =>
      spec.rows.find((r) => r.label === label)!.cells.map((c) => (c.kind === 'text' ? c.text : c.kind));
    expect(cells('Classes Included')).toEqual(['1 Class', '2 Classes']);
    expect(cells('Additional Class Fee')).toEqual(['$500 per class', '$450 per class']);
    expect(spec.fees.additionalClass).toBe('$450 to $500');
    expect(spec.fees.governmentPerClass).toBe('$350 per class');
    expect(spec.chrome).toEqual({ wordmark: 'HARBOR IP COUNSEL', established: null, footerBold: 'Harbor IP Counsel', footerRest: '', author: 'Harbor IP Counsel' });
    expect(spec.title).toBe('Ms. Kenasha Paul – Harbor IP Counsel Trademark Proposal');
    const s = allStrings(spec);
    for (const rpb of ['RPB', 'rpblawfirm', 'Miami', 'Essential', 'ESSENTIAL', 'Concierge', '1,950', 'EST 2024']) expect(s).not.toContain(rpb);
  });

  it('the art is looked up by slug: only RPB has one, an unknown slug gets the plain version', () => {
    expect(packagesArtForSlug('rpb-law')).toBe(RPB_PACKAGES_ART);
    expect(packagesArtForSlug('harbor-ip')).toBeNull();
    expect(packagesArtForSlug(null)).toBeNull();
    expect(build(LEGACYCON_INPUT, { ...RPB_FIRM, art: undefined, slug: 'rpb-law' }).chrome.wordmark).toBe('RPB LAW FIRM');
    const plain = build(LEGACYCON_INPUT, { ...RPB_FIRM, art: undefined, slug: 'someone-else' });
    expect(plain.chrome.wordmark).toBe('RPB LAW FIRM, PLLC'); // the name passed in, upper-cased
    expect(plain.chrome.established).toBeNull();
    expect(plain.rows).toHaveLength(3);
  });

  it('the art file carries no price literal beyond its own copy, and spec/render/canvas hold none at all', () => {
    for (const f of ['spec.ts', 'render.ts', 'canvas.ts']) {
      const src = readFileSync(path.join(process.cwd(), 'src/lib/consult-prep/pdf', f), 'utf8');
      expect(src, f).not.toMatch(/1950|3250|4950|825|350/);
    }
  });

  it('refuses a list with no packages and a list too long for the page', () => {
    expectSpecError(() => build(LEGACYCON_INPUT, { ...HARBOR_FIRM, packages: [] }), 'no_packages', 'packages');
    const five = [1, 2, 3, 4, 5].map((i) => ({ ...HARBOR_PACKAGES[0], package: `P${i}` }));
    expectSpecError(() => build(LEGACYCON_INPUT, { ...HARBOR_FIRM, packages: five }), 'too_many_packages', 'packages');
    expectSpecError(() => build(LEGACYCON_INPUT, { ...HARBOR_FIRM, name: ' ' }), 'missing_firm', 'firm.name');
  });

  it('formatUsd prints whole dollars plainly and odd cents with two decimals', () => {
    expect(formatUsd(195_000)).toBe('$1,950');
    expect(formatUsd(210_050)).toBe('$2,100.50');
    expect(formatUsd(0)).toBe('$0');
  });
});

describe('buildPackagesSpec: art/list mismatch is a failure', () => {
  const mutations: [string, (t: PackageTemplate) => void, string][] = [
    ['a tier price', (t) => (t.packages.tiers[1].price = '$3,300'), 'tiers[1].price'],
    ['a tier name', (t) => (t.packages.tiers[0].name = 'BASIC™'), 'tiers[0].name'],
    [
      'a YOU PAY cell',
      (t) => (t.packages.rows.find((r) => r.label === 'YOU PAY')!.cells[2] = '$4,900'),
      'rows["YOU PAY"].cells[2]',
    ],
    [
      'an additional-class cell',
      (t) => (t.packages.rows.find((r) => r.label === 'Additional Class Fee')!.cells[0] = '$800 per class'),
      'rows["Additional Class Fee"].cells[0]',
    ],
    [
      'a class-count cell',
      (t) => (t.packages.rows.find((r) => r.label === 'Classes Included')!.cells[1] = '3 Classes'),
      'rows["Classes Included"].cells[1]',
    ],
    [
      'a missing YOU PAY row',
      (t) => (t.packages.rows = t.packages.rows.filter((r) => r.label !== 'YOU PAY')),
      'rows["YOU PAY"]',
    ],
  ];
  for (const [what, mutate, field] of mutations) {
    it(`throws template_config_mismatch when the template changes ${what}`, () => {
      const t = clone(TEMPLATE);
      mutate(t);
      const art: PackagesArt = { ...RPB_PACKAGES_ART, template: t };
      expectSpecError(() => build(LEGACYCON_INPUT, { ...RPB_FIRM, art }), 'template_config_mismatch', field);
    });
  }

  it('a list price change the art cannot follow throws, and passes with the matching template', () => {
    const packages = clone(RPB_PACKAGES);
    packages[1].base_cents = 340_000;
    expectSpecError(() => build(LEGACYCON_INPUT, { ...RPB_FIRM, packages }), 'template_config_mismatch', 'tiers[1].price');
    const ok = repriced();
    expect(build(LEGACYCON_INPUT, ok).tiers[1].price).toBe('$3,500');
  });

  it('an additional-class fee change in the list alone throws on the template cells', () => {
    const packages = clone(RPB_PACKAGES);
    packages[0].per_class_cents = 85_000;
    expectSpecError(
      () => build(LEGACYCON_INPUT, { ...RPB_FIRM, packages }),
      'template_config_mismatch',
      'rows["Additional Class Fee"].cells[0]',
    );
  });

  it('a list that lacks a package the art names throws on that tier', () => {
    expectSpecError(() => build(LEGACYCON_INPUT, { ...RPB_FIRM, packages: HARBOR_PACKAGES }), 'template_config_mismatch', 'tiers[0].name');
  });

  it('extra packages the art does not name are left off the page', () => {
    const packages = [...clone(RPB_PACKAGES), { ...RPB_PACKAGES[0], package: 'Platinum', base_cents: 900_000 }];
    expect(build(LEGACYCON_INPUT, { ...RPB_FIRM, packages }).tiers).toHaveLength(3);
  });
});

describe('buildPackagesSpec: expiry, date and name', () => {
  it('a consult on Oct 20, 2026 expires "October 28, 2026, 7"', () => {
    const spec = build(LEGACYCON_INPUT);
    expect(spec.expiry).toBe('October 28, 2026, 7');
    expect(spec.expirySentence).toBe(
      'This Trademark Proposal shall expire on October 28, 2026, 7 days from the date of receipt.',
    );
    expect(spec.date).toBe('October 2026');
  });

  it('an 11pm ET Oct 20 consult (Oct 21 in UTC) still expires October 28', () => {
    const spec = build({ ...LEGACYCON_INPUT, consultStart: '2026-10-21T03:00:00Z' });
    expect(spec.expiry).toBe('October 28, 2026, 7');
  });

  it('the firm\'s expiryDays moves the date and the number together', () => {
    const spec = build(LEGACYCON_INPUT, { ...RPB_FIRM, expiryDays: 10 });
    expect(spec.expiry).toBe('October 31, 2026, 10');
    expect(spec.expirySentence).toContain('October 31, 2026, 10 days from the date of receipt.');
  });

  it('counts the consult\'s day in the firm\'s zone, passed in', () => {
    // 11pm Central on Oct 20 is 04:00 UTC on Oct 21: still an Oct 20 consult there, an Oct 21 one in UTC.
    expect(proposalExpiry(new Date('2026-10-21T04:00:00Z'), 'America/Chicago', 7).dateKey).toBe('2026-10-28');
    expect(proposalExpiry(new Date('2026-10-21T04:00:00Z'), 'UTC', 7).dateKey).toBe('2026-10-29');
    expectSpecError(() => proposalExpiry(new Date(), 'Not/AZone', 7), 'invalid_time_zone', 'timeZone');
    expectSpecError(() => build(LEGACYCON_INPUT, { ...RPB_FIRM, expiryDays: 0 }), 'invalid_expiry', 'firm.expiryDays');
    expectSpecError(() => build(LEGACYCON_INPUT, { ...RPB_FIRM, timeZone: 'Not/AZone' }), 'invalid_time_zone', 'timeZone');
    // A year boundary rolls.
    expect(proposalExpiry(new Date('2026-12-28T17:00:00Z'), 'America/New_York', 7).dateLabel).toBe('January 5, 2027');
  });

  it('applies the intake prefix when there is one, and not twice', () => {
    expect(build(LEGACYCON_INPUT).client).toBe('Ms. Kenasha Paul');
    expect(build({ ...LEGACYCON_INPUT, clientPrefix: null }).client).toBe('Kenasha Paul');
    expect(build({ ...LEGACYCON_INPUT, client: 'Ms. Kenasha Paul' }).client).toBe('Ms. Kenasha Paul');
    expect(build(LEGACYCON_INPUT).title).toBe('Ms. Kenasha Paul – RPB Law Trademark Proposal');
  });

  it('shows word marks in capitals and keeps the given name', () => {
    const spec = build(LEGACYCON_INPUT);
    expect(spec.marks[0].name).toBe('LegacyCon');
    expect(spec.marks[0].display).toBe('LEGACYCON');
  });
});

describe('packagesFilename', () => {
  it('names the file <Client>_Packages_<Mark>.pdf', () => {
    expect(build(LEGACYCON_INPUT).filename).toBe('Kenasha_Paul_Packages_LegacyCon.pdf');
  });
  it('makes spaces, slashes, quotes and accents filename-safe', () => {
    expect(packagesFilename('José "Pepe" Núñez/Ortiz', [{ name: 'Café O’Brien\'s / Co.' }])).toBe(
      'Jose_Pepe_Nunez_Ortiz_Packages_Cafe_OBriens_Co.pdf',
    );
    expect(packagesFilename('東京', [{ name: '🚀' }])).toBe('Client_Packages_Marks.pdf');
  });
  it('uses the FIRST mark when there are several', () => {
    const spec = build({
      ...LEGACYCON_INPUT,
      marks: [
        { name: 'LegacyCon', categories: [{ text: 'Events' }] },
        { name: 'Legacy Summit', categories: [{ text: 'Events' }] },
      ],
    });
    expect(spec.filename).toBe('Kenasha_Paul_Packages_LegacyCon.pdf');
  });
});

describe('buildPackagesSpec: class numbers never reach the client PDF', () => {
  const withCategory = (text: string): PackagesSpecInput => ({
    ...LEGACYCON_INPUT,
    marks: [{ name: 'LegacyCon', categories: [{ text }] }],
  });

  for (const text of ['Books (Class 16)', 'IC 041 events', 'Podcasts, Classes 9 and 16']) {
    it(`throws class_number_in_category for "${text}" with a content-free message`, () => {
      let err: unknown;
      try {
        build(withCategory(text));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PackagesSpecError);
      expect((err as PackagesSpecError).code).toBe('class_number_in_category');
      expect((err as PackagesSpecError).message).not.toContain(text);
      expect((err as PackagesSpecError).message).not.toMatch(/\b(?:16|041|9)\b|class(?:es)? \d/i);
    });
  }

  it('does not throw for "Classes included" style text without a number', () => {
    expect(() => build(withCategory('Classes included in the package'))).not.toThrow();
    expect(() => build(withCategory('Classroom training and class reunions'))).not.toThrow();
  });
});

describe('buildPackagesSpec: unfinished input is refused, never drawn', () => {
  const base = LEGACYCON_INPUT;
  const cases: [string, PackagesSpecInput, string, string][] = [
    ['blank client', { ...base, client: '  ' }, 'missing_client', 'client'],
    ['bracketed client', { ...base, client: '[CLIENT NAME]' }, 'placeholder_text', 'client'],
    ['bracketed company', { ...base, company: '[COMPANY]' }, 'placeholder_text', 'company'],
    ['zero marks', { ...base, marks: [] }, 'no_marks', 'marks'],
    ['blank mark name', { ...base, marks: [{ name: ' ', categories: [{ text: 'x' }] }] }, 'missing_mark_name', 'marks[0].name'],
    ['bracketed mark', { ...base, marks: [{ name: '[MARK]', categories: [{ text: 'x' }] }] }, 'placeholder_text', 'marks[0].name'],
    ['a mark with no categories', { ...base, marks: [{ name: 'LegacyCon', categories: [] }] }, 'mark_without_categories', 'marks[0].categories'],
    [
      'a bracketed category',
      { ...base, marks: [{ name: 'LegacyCon', categories: [{ text: '[Other category reviewed]' }] }] },
      'placeholder_text',
      'marks[0].categories[0].text',
    ],
    [
      'a blank category',
      { ...base, marks: [{ name: 'LegacyCon', categories: [{ text: 'ok' }, { text: '' }] }] },
      'empty_category',
      'marks[0].categories[1].text',
    ],
    [
      'four marks',
      { ...base, marks: [1, 2, 3, 4].map((i) => ({ name: `Mark ${i}`, categories: [{ text: 'x' }] })) },
      'too_many_marks',
      'marks',
    ],
    ['an invalid consult date', { ...base, consultStart: 'not a date' }, 'missing_consult_date', 'consultStart'],
  ];
  for (const [what, input, code, field] of cases) {
    it(`throws ${code} for ${what}`, () => {
      expectSpecError(() => build(input), code, field);
    });
  }

  it('error codes come from the exported union and messages carry no input values', () => {
    const secret = {
      client: 'Zelda Quixote',
      company: 'Quixotic Widgets LLC',
      mark: 'ZEPHYRMARK',
      category: 'Secret category text (Class 99)',
    };
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const inputs: PackagesSpecInput[] = [
      { client: secret.client, company: '[x]', consultStart: base.consultStart, marks: [] },
      { client: secret.client, company: secret.company, consultStart: base.consultStart, marks: [] },
      { client: secret.client, company: secret.company, consultStart: base.consultStart, marks: [{ name: secret.mark, categories: [] }] },
      {
        client: secret.client,
        company: secret.company,
        consultStart: base.consultStart,
        marks: [1, 2, 3, 4].map(() => ({ name: secret.mark, categories: [{ text: secret.category }] })),
      },
    ];
    const drifted = clone(RPB_PACKAGES);
    drifted[0].base_cents = 100;
    const errors: PackagesSpecError[] = inputs.map((i) => {
      try {
        build(i);
      } catch (e) {
        return e as PackagesSpecError;
      }
      throw new Error('expected a throw');
    });
    try {
      build(
        { client: secret.client, company: secret.company, consultStart: base.consultStart, marks: [{ name: secret.mark, categories: [{ text: secret.category }] }] },
        { ...RPB_FIRM, packages: drifted },
      );
    } catch (e) {
      errors.push(e as PackagesSpecError);
    }
    expect(errors).toHaveLength(5);
    for (const e of errors) {
      expect(PACKAGES_SPEC_ERROR_CODES).toContain(e.code);
      expect(e.message).toBe(`packages PDF: ${e.code} (${e.field})`);
      for (const v of Object.values(secret)) {
        expect(e.message).not.toContain(v);
        expect(e.field).not.toContain(v);
      }
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('buildPackagesSpec: an absent company drops the segment, never the PDF (Sprint 4 C1)', () => {
  const base = LEGACYCON_INPUT;
  const absent: [string, PackagesSpecInput][] = [
    ['undefined', { ...base, company: undefined }],
    ['null', { ...base, company: null }],
    ['blank', { ...base, company: '' }],
    ['whitespace-only', { ...base, company: '  \t ' }],
    ['"not recorded"', { ...base, company: 'not recorded' }],
    ['"Not Recorded"', { ...base, company: 'Not Recorded' }],
  ];
  for (const [name, input] of absent) {
    it(`${name} company: no throw, company null, two-segment eyebrow`, () => {
      const spec = build(input);
      expect(spec.company).toBeNull();
      expect(eyebrowText(spec)).toBe('Prepared for Ms. Kenasha Paul · October 2026');
      expect(eyebrowText(spec)).not.toContain(' ·  · ');
      expect(eyebrowText(spec)).not.toMatch(/not recorded/i);
    });
  }

  it('a present company keeps the three-segment eyebrow', () => {
    expect(eyebrowText(build(base))).toBe('Prepared for Ms. Kenasha Paul · Black Professionals Network · October 2026');
  });

  it('every error code has a plain-language reason', () => {
    for (const code of PACKAGES_SPEC_ERROR_CODES) expect(PACKAGES_SPEC_ERROR_REASONS[code], code).toMatch(/\w/);
  });

  it('missing_company stays a known code (no brief path produces it for an absent company)', () => {
    expect(PACKAGES_SPEC_ERROR_CODES).toContain('missing_company');
  });
});
