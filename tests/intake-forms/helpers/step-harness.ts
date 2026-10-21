import { vi } from "vitest";
import { defaultIntakeConfig, type IntakeFormConfig } from "@/lib/intake-forms/config";
import { AdminFake, FORM_A, FORM_A2, FORM_B, ORG_A, ORG_B, formRow, newToken, personRow, type Row } from "./step-db";

/**
 * Loads the public intake's server actions with the data layer replaced by an
 * in-memory service-role fake, so a test calls `recordIntakeStepAction`,
 * `submitIntakeAction` and friends exactly as the page does and then reads the
 * rows they wrote.
 */

export const SESSION_ID = "session-id-0123456789abcdef";

export const QUESTIONS: IntakeFormConfig["questions"] = [
  { id: "q-name", text: "What name do you want to protect?", required: true, pack: null, edited: true },
  { id: "q-pick", text: "Have you used it publicly?", required: true, pack: null, edited: true, type: "single", options: ["Yes", "No", "Not sure"] },
  { id: "q-many", text: "Which of these do you have?", required: false, pack: null, edited: true, type: "multi", options: ["Word mark", "Logo", "Slogan, tagline"] },
];

export function intakeConfigRow(over: Partial<IntakeFormConfig> = {}): IntakeFormConfig {
  return { ...defaultIntakeConfig(), questions: QUESTIONS, ...over };
}

export type HarnessOptions = {
  config?: IntakeFormConfig;
  kind?: "intake" | "assessment";
  people?: Row[];
  ip?: string | null;
  /** Extra rows for tables the test cares about. */
  tables?: Record<string, Row[]>;
  /** Also serve the same rows to the staff pages' scoped client, so a write and the read of it share one store. */
  scoped?: boolean;
};

export async function loadActions(opts: HarnessOptions = {}) {
  const db = new AdminFake({
    crm_org: [
      { id: ORG_A, name: "Hartwell IP" },
      { id: ORG_B, name: "Other Firm" },
    ],
    crm_intake_form: [
      formRow({ config: opts.config ?? intakeConfigRow(), kind: opts.kind ?? "intake" }),
      // A second live intake in the same firm, and one in another firm.
      formRow({ id: FORM_A2, slug: "second-intake", config: intakeConfigRow() }),
      formRow({ id: FORM_B, org_id: ORG_B, slug: "other-firm", config: intakeConfigRow() }),
    ],
    crm_intake_submission: opts.people ?? [],
    crm_intake_event: [],
    crm_lead: [],
    crm_activity: [],
    crm_stage: [],
    ...opts.tables,
  });
  const ip = opts.ip === undefined ? "203.0.113.9" : opts.ip;
  vi.resetModules();
  vi.doMock("@/lib/db/admin", () => ({ getAdminClient: () => db.client() }));
  if (opts.scoped) {
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => db.client() }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "UTC" }));
  }
  vi.doMock("next/headers", () => ({
    cookies: async () => ({ get: () => ({ value: SESSION_ID }), set: () => {} }),
    headers: async () => ({ get: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? ip : null) }),
  }));
  vi.doMock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn).catch(() => {}) }));
  vi.doMock("@/lib/intake-forms/secrets", () => ({ intakeSalt: () => "test-salt", throttleKey: () => "test-key" }));
  vi.doMock("@/lib/intake-forms/lawmatics-sync", () => ({ syncIntakeCompletion: vi.fn(), syncIntakeStart: vi.fn() }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => false, askClaude: vi.fn() }));
  const actions = await import("../../../src/app/i/[slug]/actions");
  return { db, actions };
}

/** A person who gave their contact details and holds a resume token. */
export function person(over: Row = {}) {
  const token = newToken();
  return { token, row: personRow(token, over) };
}

export { FORM_A, FORM_A2, FORM_B, ORG_A, ORG_B };
