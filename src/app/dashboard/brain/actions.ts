"use server";

import { revalidatePath } from "next/cache";
import {
  createBrainEntry,
  updateBrainEntry,
  deleteBrainEntry,
  proposeClaim,
  reviewClaim,
  deleteClaim,
} from "@/lib/brain";
import { isBrainCategory, isClaimStatus } from "./enums";

export type ActionState = { error?: string };

const BRAIN_PATH = "/dashboard/brain/";

// ── Brain entries ────────────────────────────────────────────────────────────
// Every write below is admin-gated inside @/lib/brain (requireBrainAdminRole)
// and, ultimately, by RLS — this file only shapes form input and turns a
// thrown error into a friendly ActionState.

export async function createBrainEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryRaw = String(formData.get("category") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!isBrainCategory(categoryRaw)) return { error: "Choose a category." };
  if (!key) return { error: "Enter a key." };
  if (!title) return { error: "Enter a title." };

  try {
    await createBrainEntry({ category: categoryRaw, key, title, body });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't create this entry." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

export async function updateBrainEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entryId = String(formData.get("entryId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!entryId) return { error: "Missing entry." };
  if (!title) return { error: "Enter a title." };

  try {
    await updateBrainEntry(entryId, { title, body });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update this entry." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

export async function deleteBrainEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "Missing entry." };

  try {
    await deleteBrainEntry(entryId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't delete this entry." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

// ── Claim library ────────────────────────────────────────────────────────────
// proposeClaim is open to any staff role except viewer; reviewClaim/deleteClaim
// are admin/attorney-gated inside @/lib/brain. Nothing here sends or files a
// claim anywhere — this only records the firm's own internal review state
// (UPL firewall: this page is a compliance aid, not legal advice).

export async function proposeClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const claim = String(formData.get("claim") ?? "").trim();
  const context = String(formData.get("context") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  if (!claim) return { error: "Enter the claim text." };

  try {
    await proposeClaim({
      claim,
      context: context || undefined,
      source: source || undefined,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't propose this claim." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

export async function reviewClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const claimId = String(formData.get("claimId") ?? "");
  const statusRaw = String(formData.get("status") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!claimId) return { error: "Missing claim." };
  if (!isClaimStatus(statusRaw) || statusRaw === "proposed") {
    return { error: "Choose approved or forbidden." };
  }

  try {
    await reviewClaim(claimId, statusRaw, notes || undefined);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't review this claim." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

export async function deleteClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const claimId = String(formData.get("claimId") ?? "");
  if (!claimId) return { error: "Missing claim." };

  try {
    await deleteClaim(claimId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't delete this claim." };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}
