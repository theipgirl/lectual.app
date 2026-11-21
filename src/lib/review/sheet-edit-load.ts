import "server-only";
import { listMatterStages } from "@/lib/matters/stages";
import { listStages } from "@/lib/pipeline/stages";
import { stageDisplayName } from "@/lib/matters/list-view";
import { sheetLeadStages, type StageChoice } from "./sheet-edit";

/**
 * The stage lists the owner's Sheet offers in its Status picker, read once per page through the scoped client (the same
 * two reads the opened record card makes per record). Each is its own state: a list that couldn't be read is null, and the Status
 * cells of that kind then get no editor (they never offer an empty or guessed list).
 */
export async function loadSheetStages(): Promise<{ matter: StageChoice[] | null; lead: StageChoice[] | null }> {
  const [matterS, leadS] = await Promise.allSettled([listMatterStages(), listStages()]);
  return {
    matter: matterS.status === "fulfilled" ? matterS.value.map((s) => ({ id: s.id, name: stageDisplayName(s.label) })) : null,
    // Names as a person reads them (no "3." code), the same words the Status cells show.
    lead: leadS.status === "fulfilled" ? sheetLeadStages(leadS.value).map((s) => ({ ...s, name: stageDisplayName(s.name) })) : null,
  };
}
