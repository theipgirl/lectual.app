import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";

/**
 * Renders the Performance tab (and, with `intakeId`, its drawer) with its
 * loaders mocked, so the markup can be compared across a refactor.
 */

export const PERF_FORM: IntakeFormRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "UGW 2026 booth",
  slug: "ugw-2026",
  sourceTag: "UGW 2026",
  kind: "intake",
  status: "live",
  config: defaultIntakeConfig(),
  allowedDomains: [],
  receivesReferrals: false,
  agreementSignedAt: null,
  publishedAt: null,
  everSaved: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

const t = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();

export const PERF_LIST = [
  { id: "22222222-2222-4222-8222-222222222222", mode: "form", contact: { name: "Mireille Toussaint", email: "m@example.com", company: "Toussaint Studio" }, fit: "fit", status: "new", started_at: t(0), submitted_at: t(4), last_active_at: t(4) },
  { id: "33333333-3333-4333-8333-333333333333", mode: "form", contact: { name: "Dana Cole", email: "d@example.com" }, fit: "unscored", status: "new", started_at: t(10), submitted_at: null, last_active_at: t(11) },
];

export const PERF_STAT_ROWS = [
  { form_id: PERF_FORM.id, started_at: t(0), created_at: t(1), submitted_at: t(4), temperature: null },
  { form_id: PERF_FORM.id, started_at: t(10), created_at: t(12), submitted_at: null, temperature: null },
];

export const PERF_DETAIL = {
  ...PERF_LIST[0],
  answers: [{ id: "q1", question: "What name do you want to protect?", answer: "SANKOFA" }],
  screening_note: null,
};

export async function renderPerformance(opts: { intakeId?: string | null; kind?: "intake" | "assessment"; statRows?: unknown[] } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/intake-forms/load-performance", async (orig) => ({
    ...(await orig<typeof import("@/lib/intake-forms/load-performance")>()),
    loadFunnel: vi.fn(async () => ({ status: "ok", value: { visited: 9, chat: 1, form: 2, started: 3, completed: 1, startRate: "33.3%", completeRate: "33.3%", capped: false } })),
    loadIntakeList: vi.fn(async () => ({ status: "ok", value: PERF_LIST })),
    loadIntakeSubmission: vi.fn(async () => ({ status: "ok", value: PERF_DETAIL })),
    loadSubmissionStatRows: vi.fn(async () => ({ status: "ok", value: { rows: opts.statRows ?? PERF_STAT_ROWS, capped: false } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn() }));
  const { IntakePerformance } = await import("../../../src/app/dashboard/forms/_components/IntakePerformance");
  const form = { ...PERF_FORM, kind: opts.kind ?? "intake" };
  return renderToStaticMarkup(await IntakePerformance({ form, range: 30, intakeId: opts.intakeId ?? null, canChangeStatus: true }));
}
