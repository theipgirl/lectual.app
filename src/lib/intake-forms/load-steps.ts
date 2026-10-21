import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Load } from "./load-results";
import type { RangeDays } from "./performance";
import { stepFunnel, stoppedAt, type StepEventRow, type StepFunnel, type StepPerson, type StepQuestionRef, type StoppedAt } from "./step-funnel";
import { isMissingTableError } from "./store";
import { isStepSchemaError } from "./steps";

/**
 * The reads behind drop-off by question, median time per step and "stopped at"
 * (Sprint 10): the caller's scoped client only, read-only, each three-state.
 *
 * `unconfigured` means lectual 0096 isn't in this database (the step columns or
 * the `step` kind are missing): the page says step data isn't recorded yet. It
 * is never drawn as zero, and `unavailable` (a read that failed) is never drawn
 * as "no drop-off". Step events are read here and NOT by the funnel read in
 * load-performance.ts, which excludes the step kind so a person answering
 * twelve questions can't eat its 50,000-event cap.
 */

const PAGE = 1000;
/** Step events behind one read: 50 pages of 1,000. Past it the page says the numbers are capped. */
export const STEP_EVENT_PAGES = 50;
export const STEP_EVENT_LIMIT = PAGE * STEP_EVENT_PAGES;
/** People behind one drop-off table. */
export const STEP_PEOPLE_LIMIT = 5000;
/** How many people one "stopped at" read covers (the All intakes table shows at most 200). */
export const STOPPED_AT_IDS = 200;

type PgError = { code?: string; message?: string } | null;

const classify = (error: unknown): { status: "unconfigured" } | { status: "unavailable"; error: unknown } =>
  isMissingTableError(error as PgError) || isStepSchemaError(error as PgError) ? { status: "unconfigured" } : { status: "unavailable", error };

const EVENT_COLUMNS = "submission_id, question_id, step_index, occurred_at";

type PageFn<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

async function readAll<T>(page: PageFn<T>, maxPages: number): Promise<Load<{ rows: T[]; capped: boolean }>> {
  const rows: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await page(p * PAGE, p * PAGE + PAGE - 1);
    if (error) return classify(error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { status: "ok", value: { rows, capped: false } };
  }
  return { status: "ok", value: { rows, capped: true } };
}

/** When the form's first step event happened (null when it has none): tells "not recorded" from "stopped before Q1". */
export async function loadEarliestStep(formId: string): Promise<Load<string | null>> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_intake_event")
      .select("occurred_at")
      .eq("form_id", formId)
      .eq("kind", "step")
      .order("occurred_at", { ascending: true })
      .limit(1);
    if (error) return classify(error);
    return { status: "ok", value: data?.[0]?.occurred_at ?? null };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

const sinceOf = (range: RangeDays, now: Date) => new Date(now.getTime() - range * 86_400_000).toISOString();

/** The form's step events in the range, newest read last; capped at STEP_EVENT_LIMIT. */
export async function loadStepEvents(formId: string, range: RangeDays, now = new Date()): Promise<Load<{ rows: StepEventRow[]; capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    const since = sinceOf(range, now);
    return await readAll<StepEventRow>(
      (from, to) =>
        supabase
          .from("crm_intake_event")
          .select(EVENT_COLUMNS)
          .eq("form_id", formId)
          .eq("kind", "step")
          .gte("occurred_at", since)
          .order("id", { ascending: true })
          .range(from, to),
      STEP_EVENT_PAGES,
    );
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** The step events of the given people only (any date): the All intakes table and the drawer. */
export async function loadStepEventsFor(formId: string, submissionIds: readonly string[]): Promise<Load<StepEventRow[]>> {
  if (submissionIds.length === 0) return { status: "ok", value: [] };
  try {
    const supabase = await getScopedClient();
    const read = await readAll<StepEventRow>(
      (from, to) =>
        supabase
          .from("crm_intake_event")
          .select(EVENT_COLUMNS)
          .eq("form_id", formId)
          .eq("kind", "step")
          .in("submission_id", [...submissionIds])
          .order("id", { ascending: true })
          .range(from, to),
      20,
    );
    return read.status === "ok" ? { status: "ok", value: read.value.rows } : read;
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** The people who started the form in the range, with their answers and saved progress. */
export async function loadStepPeople(formId: string, range: RangeDays, now = new Date()): Promise<Load<{ rows: StepPerson[]; capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    const since = sinceOf(range, now);
    const read = await readAll<StepPerson>(
      (from, to) =>
        supabase
          .from("crm_intake_submission")
          .select("id, started_at, submitted_at, answers, progress")
          .eq("form_id", formId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      STEP_PEOPLE_LIMIT / PAGE,
    );
    return read;
  } catch (error) {
    return { status: "unavailable", error };
  }
}

export type StepFunnelRead = StepFunnel & { capped: boolean };

/**
 * Drop-off by question and time per step for one form over the range:
 * events + people + the form's questions in asked order. Every part must read
 * for the numbers to show; one that doesn't is named, never zero.
 */
export async function loadStepFunnel(formId: string, range: RangeDays, questions: readonly StepQuestionRef[], now = new Date()): Promise<Load<StepFunnelRead>> {
  const events = await loadStepEvents(formId, range, now);
  if (events.status !== "ok") return events;
  const people = await loadStepPeople(formId, range, now);
  if (people.status !== "ok") return people;
  const funnel = stepFunnel({ questions, people: people.value.rows, events: events.value.rows });
  return { status: "ok", value: { ...funnel, capped: events.value.capped || people.value.capped } };
}

/**
 * "Stopped at" for a set of people (the All intakes table): their own step
 * events plus the form's earliest, so a person from before 0096 reads
 * "not recorded" and not "Stopped before Q1".
 */
export async function loadStoppedAt(
  formId: string,
  people: readonly { id: string; started_at: string; submitted_at: string | null }[],
): Promise<Load<Record<string, StoppedAt>>> {
  const open = people.filter((p) => !p.submitted_at).slice(0, STOPPED_AT_IDS);
  const [earliest, events] = await Promise.all([loadEarliestStep(formId), loadStepEventsFor(formId, open.map((p) => p.id))]);
  if (earliest.status !== "ok") return earliest;
  if (events.status !== "ok") return events;
  return { status: "ok", value: Object.fromEntries(people.map((p) => [p.id, stoppedAt(p, events.value, earliest.value)])) };
}

export type DrawerSteps = { reading: StoppedAt; progress: Record<string, string> | null };

/** One person for the drawer: where they stopped, and their saved answers so far. */
export async function loadDrawerSteps(formId: string, person: { id: string; started_at: string; submitted_at: string | null }): Promise<Load<DrawerSteps>> {
  try {
    const [earliest, events] = await Promise.all([loadEarliestStep(formId), loadStepEventsFor(formId, [person.id])]);
    if (earliest.status !== "ok") return earliest;
    if (events.status !== "ok") return events;
    let progress: Record<string, string> | null = null;
    if (!person.submitted_at) {
      const supabase = await getScopedClient();
      const { data, error } = await supabase.from("crm_intake_submission").select("progress").eq("id", person.id).eq("form_id", formId).maybeSingle();
      if (error) return classify(error);
      const raw = (data as { progress?: unknown } | null)?.progress;
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        const entries = Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "");
        progress = entries.length ? Object.fromEntries(entries) : null;
      }
    }
    return { status: "ok", value: { reading: stoppedAt(person, events.value, earliest.value), progress } };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
