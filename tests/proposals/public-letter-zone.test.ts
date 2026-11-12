import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDF_MESSAGES } from "@/lib/loe/client-words";
import { reviewLetterPdf, signedLetterPdf } from "@/lib/proposals/public-letter";
import { acceptPublicProposal, readPublicProposal, type PublicProposalsDb } from "@/lib/proposals/public";
import { defaultSelection } from "@/lib/proposals/pricing";
import { sevetri } from "./fixture";
import type { Row } from "./public-db-double";
import { TEST_DETAILS } from "../loe/full-letter-fixture";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn<(db: unknown, input: { proposalId: string; orgId: string }) => Promise<void>>(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

beforeEach(() => {
  mocks.after.mockReset();
  mocks.runAcceptanceFollowups.mockReset();
  mocks.runAcceptanceFollowups.mockResolvedValue(undefined);
});

import { NOW, TOKEN, browserSigning, world } from "./signing-world";

/**
 * Review item 7, on the client's own path. An engagement letter is dated and (once signed) timed in the FIRM's zone and carries
 * the firm's name. If the firm's profile cannot be read those are guesses, so a proposal that carries a letter answers
 * "unavailable" (the page says try again) instead of dating, signing or printing anything in a guessed zone. A proposal without
 * a letter is unchanged: there the zone only moves a date label.
 */

/** The same fake database, with every read of one table failing. */
function failing(db: PublicProposalsDb, table: string): PublicProposalsDb {
  const refused = { data: null, error: { code: "XX000", message: "connection refused" } };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve(refused),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(refused).then(resolve),
  };
  return { ...db, from: (t: string) => (t === table ? (q as never) : db.from(t)) } as PublicProposalsDb;
}

describe("a proposal that carries a letter, when the firm's profile cannot be read", () => {
  it("the page read is unavailable: never a letter dated in a guessed zone", async () => {
    const w = world();
    expect((await readPublicProposal(TOKEN, NOW, w.db)).status).toBe("ok");
    expect(await readPublicProposal(TOKEN, NOW, failing(w.db, "crm_org_profile"))).toEqual({ status: "unavailable" });
  });

  it("signing is refused and nothing is written", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, failing(w.db, "crm_org_profile"), undefined, b.signing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unavailable");
    expect(w.rpcCalls).toHaveLength(0);
    expect((w.tables.client_proposal[0] as Row).status).toBe("sent");
  });

  it("neither PDF is built", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    expect(await reviewLetterPdf(TOKEN, b.selection, undefined, TEST_DETAILS, NOW, { db: failing(w.db, "crm_org_profile"), ip: "198.51.100.77" })).toEqual({ ok: false, message: PDF_MESSAGES.unavailable });
    expect((await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing)).ok).toBe(true);
    // Signed. With the profile readable the signed PDF builds; with it unreadable there is no file (no guessed zone on the signature record).
    expect((await signedLetterPdf(TOKEN, NOW, { db: w.db })).ok).toBe(true);
    expect(await signedLetterPdf(TOKEN, NOW, { db: failing(w.db, "crm_org_profile") })).toEqual({ ok: false, message: PDF_MESSAGES.unavailable });
  });

  it("a firm that has NO profile row is a real answer, not a failed read: the letter is dated in the standard zone", async () => {
    const w = world();
    w.tables.crm_org_profile.length = 0;
    const read = await readPublicProposal(TOKEN, NOW, w.db);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.view.letter?.dateText).toBe("October 20, 2026");
  });
});

describe("a proposal with no letter is unchanged", () => {
  it("still reads and accepts when the profile read fails (the zone only moves a date label there)", async () => {
    const w = world({ content: sevetri() });
    const db = failing(w.db, "crm_org_profile");
    const read = await readPublicProposal(TOKEN, NOW, db);
    expect(read.status).toBe("ok");
    expect((await acceptPublicProposal(TOKEN, defaultSelection(sevetri()), NOW, db)).ok).toBe(true);
  });
});
