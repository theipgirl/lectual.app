"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  PROPOSAL_SAVE_CONFLICT,
  approveProposal,
  getProposal,
  reviseProposal,
  sendProposal,
  unapproveProposal,
  updateProposal,
  withdrawProposal,
  type UpdateProposalInput,
} from "@/lib/proposals/store";
import type { ProposalContent, ProposalRow } from "@/lib/proposals/types";
import { GOES_LIVE_ON_APPROVAL, pendingProposalEmail, proposalSendBlock } from "@/lib/consult-proposal/link";
import {
  newBrandName,
  parseAdjustments,
  parseDetails,
  parseIncludes,
  parseMessage,
  parseName,
  parsePricing,
  removeName,
  replaceName,
  takenIds,
  type Parsed,
} from "@/lib/proposal-editor/form";
import { resolveFirmSession } from "@/lib/firm/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { createDraft } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { getSiteOrigin } from "@/lib/site-origin";
import { clientLinkOrigin, clientLinkUrl } from "@/lib/proposals/client-link-origin";
import { runManualEmail } from "@/lib/consult-proposal/manual-email";
import { runCreateLink } from "@/lib/proposal-editor/create-link";
import { EDIT_AGAIN_DONE, LINK_TURNED_ON } from "@/lib/proposal-editor/vocabulary";
import { proposalActionError, type ActionState } from "../errors";
import { gateStaffAction } from "../gate";

/**
 * The proposal editor's write surface. Every function is its own POST entry
 * point, so every one calls `gateStaffAction()` first (module gate with
 * notFound(), then the staff-role list) — the page's own gate protects the page
 * and nothing else.
 *
 * ── ONE FORM PER SECTION, THE WHOLE DOCUMENT GOES THROUGH updateProposal ────
 * A section action reads the CURRENT row, replaces only its own part of the
 * content, and hands the full document to `updateProposal`. That function owns
 * everything that matters about an edit: it refuses a sent / accepted /
 * superseded / withdrawn version, fences the write on the status it read,
 * returns an approved row to draft (the database trigger does that), and
 * writes the `edited` event with what changed and the legal total before and
 * after. Nothing here stamps approval, timestamps or events.
 *
 * Every section form posts the `updated_at` it was rendered with (`updatedAt`,
 * hidden), and `updateProposal` refuses the save if the row has moved since:
 * the person sees PROPOSAL_SAVE_CONFLICT instead of overwriting a colleague.
 *
 * Pricing and validation are not reimplemented: the editor shows
 * `validateContent`'s issues beside each form, and `approveProposal` refuses
 * to approve while any is an error.
 */

const rand = () => randomBytes(4).toString("hex");

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function revalidate(id: string): void {
  revalidatePath(`/dashboard/proposals/${id}/`);
  revalidatePath("/dashboard/proposals/");
}

/** Read the row, build the patch from the form, save, and say what happened. */
async function edit(
  formData: FormData,
  build: (current: ProposalRow) => Parsed<UpdateProposalInput>,
): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  // The `updated_at` this page was rendered with. A form that did not send one
  // (a stale tab from before this existed) is told to reload, never saved unfenced.
  const expectedUpdatedAt = field(formData, "updatedAt");
  if (!expectedUpdatedAt) return { error: PROPOSAL_SAVE_CONFLICT };
  try {
    const detail = await getProposal(id);
    if (!detail) return { error: "Proposal not found." };
    const current = detail.proposal;
    const built = build(current);
    if (!built.ok) return { error: built.error };
    const updated = await updateProposal(id, built.value, { expectedUpdatedAt });
    revalidate(id);
    return {
      saved: true,
      ...(current.status === "approved" && updated.status === "draft"
        ? { notice: "Saved. Its link wasn't live yet, so it is back to draft; create the link again when it's ready." }
        : {}),
    };
  } catch (err) {
    return proposalActionError(err, "Couldn't save your changes.");
  }
}

function withContent(next: Parsed<ProposalContent>): Parsed<UpdateProposalInput> {
  return next.ok ? { ok: true, value: { content: next.value } } : next;
}

/* ── the sections ───────────────────────────────────────────────────────── */

export async function saveDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const r = parseDetails(formData, current.content);
    return r.ok ? { ok: true, value: r.value } : r;
  });
}

export async function saveMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => withContent(parseMessage(formData, current.content)));
}

export async function savePricingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const r = parsePricing(formData);
    return r.ok ? { ok: true, value: { content: { ...current.content, pricing: r.value } } } : r;
  });
}

export async function saveNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const name = parseName(formData, current.content, rand);
    if (!name.ok) return name;
    return withContent(replaceName(current.content, name.value));
  });
}

export async function addNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const name = field(formData, "name");
    if (!name) return { ok: false, error: "Enter the brand name to add." };
    const added = newBrandName(name, takenIds(current.content), rand);
    return { ok: true, value: { content: { ...current.content, names: [...current.content.names, added] } } };
  });
}

export async function removeNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => withContent(removeName(current.content, field(formData, "nameId"))));
}

export async function saveAdjustmentsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const r = parseAdjustments(formData, rand);
    return r.ok ? { ok: true, value: { content: { ...current.content, adjustments: r.value } } } : r;
  });
}

