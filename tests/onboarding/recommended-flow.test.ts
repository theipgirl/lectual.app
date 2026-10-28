import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { hubTracks, recommendedFlow } from "@/lib/onboarding/hub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/onboarding/hub-actions", () => ({ resetHubProgressAction: async () => {}, pickHubRecordsAction: async () => ({}) }));

import { FlowList } from "@/components/onboarding/FlowList";

const tracks = hubTracks({ role: "owner", modules: ["mailbox", "agents", "proposals", "document-center", "agent-toolkit"], aiConfigured: true });
const flows = tracks.flatMap((t) => t.flows);
const picks = { lead: { status: "none" }, matter: { status: "none" } } as never;

describe("recommendedFlow (F11)", () => {
  it("is the first flow of the first visible track when nothing is done", () => {
    expect(recommendedFlow(tracks, [])?.id).toBe(tracks[0].flows[0].id);
  });

  it("moves to the next undone flow as guides are finished", () => {
    expect(recommendedFlow(tracks, [flows[0].id])?.id).toBe(flows[1].id);
    expect(recommendedFlow(tracks, [flows[1].id])?.id).toBe(flows[0].id);
  });

  it("moves on to the next track once the first is finished, and is null when everything is done", () => {
    const firstDone = tracks[0].flows.map((f) => f.id);
    expect(recommendedFlow(tracks, firstDone)?.id).toBe(tracks[1].flows[0].id);
    expect(recommendedFlow(tracks, flows.map((f) => f.id))).toBeNull();
    expect(recommendedFlow([], [])).toBeNull();
  });

  it("only chooses what to emphasise: it hides nothing", () => {
    const owner = hubTracks({ role: "owner", modules: [], aiConfigured: false });
    expect(owner.flatMap((t) => t.flows).length).toBeGreaterThan(0);
    expect(readFileSync("src/lib/onboarding/hub.ts", "utf8")).toContain("hides nothing");
  });
});

describe("one primary Start (P5)", () => {
  const html = (done: string[]) => renderToStaticMarkup(createElement(FlowList, { tracks, doneIds: done, picks, modulesUnreadable: false }));
  const buttons = (h: string) => [...h.matchAll(/<button type="button" class="lx-btn lx-btn-sm (lx-btn-(?:pri|sec))"[^>]*aria-label="([^"]+)"/g)].map((m) => ({ tone: m[1], label: m[2] }));

  it("only the recommended flow has the primary button, and says Start here", () => {
    const h = html([]);
    const all = buttons(h).filter((b) => /^(Start|Run again):/.test(b.label));
    expect(all.filter((b) => b.tone === "lx-btn-pri")).toEqual([{ tone: "lx-btn-pri", label: `Start: ${flows[0].title}` }]);
    expect(all.filter((b) => b.tone === "lx-btn-sec")).toHaveLength(flows.length - 1);
    expect(h.match(/Start here/g)).toHaveLength(1);
  });

  it("when everything is done there is no primary button", () => {
    const h = html(flows.map((f) => f.id));
    expect(buttons(h).filter((b) => b.tone === "lx-btn-pri" && /^(Start|Run again):/.test(b.label))).toEqual([]);
    expect(h).not.toContain("Start here");
  });

  it("a finished flow reads Run again and is secondary", () => {
    const h = html([flows[0].id]);
    expect(buttons(h).find((b) => b.label === `Run again: ${flows[0].title}`)?.tone).toBe("lx-btn-sec");
  });
});
