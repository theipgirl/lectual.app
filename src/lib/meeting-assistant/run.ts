import { z } from "zod";
import { AiOutputError, aiConfigured as realAiConfigured, callClaude, type StructuredCall } from "@/lib/ai/claude";
import { buildSystemPrompt, buildUserTurn } from "./prompt";
import { LIMITS } from "./types";
import { validateProposals } from "./validate";
import type { MeetingAssistantInput, MeetingAssistantResult } from "./types";

/** The model's raw answer. Everything is re-checked by `validateProposals`. */
export const AssistantOutputSchema = z.object({
  proposals: z.array(
    z.object({
      record: z.object({
        kind: z.enum(["matter", "lead", "unmatched"]),
        id: z.string().nullable().describe("The id from <rows>, or null when unmatched"),
      }),
      recordName: z.string().nullable().describe("The record's name as spoken, only when unmatched"),
      nextStep: z.string().describe("One short action, at most 200 characters"),
      dueDate: z.string().nullable().describe("YYYY-MM-DD, ONLY if a specific date is stated in the evidence; otherwise null"),
      ownerId: z.string().nullable().describe("A member id from <members>, ONLY if someone was clearly given it; otherwise null"),
      note: z.string().describe("Context, at most 400 characters"),
      evidence: z.string().describe("A short verbatim quote from the transcript, at most 300 characters"),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export type MeetingAssistantDeps = {
  /** Injected in tests; defaults to the real structured call. */
  call?: StructuredCall;
  aiConfigured?: () => boolean;
  signal?: AbortSignal;
  /** Counts only. Never receives transcript text. */
  log?: (line: string) => void;
};

const UNAVAILABLE = "Couldn't read this meeting right now. Try again in a minute.";
const NOT_CONFIGURED = "The meeting assistant isn't switched on for your firm yet. Lectual will turn it on.";

/**
 * ONE model call, then validation. Model: the sonnet tier through `agentModel("staff")` (the call is not an
 * agent run and `staff` is the table's subject for exactly that; no new subject is added). The deadline is
 * `callClaude`'s own (120 s, one retry) plus the caller's signal. Three states, never two; a failed read is
 * never "no proposals". Logs counts only.
 */
export async function runMeetingAssistant(input: MeetingAssistantInput, deps: MeetingAssistantDeps = {}): Promise<MeetingAssistantResult> {
  const configured = (deps.aiConfigured ?? realAiConfigured)();
  if (!configured) return { state: "not-configured", reason: NOT_CONFIGURED };
  const log = deps.log ?? ((line: string) => console.info(line));
  const call = deps.call ?? callClaude;
  try {
    const res = await call({
      system: buildSystemPrompt(),
      user: buildUserTurn(input),
      schema: AssistantOutputSchema,
      effort: "medium",
      maxTokens: 16000,
      agent: "staff",
      signal: deps.signal,
    });
    const { proposals, dropped } = validateProposals(res.output, input);
    // A malformed answer is never "no proposals".
    if (dropped.malformed > 0 && proposals.length === 0) {
      log("[meeting-assistant] failed kind=malformed");
      return { state: "unavailable", reason: UNAVAILABLE };
    }
    const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0);
    log(`[meeting-assistant] rows=${input.rows.length} proposals=${proposals.length} dropped=${droppedTotal}`);
    return { state: "ok", proposals, dropped, rowsTruncated: input.rows.length > LIMITS.rows };
  } catch (err) {
    log(`[meeting-assistant] failed kind=${err instanceof AiOutputError ? err.kind : "error"}`);
    return { state: "unavailable", reason: UNAVAILABLE };
  }
}
