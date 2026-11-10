import "server-only";
import { listMatterStages } from "@/lib/matters/stages";
import { listStages } from "@/lib/pipeline/stages";
import { sheetLeadStages, type StageChoice } from "./sheet-edit";

/**
 * The stage lists the owner's Sheet offers in its Status picker, read once per page through the scoped client (the same
 * two reads the detail panel makes per record). Each is its own state: a list that couldn't be read is null, and the Status
 * cells of that kind then get no editor (they never offer an empty or guessed list).
 */
export async function loadSheetStages(): Promise<{ matter: StageChoice[] | null; lead: StageChoice[] | null }> {
  const [matterS, leadS] = await Promise.allSettled([listMatterStages(), listStages()]);
  return {
    matter: matterS.status === "fulfilled" ? matterS.value.map((s) => ({ id: s.id, name: s.label })) : null,
    lead: leadS.status === "fulfilled" ? sheetLeadStages(leadS.value) : null,
  };
}
