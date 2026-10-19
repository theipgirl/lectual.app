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
        ? { notice: "Saved. This proposal was approved, so it is back to draft and needs approving again." }
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
  return lifecycle(formData, approveProposal, "Approved. You can mark it as sent when you've shared the link.", "Couldn't approve this proposal.");
}

export async function unapproveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return lifecycle(formData, unapproveProposal, "Sent back to draft.", "Couldn't send this proposal back to draft.");
}

/** Marks the version sent (the client link starts working). Nothing is emailed from here. */
export async function sendAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return lifecycle(formData, sendProposal, "Marked as sent. The client link is live.", "Couldn't mark this proposal as sent.");
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
