import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runCreateLink, type CreateLinkDeps } from "@/lib/proposal-editor/create-link";
import { LETTER_CHANGED_SENTENCE, LETTER_UNREADABLE_SENTENCE, LINK_CREATED } from "@/lib/proposal-editor/vocabulary";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import type { LetterCopyCheck } from "@/lib/loe/editor-state";

/** P1b: create-link re-checks the letter copy against the firm's approved version AFTER the save, and refuses with a fixed sentence before approve or send. */

const row = {} as never;

function deps(check: ((id: string) => Promise<LetterCopyCheck>) | undefined, over: Partial<CreateLinkDeps> = {}) {
  const calls: string[] = [];
  const d: CreateLinkDeps = {
    gate: vi.fn(async () => (calls.push("gate"), null)),
    save: vi.fn(async () => (calls.push("save"), { saved: true })),
    ...(check ? { letterCurrent: vi.fn(async (id: string) => (calls.push("letter"), check(id))) } : {}),
    approve: vi.fn(async () => (calls.push("approve"), row)),
    makeLive: vi.fn(async () => (calls.push("live"), row)),
    describe: proposalActionError,
    revalidate: vi.fn(),
    ...over,
  };
  return { d, calls };
}

describe("create link with an engagement letter on the proposal", () => {
  it("a stale copy (the firm approved another version) refuses with the fixed sentence; approve and makeLive are never called", async () => {
    const { d, calls } = deps(async () => "stale");
    const r = await runCreateLink(d, "p1");
    expect(r).toEqual({ error: LETTER_CHANGED_SENTENCE });
    expect(d.approve).not.toHaveBeenCalled();
    expect(d.makeLive).not.toHaveBeenCalled();
    expect(calls).toEqual(["gate", "letter"]);
    // One sentence for every make-live path (review item 5), so it does not assume the page has unsaved changes.
    expect(LETTER_CHANGED_SENTENCE).toContain("save it again");
  });

  it("an unreadable approved-letter read refuses with its own fixed sentence, before approve or send", async () => {
    const { d } = deps(async () => "unreadable");
    const r = await runCreateLink(d, "p1");
    expect(r).toEqual({ error: LETTER_UNREADABLE_SENTENCE });
    expect(LETTER_UNREADABLE_SENTENCE).not.toBe(LETTER_CHANGED_SENTENCE);
    expect(d.approve).not.toHaveBeenCalled();
    expect(d.makeLive).not.toHaveBeenCalled();
  });

  it("a check that throws is read as unreadable, never as current (the error text is not shown)", async () => {
    const { d } = deps(async () => {
      throw new Error("db down: sevetri@example.com");
    });
    const r = await runCreateLink(d, "p1");
    expect(r).toEqual({ error: LETTER_UNREADABLE_SENTENCE });
    expect(JSON.stringify(r)).not.toContain("sevetri");
  });

  it("a matching copy proceeds exactly as today: approve then makeLive", async () => {
    const { d, calls } = deps(async () => "current");
    const r = await runCreateLink(d, "p1");
    expect(r).toEqual({ saved: true, notice: LINK_CREATED });
    expect(calls).toEqual(["gate", "letter", "approve", "live"]);
  });

  it("content without a letter proceeds exactly as today", async () => {
    const { d, calls } = deps(async () => "no_letter");
    const r = await runCreateLink(d, "p1");
    expect(r.saved).toBe(true);
    expect(calls).toEqual(["gate", "letter", "approve", "live"]);
  });

  it("with unsaved changes the save runs FIRST, so a Save that refreshed the copy passes the check", async () => {
    const { d, calls } = deps(async () => "current");
    const form = new FormData();
    await runCreateLink(d, "p1", { dirty: true, form });
    expect(calls).toEqual(["gate", "save", "letter", "approve", "live"]);
  });

  it("a refused save stops before the letter check", async () => {
    const { d, calls } = deps(async () => "stale", { save: vi.fn(async () => ({ error: "Who: enter a name." })) });
    const r = await runCreateLink(d, "p1", { dirty: true, form: new FormData() });
    expect(r).toEqual({ error: "Who: enter a name." });
    expect(calls).toEqual(["gate"]);
  });

  it("callers that pass no check behave exactly as before", async () => {
    const { d, calls } = deps(undefined);
    const r = await runCreateLink(d, "p1");
    expect(r.saved).toBe(true);
    expect(calls).toEqual(["gate", "approve", "live"]);
  });

  it("the real action wires the check (module and role first, then the approved letter through the scoped client)", () => {
    const src = readFileSync("src/app/dashboard/proposals/[id]/actions.ts", "utf8");
    expect(src).toMatch(/letterCurrent:\s*async/);
    // The check is the ONE make-live guard (review item 5), the same one `sendProposal` runs.
    expect(src).toContain("letterLiveCheck(await getScopedClient(), row)");
    const guard = readFileSync("src/lib/loe/live-guard.ts", "utf8");
    expect(guard).toContain("letterCopyCheck(");
    expect(guard).toContain("getApprovedLetter(");
  });
});
