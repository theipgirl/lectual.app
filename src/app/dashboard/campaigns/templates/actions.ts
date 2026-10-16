"use server";

import { revalidatePath } from "next/cache";
import { createTemplate } from "@/lib/automation/drips";
import { friendlyCampaignError, type ActionState } from "../errors";

/**
 * Creates an email template. `createTemplate` (src/lib/automation/drips.ts)
 * re-checks the automation admin gate itself — this only turns a thrown
 * Error into a readable ActionState, same split as every other campaign
 * action.
 */
export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyHtml = String(formData.get("bodyHtml") ?? "").trim();
  const bodyText = String(formData.get("bodyText") ?? "").trim();
  const variablesRaw = String(formData.get("variables") ?? "");

  if (!name) return { error: "Enter a name for this template." };
  if (!subject) return { error: "Enter a subject line." };
  if (!bodyHtml) return { error: "Enter the email body." };

  const variables = variablesRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    await createTemplate({ name, subject, bodyHtml, bodyText: bodyText || undefined, variables });
  } catch (err) {
    return { error: friendlyCampaignError(err, "Couldn't create this template.") };
  }

  revalidatePath("/dashboard/campaigns/templates/");
  return {};
}
