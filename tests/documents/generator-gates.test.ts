import { describe, it, expect, vi } from "vitest";

/**
 * The letter generators carry one firm's letterhead and attorney voice, so the
 * document-center module is the boundary. Page (segment layout) and every
 * action are checked separately: a POST never renders the layout.
 */
const gen = vi.hoisted(() => ({ calls: 0, modules: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => gen.modules.includes(m) }));
vi.mock("@/lib/documents/generate", () => {
  const hit = async () => {
    gen.calls += 1;
    return { queueItemId: "q1" };
  };
  return { generateTrademarkLoe: hit, generateGeneralLoe: hit, generateOpinionLetter: hit, generateTrademarkClearance: hit };
});

const { default: Layout } = await import("@/app/dashboard/documents/new/layout");
const { generateLoeAction } = await import("@/app/dashboard/documents/new/[matterId]/loe/actions");
const { generateOpinionLetterAction } = await import("@/app/dashboard/documents/new/[matterId]/opinion-letter/actions");
const { generateTrademarkClearanceAction } = await import("@/app/dashboard/documents/new/[matterId]/trademark-clearance/actions");

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("document-center gate", () => {
  it("the generator subtree is not found for a firm without the module", async () => {
    gen.modules = [];
    await expect(Layout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("every generator action refuses before generating anything", async () => {
    gen.modules = [];
    const base = { matterId: "m1", clientName: "Amara", kind: "general", scopeDescription: "x", feeStructure: "flat" };
    expect((await generateLoeAction({}, fd(base))).error).toMatch(/isn't available/);
    expect((await generateOpinionLetterAction({}, fd({ matterId: "m1" }))).error).toMatch(/isn't available/);
    expect((await generateTrademarkClearanceAction({}, fd({ matterId: "m1" }))).error).toMatch(/isn't available/);
    expect(gen.calls).toBe(0);
  });

  it("a firm with the module reaches the generator", async () => {
    gen.modules = ["document-center"];
    await expect(Layout({ children: null })).resolves.toBeTruthy();
    await expect(
      generateLoeAction({}, fd({ matterId: "m1", clientName: "Amara", kind: "general", scopeDescription: "Trademark filing", feeStructure: "Flat fee" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(gen.calls).toBe(1);
  });
});
