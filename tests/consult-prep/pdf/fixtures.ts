// Inputs for the packages PDF tests and the visual fixture check. Not imported by any route.

import type { ProposalPricing } from '@/lib/proposals/types';
import { RPB_PACKAGES_ART } from '@/lib/consult-prep/pdf/art';
import type { PackagesFirm, PackagesSpecInput } from '@/lib/consult-prep/pdf/spec';

/** RPB's three packages as `normalisePackages` returns them (cents). */
export const RPB_PACKAGES: ProposalPricing[] = [
  { package: 'Essential', base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: 'Enhanced', base_cents: 325_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: 'Concierge', base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];

/** A firm with art: RPB's table, wordmark and footer. */
export const RPB_FIRM: PackagesFirm = {
  name: 'RPB Law Firm, PLLC',
  timeZone: 'America/New_York',
  packages: RPB_PACKAGES,
  art: RPB_PACKAGES_ART,
};

/** A firm with NO art: names and prices that appear nowhere in RPB's copy. */
export const HARBOR_PACKAGES: ProposalPricing[] = [
  { package: 'Starter', base_cents: 120_000, included_classes: 1, per_class_cents: 50_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 },
  { package: 'Standard', base_cents: 210_050, included_classes: 2, per_class_cents: 45_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 },
];
export const HARBOR_FIRM: PackagesFirm = {
  name: 'Harbor IP Counsel',
  timeZone: 'America/Chicago',
  packages: HARBOR_PACKAGES,
  expiryDays: 10,
  art: null,
};

/** The reference PDF's inputs: Ms. Kenasha Paul / Black Professionals Network / LegacyCon. */
export const LEGACYCON_INPUT: PackagesSpecInput = {
  client: 'Kenasha Paul',
  clientPrefix: 'Ms.',
  company: 'Black Professionals Network',
  // 2pm ET, Oct 20 2026.
  consultStart: '2026-10-20T18:00:00Z',
  marks: [
    {
      name: 'LegacyCon',
      categories: [
        { text: 'Conferences, summits and professional-development events', priority: true },
        { text: 'Business networking events', priority: false },
      ],
    },
  ],
};

const LONG_CATEGORY =
  'Educational and entertainment services, namely, organizing, arranging and conducting conferences, summits, ' +
  'workshops, seminars and professional-development events in the fields of business, entrepreneurship, ' +
  'leadership and wealth building; providing online non-downloadable materials in those fields';

/** Stress inputs rendered by the fixture case with PACKAGES_FIXTURE_STRESS=1. */
export const STRESS_INPUTS: Record<string, PackagesSpecInput> = {
  'three-marks-long-text': {
    client: 'Ana-Lucía O’Connor-Bénéteau',
    clientPrefix: 'Dr.',
    company: 'Café & Co. "Holdings" <LLC>',
    consultStart: '2026-10-20T15:00:00Z',
    marks: [
      {
        name: 'Café Lumière',
        categories: [
          { text: LONG_CATEGORY, priority: true },
          { text: 'Supercalifragilisticexpialidociousnessesxx in one unbroken token', priority: false },
          { text: 'Coffee, tea and pastries', priority: false },
        ],
      },
      {
        name: 'Second Mark With A Rather Long Name',
        categories: [
          { text: 'Restaurant and café services', priority: false },
          { text: 'Retail store services featuring coffee', priority: false },
        ],
      },
      {
        name: '“Quoted” & 🚀 东京',
        categories: [
          { text: 'Downloadable mobile apps for ordering 🚀 東京', priority: true },
          { text: 'Clothing, namely, t-shirts', priority: true },
        ],
      },
    ],
  },
  'six-categories': {
    client: 'Kenasha Paul',
    company: 'Black Professionals Network',
    consultStart: '2026-10-20T18:00:00Z',
    marks: [
      {
        name: 'LegacyCon',
        categories: [
          { text: 'Conferences, summits and professional-development events', priority: true },
          { text: 'Business networking events', priority: false },
          { text: 'Downloadable podcasts and webinars', priority: false },
          { text: 'Clothing, namely, t-shirts and hats', priority: false },
          { text: 'Printed programs and books', priority: false },
          { text: 'Online social networking services', priority: false },
        ],
      },
    ],
  },
  'no-priority-two-marks': {
    client: 'Kenasha Paul',
    company: 'Black Professionals Network',
    consultStart: '2026-10-20T18:00:00Z',
    marks: [
      { name: 'LegacyCon', categories: [{ text: 'Business networking events' }] },
      { name: 'Legacy Summit', categories: [{ text: 'Conferences' }, { text: 'Podcasts' }] },
    ],
  },
};