export async function saveIncludesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const r = parseIncludes(formData);
    return r.ok ? { ok: true, value: { content: { ...current.content, includes: r.value } } } : r;
  });
}

/* ── lifecycle ──────────────────────────────────────────────────────────── */

/**
 * Approve. Only the firm's named approvers get past the database trigger; the
 * store lists the problems when the proposal breaks a firm rule. Whether the
 * button is SHOWN is `isCurrentUserApprover()` on the page, a courtesy.
 */
export async function approveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return lifecycle(formData, approveProposal, "Saved.", "Couldn't save this proposal.");
}

/**
 * "Save and create link": approve, then make the link live, in one click. Nothing is emailed;
 * "sent" in the database only means the client link opens. If the first step lands and the
 * second does not, the version stays saved and "Turn on the link" (sendAction) finishes it.
 */
export async function createLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runCreateLink(
    { gate: gateStaffAction, approve: approveProposal, makeLive: sendProposal, describe: proposalActionError, revalidate },
    field(formData, "proposalId"),
  );
}

export async function unapproveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return lifecycle(formData, unapproveProposal, EDIT_AGAIN_DONE, "Couldn't take this proposal back to editing.");
}

/** "Turn on the link": the recovery for a saved version whose link is not live. Nothing is emailed from here. */
export async function sendAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;
  // A proposal the consult agent drafted goes live only when its email is
  // approved in the queue (fails closed). The button is hidden for it, but a
  // hand-posted form must not get around that.
  const blocked = await consultSendRefusal(field(formData, "proposalId"));
  if (blocked) return { error: blocked };
  return lifecycle(formData, sendProposal, LINK_TURNED_ON, "Couldn't turn on the link.");
}

async function consultSendRefusal(id: string): Promise<string | null> {
  let proposal: ProposalRow | null;
  try {
    proposal = (await getProposal(id))?.proposal ?? null;
  } catch {
    return GOES_LIVE_ON_APPROVAL;
  }
  // Only the consult agent's proposals have a queue email; a missing one falls through to the store's own "not found".
  if (!proposal || proposal.source !== "agent") return null;
  const block = await proposalSendBlock(id);
  return block.blocked ? GOES_LIVE_ON_APPROVAL : null;
}

export async function withdrawAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return lifecycle(formData, withdrawProposal, "Withdrawn. The client link no longer opens it.", "Couldn't withdraw this proposal.");
}

async function lifecycle(
  formData: FormData,
  run: (id: string) => Promise<ProposalRow>,
  notice: string,
  fallback: string,
): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  try {
    await run(id);
  } catch (err) {
    return proposalActionError(err, fallback);
  }
  revalidate(id);
  return { saved: true, notice };
}

/** Sent -> the next version, as a draft. Redirects to it. */
export async function reviseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  let nextId: string;
  try {
    nextId = (await reviseProposal(id)).id;
  } catch (err) {
    return proposalActionError(err, "Couldn't create the revision.");
  }
  revalidate(id);
  revalidate(nextId);
  redirect(`/dashboard/proposals/${nextId}/`);
}

/* ── the post-consult email ─────────────────────────────────────────────── */

/**
 * "Create post-consult email": queues Rebecca's approved proposal-link email for THIS proposal in the
 * approval queue (the same email, link marker and approve gate as the consult agent's). Nothing is
 * sent; a named approver approves the email in the queue and a person sends the mailbox draft.
 * Re-checks the session, the lead-writing role, the `proposals` module and the proposal staff roles.
 */
export async function queuePostConsultEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runManualEmail(
    {
      gate: async () => {
        const refused = await gateStaffAction();
        if (refused) return refused;
        const session = await resolveFirmSession();
        return session.kind === "ok" && CAN_WRITE_LEAD.includes(session.role) ? null : { error: "Your role can't draft client email." };
      },
      loadProposal: async (id) => (await getProposal(id))?.proposal ?? null,
      context: async () => {
        const session = await resolveFirmSession();
        return session.kind === "ok"
          ? { orgId: session.org.id, userId: session.user.id, firmName: session.org.name, firmSlug: session.org.slug }
          : null;
      },
      queueOrgKey: activeQueueOrgKey,
      links: async (orgId, publicToken, proposalId) => {
        const origin = (await getSiteOrigin()).replace(/\/$/, "");
        return {
          clientUrl: clientLinkUrl(await clientLinkOrigin(orgId), publicToken),
          staffUrl: `${origin}/dashboard/proposals/${proposalId}/`,
        };
      },
      pendingFor: pendingProposalEmail,
      createDraft,
      writeMarker: async (row) => {
        const supabase = await getScopedClient();
        const { error } = await supabase.from("crm_activity").insert(row);
        return !error;
      },
      revalidate: (proposalId, leadId) => {
        revalidate(proposalId);
        revalidatePath("/dashboard/queue/");
        if (leadId) revalidatePath(`/dashboard/leads/${leadId}/`);
      },
      testPrefix: process.env.VERCEL_ENV === "production" ? "" : "[TEST] ",
    },
    field(formData, "proposalId"),
  );
  return result.ok ? { saved: true, notice: result.notice, queueId: result.queueId } : { error: result.error };
}
