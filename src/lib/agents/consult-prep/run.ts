import { z } from "zod";
import type { DraftTextGenerator } from "@/lib/prep-consult/drafts";
import { defaultPrepDeps } from "@/lib/consult-prep/deps";
import { PREP_BATCH, runPrep, type PrepDeps } from "@/lib/consult-prep/engine";
import { AGENT_POLICY } from "../policy";
import type { AgentContext, AgentResult } from "../types";
import { PREP_SOURCE, PREP_WINDOW_HOURS } from "./constants";

/**
 * Consult prep: the assistant that prepares every consult on its own, with no questions asked.
 *
 * The work is in `src/lib/consult-prep/engine.ts` (one place for the rules: the candidates, the keys, the brief, the
 * three internal emails and the cancel-on-change). This file is the assistant's entry point: it hands the engine the
 * run's context, the production wiring and the ONE model call the assistant has (the client-prep email's text, for a firm
 * that has that template; the brief itself is rendered from data and makes no model call). It writes drafts and internal
 * email only; nothing goes to a client.
 *
 * Gates stay with the runner and its callers: the Assistants feature, the setting, Autopilot, the run row and the budget.
 * The Mailboxes feature is no longer one of them: a consult from the Lawmatics sync needs none (an Outlook consult still does).
 */

export { PREP_SOURCE, PREP_WINDOW_HOURS, PREP_BATCH };

const GeneratedText = z.object({ text: z.string().describe("The complete plain-text email, in the exact format the instructions give") });

export async function runConsultPrep(ctx: AgentContext, deps: PrepDeps = defaultPrepDeps(ctx)): Promise<AgentResult> {
  const generate: DraftTextGenerator = async ({ system, prompt, maxTokens }) => {
    const { output } = await ctx.llm({
      system: `${AGENT_POLICY}\n\n${system}`,
      user: `<lead_record>\n${prompt}\n</lead_record>`,
      schema: GeneratedText,
      effort: "high",
      maxTokens,
      agent: "consult-prep",
    });
    return output.text;
  };
  return runPrep(ctx, deps, generate);
}
