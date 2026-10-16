"use server";

import { revalidatePath } from "next/cache";
import { createMatterIntakeRequest, IntakeRequestError, revokeMatterIntakeRequest } from "@/lib/intake-forms/requests";

/**
 * "Send intake questions" on a matter. Each action is its own POST entry
 * point: the role and the matter are re-checked in requests.ts on every call
 * (scoped client, RLS), and nothing but the ids comes from the browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IntakeRequestActionState = { error?: string; token?: string };

function friendly(e: unknown, fallback: string): string {
  return e instanceof IntakeRequestError ? e.message : fallback;
}

export async function createIntakeRequestAction(matterId: string): Promise<IntakeRequestActionState> {
  if (typeof matterId !== "string" || !UUID.test(matterId)) return { error: "That matter isn't available." };
  try {
    const token = await createMatterIntakeRequest(matterId);
    revalidatePath(`/dashboard/matters/${matterId}/`);
    return { token };
  } catch (e) {
    return { error: friendly(e, "The link couldn't be created. Nothing was sent. Try again.") };
  }
}

export async function revokeIntakeRequestAction(matterId: string, requestId: string): Promise<IntakeRequestActionState> {
  if (typeof matterId !== "string" || !UUID.test(matterId) || typeof requestId !== "string" || !UUID.test(requestId)) {
    return { error: "That link isn't available." };
  }
  try {
    await revokeMatterIntakeRequest(matterId, requestId);
    revalidatePath(`/dashboard/matters/${matterId}/`);
    return {};
  } catch (e) {
    return { error: friendly(e, "The link couldn't be withdrawn. Try again.") };
  }
}
