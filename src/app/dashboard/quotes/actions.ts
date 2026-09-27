"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { callerHasRole } from "@/lib/auth/current-role";
import { createQuote } from "@/lib/quotes/store";
import { endOfFirmDay } from "@/lib/quotes/firm-time";
import type { QuoteRow } from "@/lib/quotes/types";
import { friendlyQuoteError, NOT_ENTITLED, type ActionState } from "./errors";

/**
 * List-level quote actions. Only CREATION lives here — everything that mutates
 * an existing quote is its own POST entry point in `[id]/actions.ts`.
 *
 * ── THE attorney+ GATE IS RE-RUN HERE, NOT INHERITED ────────────────────────
 * The quotes pages refuse below attorney (quoting is configuration, not
 * casework — see page.tsx). That check protects the page and nothing else: a
 * "use server" function is its own POST endpoint, so a caller who never loaded
 * the page can still invoke it. So the gate is the first statement here.
 *
 * `createQuote`'s own `requireQuoteWriteRole` is a SEPARATE, WIDER check that
 * mirrors 0068's RLS (it still admits intake, paralegals, clerks). It is not
 * this gate and does not stand in for it.
 */
export async function createQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Enter a title for this quote." };

  // One picker, three possible targets: "lead:<id>", "matter:<id>" or
  // "contact:<id>". Every option was resolved server-side through RLS; the id
  // is re-checked by the composite FK on insert (a foreign id cannot land).
  const target = String(formData.get("client") ?? "").trim();
  const [kind, id] = target.includes(":") ? target.split(":", 2) : ["", ""];
  const leadId = kind === "lead" ? id : null;
  const matterId = kind === "matter" ? id : null;
  const contactId = kind === "contact" ? id : null;

  const introBody = String(formData.get("introBody") ?? "").trim() || null;
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  let expiresAt: string | null = null;
  if (expiresRaw) {
    expiresAt = endOfFirmDay(expiresRaw);
    if (!expiresAt) return { error: "Enter a valid expiry date." };
  }

  let quote: QuoteRow;
  try {
    quote = await createQuote({ title, matterId, leadId, contactId, introBody, expiresAt });
  } catch (err) {
    return { error: friendlyQuoteError(err, "Couldn't create this quote.") };
  }

  revalidatePath("/dashboard/quotes/");
  redirect(`/dashboard/quotes/${quote.id}/`);
}
