import { vi } from "vitest";
import { defaultIntakeConfig, type IntakeFormConfig } from "@/lib/intake-forms/config";
import { DEFAULT_ASSESSMENT, scoreAssessmentAnswers, type AssessmentSettings } from "@/lib/intake-forms/assessment";
import { createFakeDb, type FakeDb, type Row } from "../../matters/helpers/fake-db";

/** Shared fixtures for the Sprint 9 Forms tests: one firm's intakes, people and booth cards in the in-memory scoped client. */

export const ORG = "org-1";
export const OTHER_ORG = "org-2";
export const FORM_ID = "11111111-1111-4111-8111-111111111111";
export const ASSESSMENT_FORM_ID = "44444444-4444-4444-8444-444444444444";
export const FOREIGN_FORM_ID = "99999999-9999-4999-8999-999999999999";

export const QUESTIONS = [
  { id: "q-name", text: "What name do you want to protect?" },
  { id: "q-use", text: "Have you used it publicly?" },
];

export function intakeConfig(): IntakeFormConfig {
  return {
    ...defaultIntakeConfig(),
    questions: QUESTIONS.map((q) => ({ ...q, required: true, pack: null, edited: true })),
  };
}

export function formRow(over: Row = {}): Row {
  return {
    id: FORM_ID,
    org_id: ORG,
    name: "UGW 2026 booth",
    slug: "ugw-2026",
    source_tag: "UGW 2026",
    kind: "intake",
    status: "live",
    config: intakeConfig(),
    allowed_domains: [],
    receives_referrals: false,
    agreement_signed_at: null,
    published_at: null,
    updated_by: "user-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

export function assessmentFormRow(settings: Partial<AssessmentSettings> = {}): Row {
  return formRow({
    id: ASSESSMENT_FORM_ID,
    name: "Booth assessment",
    slug: "booth-assessment",
    kind: "assessment",
    config: { ...intakeConfig(), assessment: { ...DEFAULT_ASSESSMENT, ...settings } },
  });
}

export const daysAgo = (now: Date, n: number, minutes = 0) => new Date(now.getTime() - n * 86_400_000 + minutes * 60_000).toISOString();

export function submissionRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    form_id: FORM_ID,
    lead_id: null,
    mode: "form",
    contact: { name: `Person ${id}`, email: `${id}@example.com` },
    answers: [],
    fit: "unscored",
    status: "new",
    started_at: "2026-10-18T15:00:00Z",
    created_at: "2026-10-18T15:01:00Z",
    submitted_at: "2026-10-18T15:04:00Z",
    last_active_at: "2026-10-18T15:04:00Z",
    score: null,
    band: null,
    temperature: null,
    ...over,
  };
}

export function boothRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    lead_id: `lead-${id}`,
    event_code: "urban-golf-2026",
    track: null,
    score: null,
    band: null,
    temperature: null,
    answers: {},
    gaps: [],
    ticket_code: "T-001",
    consent_email: true,
    consent_sms: false,
    consent_at: null,
    lawmatics_contact_id: "lm-secret",
    lawmatics_synced_at: null,
    lawmatics_tagged_at: null,
    client_ref: `ref-${id}`,
    created_at: "2026-10-17T15:00:00Z",
    completed_at: null,
    ...over,
  };
}

/** The answers the real scorer would store for an assessment, as option labels. */
export function assessmentAnswers(raw: Record<string, string>, settings: Partial<AssessmentSettings> = {}) {
  const r = scoreAssessmentAnswers({ ...DEFAULT_ASSESSMENT, ...settings }, raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

export const BUSINESS_ANSWERS = { "1": "business", "2": "no", "3": "4_10", "4": "over_1m", "5": "applied", "6": "partial", "7": "none", "8": "right_away" };

/** Wires `@/lib/db/scoped-client` to the fake db (and optionally a signed-out session). */
export function mockScopedDb(db: FakeDb, opts: { signedIn?: boolean; wrap?: (client: ReturnType<FakeDb["client"]>) => unknown } = {}) {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => {
      const client = db.client();
      const withAuth = opts.signedIn === false ? { ...client, auth: { getUser: async () => ({ data: { user: null }, error: null }) } } : client;
      return opts.wrap ? opts.wrap(withAuth as ReturnType<FakeDb["client"]>) : withAuth;
    }),
  }));
}

export function newDb(tables: Record<string, Row[]> = {}, role = "attorney"): FakeDb {
  return createFakeDb({ role, orgId: ORG, tables: { crm_intake_form: [formRow()], crm_intake_submission: [], crm_booth_scorecard: [], ...tables } });
}
