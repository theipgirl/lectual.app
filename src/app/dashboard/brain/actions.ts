"use server";

import { revalidatePath } from "next/cache";
import {
  createBrainEntry,
  listBrainEntries,
  updateBrainEntry,
  deleteBrainEntry,
  proposeClaim,
  reviewClaim,
  deleteClaim,
} from "@/lib/brain";
import { listStages } from "@/lib/pipeline/stages";
import { generateEntryKey } from "@/lib/brain/entry-key";
import { isSignalId, SIGNAL_LABEL } from "@/lib/stage-keeper/signals";
import { entryTypeOf, isClaimStatus } from "./enums";

export type ActionState = { error?: string };

/**
 * Only the permission refusals written for a person pass through; anything else (a database
 * message, a thrown string) becomes the fixed fallback, so provider text never reaches the screen.
 */
function friendlyBrainError(err: unknown, fallback: string): string {
  if (err instanceof Error && /^You don't have permission to /.test(err.message)) return err.message;
  return fallback;
}

const BRAIN_PATH = "/dashboard/brain/";

// ── Brain entries ────────────────────────────────────────────────────────────
// Every write below is admin-gated inside @/lib/brain (requireBrainAdminRole)
// and, ultimately, by RLS — this file only shapes form input and turns a
// thrown error into a friendly ActionState.

export async function createBrainEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A posted "key" or "category" is ignored on purpose: the Type decides both.
  const type = entryTypeOf(String(formData.get("entryType") ?? ""));
  const titleRaw = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!type) return { error: "Choose a type." };

  try {
    if (type.value === "stage_rules") return await createStageRule(formData, titleRaw);
    if (!titleRaw) return { error: "Enter a title." };
    await createBrainEntry({
      category: type.category,
      key: generateEntryKey(type.value, titleRaw),
      title: titleRaw,
      body,
    });
  } catch (err) {
    return { error: friendlyBrainError(err, "Couldn't create this entry.") };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}

/**
 * A stage rule's key is the signal id the Stage Keeper reads, and its stage is one of the firm's live
 * stages. Both are re-validated here: the browser only offers lists, it is not trusted.
 */
async function createStageRule(formData: FormData, titleRaw: string): Promise<ActionState> {
  const signal = String(formData.get("signal") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  if (!isSignalId(signal)) return { error: "Choose what happened." };

  let stages: Awaited<ReturnType<typeof listStages>>;
  try {
    stages = await listStages();
  } catch {
    return { error: "Your stages couldn't be loaded, so a stage rule can't be saved right now." };
  }
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { error: "Choose one of your stages." };

  let existing: Awaited<ReturnType<typeof listBrainEntries>>;
  try {
    existing = await listBrainEntries("stage_mapping");
  } catch {
    return { error: "Your existing rules couldn't be loaded, so a new one can't be saved right now." };
  }
  if (existing.some((e) => e.key.trim().toLowerCase() === signal)) {
    return { error: `There's already a rule for ${SIGNAL_LABEL[signal]}. Edit that one.` };
  }

  await createBrainEntry({
    category: "stage_mapping",
    key: signal,
    title: titleRaw || `${SIGNAL_LABEL[signal]} rule`,
    body: stage.name,
    data: { stage: stage.name },
  });
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
    return { error: friendlyBrainError(err, "Couldn't update this entry.") };
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
    return { error: friendlyBrainError(err, "Couldn't delete this entry.") };
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
    return { error: friendlyBrainError(err, "Couldn't propose this claim.") };
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
    return { error: friendlyBrainError(err, "Couldn't review this claim.") };
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
    return { error: friendlyBrainError(err, "Couldn't delete this claim.") };
  }

  revalidatePath(BRAIN_PATH);
  return {};
}
