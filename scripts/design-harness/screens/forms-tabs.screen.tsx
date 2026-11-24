import IntakeFormsPage from "@/app/dashboard/forms/page";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { vi } from "vitest";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/** Forms Results / Performance tabs (type-floor check). Invented people. */
const T = "2026-11-01T15:00:00Z";
const F1 = "00000000-0000-4000-8000-0000000f0001";
const config = defaultIntakeConfig();
const form: IntakeFormRecord = {
  id: F1, name: "Intake", slug: "intake", sourceTag: "UGW 2026", kind: "intake", status: "live", config,
  allowedDomains: [], receivesReferrals: false, agreementSignedAt: null, publishedAt: T, everSaved: true, createdAt: T, updatedAt: T,
};
const qs = config.questions.filter((q) => q.text.trim());
const names = ["Ada Example", "Ben Sample", "Cy Testcase", "Dee Fixture", "Eli Mockson", "Fay Placeholder"];
const people = Array.from({ length: 12 }, (_, i) => ({
  id: `00000000-0000-4000-8000-00000000a0${String(i).padStart(2, "0")}`,
  contact: { name: names[i % 6], email: `person${i}@example.test`, phone: "555-0100" },
  answers: qs.slice(0, 4).map((q) => ({ id: q.id, question: q.text, answer: `Sample answer ${i}` })),
  started_at: `2026-11-0${(i % 8) + 1}T14:00:00Z`,
  submitted_at: i % 3 ? `2026-11-0${(i % 8) + 1}T14:06:00Z` : null,
  lead_id: null, score: null, band: null, temperature: null,
}));
const listRows = people.map((p) => ({ id: p.id, mode: "form", contact: p.contact, fit: "fit", status: "new", started_at: p.started_at, submitted_at: p.submitted_at, last_active_at: p.started_at }));

const prepare = () => () => {
  resetState();
  vi.setSystemTime(new Date("2026-11-16T14:00:00Z"));
  state.pathname = "/dashboard/forms/";
  state.formsList = [form];
  state.formRecord = form;
  (state as { formResultRows?: unknown }).formResultRows = people;
  (state as { formPeopleList?: unknown }).formPeopleList = listRows;
  (state as { formStatRows?: unknown[] }).formStatRows = people.map((p) => ({ form_id: F1, started_at: p.started_at, created_at: p.started_at, submitted_at: p.submitted_at, temperature: null }));
};
const GROW = "<style>.lx-app{height:auto!important;overflow:visible!important}.lx-content,.lx-page{overflow:visible!important}</style>";
function page(sp: Record<string, string>) {
  return async function renderPage() {
    return <OwnerShell>{await IntakeFormsPage({ searchParams: Promise.resolve(sp) })}</OwnerShell>;
  };
}
const mk = (id: string, title: string, viewport: "desktop" | "phone", sp: Record<string, string>): Screen => ({
  id, title, designBoard: "-", viewport, pathname: "/dashboard/forms/", prepare: prepare(), render: page(sp), transformHtml: (h) => GROW + h,
});
export const screens: Screen[] = [
  mk("forms-results-1440", "Forms Results tab, 1440", "desktop", { form: F1, tab: "results" }),
  mk("forms-results-phone", "Forms Results tab, phone", "phone", { form: F1, tab: "results" }),
  mk("forms-perf-1440", "Forms Performance tab, 1440", "desktop", { form: F1, tab: "performance" }),
  mk("forms-perf-phone", "Forms Performance tab, phone", "phone", { form: F1, tab: "performance" }),
];
