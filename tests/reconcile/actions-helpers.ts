import { vi } from "vitest";
import type { LawmaticsClient } from "../../src/lib/lawmatics/client";
import { sheetKeyFor } from "../../src/lib/intake/sheet-import";
import type { Row } from "../matters/helpers/fake-db";
import { S, fixtureBytes } from "./helpers";
import { L, lawmaticsStub, leadRow, type World } from "./world";

export const key = (owner: string, mark: string | null, code: string) => sheetKeyFor({ ownerName: owner, markText: mark, stageCode: code });

/** Leads that line up with the fixture sheet. */
export function fixtureLeads(): Row[] {
  return [
    leadRow({ id: L.amara, first_name: "Amara", last_name: "Nwosu", email: "amara@example.com", current_stage_id: S.followUp, sheet_key: key("Amara Nwosu", null, "1") }),
    leadRow({ id: L.priya, first_name: "Priya", last_name: "Raman", email: "priya@example.com", current_stage_id: S.prelim, sheet_key: key("Priya Raman", "Saffron Lane", "2") }),
    leadRow({ id: L.margo, first_name: "Margo", last_name: "Delacroix", email: "margo@example.com", current_stage_id: S.pnc, sheet_key: key("Marguerite (Margo) Delacroix", "Château Bellerive", "3"), lawmatics_id: "200" }),
    leadRow({ id: L.desmond, first_name: "Desmond", last_name: "Okafor", email: "desmond@example.com", current_stage_id: S.pnc, sheet_key: key("Desmond Okafor", "Iron Fig", "4") }),
    leadRow({ id: L.hollis, first_name: "Hollis", last_name: "Vance", email: "hollis@example.com", current_stage_id: S.pnc, sheet_key: key("Hollis Vance", "Nine Lantern", "6") }),
  ];
}

export function csvFile(name = "sheet.csv", bytes: Uint8Array | string = fixtureBytes()): File {
  return new File([bytes as BlobPart], name, { type: "text/csv" });
}

export function formWith(file: unknown): FormData {
  // A real FormData turns anything that is not a Blob into a string, so a stand-in upload
  // (a large file we don't want to build) is handed over through a minimal get().
  if (file !== undefined && !(file instanceof Blob)) return { get: (name: string) => (name === "sheet" ? file : null) } as unknown as FormData;
  const form = new FormData();
  if (file !== undefined) form.set("sheet", file as Blob);
  return form;
}

/** Anything the action can call `.name`, `.size` and `.text()` on, to stand in for a large upload. */
export function fakeUpload(name: string, size: number, text = "") {
  const read = vi.fn(async () => text);
  return { name, size, text: read, read };
}

export type LoadOptions = {
  lawmatics?: ReturnType<typeof lawmaticsStub> | "not-connected" | "throws";
};

export async function loadActions(world: World, opts: LoadOptions = {}) {
  vi.resetModules();
  const revalidated: string[] = [];
  const clientFactory = vi.fn(async (): Promise<LawmaticsClient> => {
    const { LawmaticsNotConnectedError } = await import("../../src/lib/lawmatics/connection");
    if (opts.lawmatics === "not-connected") throw new LawmaticsNotConnectedError();
    if (opts.lawmatics === "throws") throw new Error("SECRET-constraint-crm_lead_pkey-org-9f8e7d");
    return (opts.lawmatics ?? lawmaticsStub()).client;
  });
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  vi.doMock("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
  vi.doMock("@/lib/lawmatics/connection", async (orig) => ({
    ...(await orig<typeof import("../../src/lib/lawmatics/connection")>()),
    firmLawmaticsClient: clientFactory,
  }));
  vi.doMock("@/lib/pipeline", async (orig) => {
    const actual = await orig<typeof import("../../src/lib/pipeline")>();
    return { ...actual, moveLeadStage: vi.fn(actual.moveLeadStage) };
  });
  const actions = await import("../../src/app/dashboard/intake/reconcile/actions");
  const pipeline = await import("../../src/lib/pipeline");
  return { ...actions, revalidated, clientFactory, move: pipeline.moveLeadStage as unknown as ReturnType<typeof vi.fn> };
}
