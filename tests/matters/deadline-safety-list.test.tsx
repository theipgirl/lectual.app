import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";

const stage: MatterStage = { id: "s1", code: "17", label: "17. Application Filed", order_index: 17, is_open: true, waiting_on: "uspto" };
const m = (o: Partial<Matter> = {}) =>
  ({ id: "m1", matter_number: "TM-1", mark_text: "ACME", title: null, owner_name: "Dana", status: "open", type: "TM", serial_number: "97000001", filing_date: null, assigned_to: null, stage, stage_id: "s1", stage_entered_at: new Date().toISOString(), ...o }) as unknown as Matter;

const read = vi.hoisted(() => ({ result: { status: "ok", ids: new Set<string>() } as unknown, asked: [] as string[][] }));

async function render(matters: Matter[], view?: string) {
  vi.resetModules();
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("@/lib/matters")>()), listMatters: vi.fn(async () => matters) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => [stage]), loadMatterStages: vi.fn(async () => ({ status: "ok", stages: [stage] })) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/components/matters/MatterForms", () => ({ NewMatterForm: () => null }));
  vi.doMock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
  vi.doMock("@/lib/record-card/steps-read", () => ({ loadOpenSteps: vi.fn(async () => ({ status: "ok", value: new Map() })) }));
  vi.doMock("@/lib/matters/open-deadlines-read", () => ({
    loadOpenDeadlineMatterIds: vi.fn(async (ids: string[]) => {
      read.asked.push(ids);
      return read.result;
    }),
  }));
  const { default: MattersPage } = await import("../../src/app/dashboard/matters/page");
  return renderToStaticMarkup(await MattersPage({ searchParams: Promise.resolve({ view }) }));
}

beforeEach(() => {
  read.result = { status: "ok", ids: new Set<string>() };
  read.asked = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AT1 (Matters list): a filed TM matter with no open deadline shows 'No open deadline'", () => {
  for (const view of ["table", undefined]) {
    it(`flags it on the ${view ? "list" : "board (default)"} view; only filed TM matters are asked about`, async () => {
      const html = await render([m(), m({ id: "m2", matter_number: "TM-2", serial_number: null }), m({ id: "m3", matter_number: "CR-3", type: "CR" })], view);
      expect(read.asked).toEqual([["m1"]]);
      expect(html.match(/>No open deadline</g)).toHaveLength(1);
    });
  }

  it("a filed matter that holds an open deadline is not flagged", async () => {
    read.result = { status: "ok", ids: new Set(["m1"]) };
    expect(await render([m()], "table")).not.toContain(">No open deadline<");
  });
});

describe("AT2 (Matters list): a failed deadlines read flags nothing and says the deadlines couldn't load", () => {
  it("no flag, one notice", async () => {
    read.result = { status: "unavailable" };
    const html = (await render([m()], "table")).replaceAll("&#x27;", "'");
    expect(html).not.toContain(">No open deadline<");
    expect(html).toContain("Deadlines couldn't load, so filed matters weren't checked for a missing deadline.");
  });
});
