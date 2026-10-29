"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  PROPOSAL_SAVE_CONFLICT,
  approveProposal,
  changeLivePayLink,
  deleteProposalFamily,
  getProposal,
  getProposalSettings,
  isCurrentUserApprover,
  listProposalStepEvents,
  resetProposalAcceptance,
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
  parseDateInput,
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
import { getSiteOrigin } from "@/lib/site-origin";
import { clientLinkOrigin, clientLinkUrl } from "@/lib/proposals/client-link-origin";
import { runManualEmail } from "@/lib/consult-proposal/manual-email";
import { runCreateLink } from "@/lib/proposal-editor/create-link";
import { runChangePayLink } from "@/lib/proposal-editor/pay-link";
import { DELETE_OWNER_ONLY, canDeleteProposal } from "@/lib/proposal-editor/delete-proposal";
import { runResetAcceptance } from "@/lib/proposal-editor/reset-acceptance";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { paidStateFromEvents } from "@/lib/proposals/paid";
import { currentRole } from "@/lib/auth/current-role";
import { createDraft, listQueue } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { EDIT_AGAIN_DONE, LINK_TURNED_ON } from "@/lib/proposal-editor/vocabulary";
import { proposalActionError, type ActionState } from "../errors";
import { gateStaffAction, requireProposalsModule } from "../gate";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Links an unlinked draft or approved proposal to a lead. The composite foreign key keeps it inside the firm. */
export async function linkLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return edit(formData, (current) => {
    const leadId = field(formData, "leadId");
    if (!UUID_RE.test(leadId)) return { ok: false, error: "Choose a lead to link." };
    if (current.lead_id) return { ok: false, error: "This proposal is already linked to a lead." };
    return { ok: true, value: { leadId } };
  });
}

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
    if (!r.ok) return r;
    // The pay link rides on this form (Step 3); a form that did not carry it leaves the stored one alone.
    const payUrl = formData.has("payUrl") ? { payUrl: field(formData, "payUrl") || null } : {};
    // So does the expiry date; a form that did not carry it leaves the stored one alone.
    let expiresOn: { expiresOn: string | null } | Record<string, never> = {};
    if (formData.has("expiresOn")) {
      const e = parseDateInput(field(formData, "expiresOn"), "Expiry date");
      if (!e.ok) return e;
      expiresOn = { expiresOn: e.value };
    }
    return { ok: true, value: { content: { ...current.content, pricing: r.value }, ...payUrl, ...expiresOn } };
  });
}

export async function saveNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Spec 6: a brand name whose package the client chooses snapshots the firm's CURRENT package list into the
  // proposal. Read through the scoped client; an unreadable list saves nothing rather than guess at prices.
  let settingPricing: unknown = null;
  if (formData.get("pkgFields") === "1" && formData.get("pkgChoice") === "on") {
    try {
      settingPricing = (await getProposalSettings())?.pricing ?? {};
    } catch {
      return { error: "Couldn't load the firm's packages. Try again." };
    }
  }
  return edit(formData, (current) => {
    const name = parseName(formData, current.content, rand);
    if (!name.ok) return name;
    const replaced = replaceName(current.content, name.value);
    if (!replaced.ok) return replaced;
    return withContent({ ok: true, value: settingPricing === null ? replaced.value : withPackageSnapshot(replaced.value, settingPricing) });
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

/**
 * "Change pay link" on a version whose link is live (lectual 0100): the one field that may change after
 * the link is on. Re-checks the module and the proposal-writing role (gateStaffAction), validates the https
 * link, and writes `pay_url` alone through the scoped client, fenced on the rendered `updated_at`. The
 * database refuses every other status and logs the change itself (hosts only).
 */
export async function changePayLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runChangePayLink(
    {
      gate: gateStaffAction,
      change: (id, payUrl, expectedUpdatedAt) => changeLivePayLink(id, payUrl, { expectedUpdatedAt }),
      describe: proposalActionError,
      revalidate,
    },
    { id: field(formData, "proposalId"), payUrl: formData.get("payUrl"), updatedAt: field(formData, "updatedAt") },
  );
}

/**
 * "Reset acceptance" on an accepted version (lectual 0101): back to "Link live", so the same client link can be
 * accepted again. Re-checks the module and the staff role (gateStaffAction), then the caller's role and whether they
 * are a named approver, then the CURRENT-round paid state (paid = "Undo Mark paid first.", unreadable = refused), and
 * writes `status` alone through the scoped client, fenced on `accepted` and the rendered `updated_at`. The database
 * re-judges all of it, clears the acceptance and logs the reset with the previous acceptance. Nothing is emailed.
 */
export async function resetAcceptanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runResetAcceptance(
    {
      gate: gateStaffAction,
      authorize: async () => {
        const [role, isApprover] = await Promise.all([currentRole(), isCurrentUserApprover()]);
        return { role: role ?? null, isApprover };
      },
      paid: async (id) => {
        const read = await listProposalStepEvents(id);
        if (!read.ok) return "unavailable";
        return paidStateFromEvents(read.events).state === "paid" ? "paid" : "not_paid";
      },
      reset: (id, expectedUpdatedAt) => resetProposalAcceptance(id, { expectedUpdatedAt }),
      describe: proposalActionError,
      revalidate,
    },
    { id: field(formData, "proposalId"), updatedAt: field(formData, "updatedAt") },
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

/**
 * "Delete proposal" (needs lectual 0102): the firm's OWNER removes the whole offer, every version, in any
 * status. Not undoable; the client link then reads like an unknown one. The module gate (notFound) first,
 * then the owner check here, then the store re-reads the role and the row through the scoped client and
 * deletes the family in one statement. Nothing is sent; nothing touches Lawmatics or LawPay.
 */
export async function deleteProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProposalsModule();
  if (!canDeleteProposal(await currentRole())) return { error: DELETE_OWNER_ONLY };
  const id = field(formData, "proposalId");
  const result = await deleteProposalFamily(id);
  revalidatePath("/dashboard/proposals/");
  // On a refusal the page is not revalidated, so the sentence stays on screen (a partial delete before
  // 0102 may already have removed the version this page shows).
  if (!result.ok) return { error: result.error };
  redirect("/dashboard/proposals/?deleted=1");
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
 * "Create post-consult email" (the ONE client-email button; it replaced Sprint 33's "Draft email to client"):
 * once the link is live, queues Rebecca's approved proposal-link email for THIS proposal in the approval queue (the same email, link marker and approve gate as the consult agent's). Nothing is
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
      pendingQueue: async () => {
        const orgKey = await activeQueueOrgKey();
        if (!orgKey) return { status: "unconfigured" };
        try {
          const items = await listQueue(orgKey, "pending");
          return { status: "ok", items: items.map((i) => ({ type: i.type, draftBody: i.draft_body })) };
        } catch {
          return { status: "unavailable" };
        }
      },
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
