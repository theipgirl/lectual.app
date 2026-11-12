import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { SIGNATURE_READ_ROLES, canReadSignature } from "@/lib/loe/signature-roles";
import { buildSignedCard } from "@/lib/loe/signed-card";
import type { SignatureRead } from "@/lib/loe/signature-read";
import { SIGNED_CARD_UNAVAILABLE } from "@/lib/ui/words";
import { acceptedSnapshot } from "../proposals/accepted-fixture";
import { FINGERPRINT, signedTrademark } from "./signed-fixtures";

/**
 * Review item 11. The database lets only the staff roles read `client_proposal_signature`; a viewer or social media reads
 * nothing. The app holds that list in ONE place and never asks a question whose honest answer the database would hide.
 */

const OK: SignatureRead = {
  status: "ok",
  signature: { id: "sig-1", signerName: "Sevetri Wilson", signedAt: "2026-11-12T19:14:00.000Z", fingerprint: FINGERPRINT, entityName: "Prosperall Inc.", signerTitle: "Founder", templateVersion: 3 },
};

/** The card as the page builds it for a role: the read is attempted only for a role that may read signatures. */
function cardFor(role: Role, read: SignatureRead = OK) {
  const may = canReadSignature(role);
  return buildSignedCard({
    proposalId: "p1",
    status: "accepted",
    snapshot: signedTrademark(),
    signature: may ? read : null,
    events: [],
    tz: "America/New_York",
    canRetry: false,
    canDownload: may,
  });
}

describe("the one list", () => {
  it("is exactly the eight staff roles the database policy names", () => {
    expect([...SIGNATURE_READ_ROLES]).toEqual(["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"]);
  });

  it("fails closed: viewer, social media, no role and an unknown role read nothing", () => {
    expect(canReadSignature("viewer")).toBe(false);
    expect(canReadSignature("social_media")).toBe(false);
    expect(canReadSignature(null)).toBe(false);
    expect(canReadSignature(undefined)).toBe(false);
    expect(canReadSignature("stranger" as Role)).toBe(false);
    for (const r of ROLES) expect(canReadSignature(r), r).toBe(!["viewer", "social_media"].includes(r));
  });

  it("is written down once: no other file lists the roles for a signature read, and the page, the card and the download gate use it", () => {
    const page = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/[id]/page.tsx"), "utf8");
    expect(page).toContain("const mayReadSignature = canReadSignature(session.role);");
    expect(page).toMatch(/proposal\.status === "accepted" && content\.loe && mayReadSignature\s*\?\s*getScopedClient\(\)\.then\(\s*\(db\) => readSignature\(db, proposal\.id\)/);
    expect(page).toContain("canDownload: mayReadSignature,");
    const gate = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/gate.ts"), "utf8");
    expect(gate).toContain("canReadSignature(await currentRole())");
    const action = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/[id]/signed-letter-actions.ts"), "utf8");
    expect(action).toContain("gate: gateSignedLetterDownload");
  });

  it("only the staff page's card, the lead/matter mailing-address reader (role-gated by loadSignedAddress) and the signed-PDF's stored-text reader touch the signature table: the proposals list never does", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && /from\("client_proposal_signature"\)/.test(readFileSync(path, "utf8"))) hits.push(path.replace(`${process.cwd()}/`, ""));
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits.sort()).toEqual(["src/lib/loe/signature-read.ts", "src/lib/loe/signed-address.ts", "src/lib/loe/stored-agreement.ts"]);
    expect(readFileSync(join(process.cwd(), "src/lib/loe/signed-address.ts"), "utf8")).toContain("if (!canReadSignature(role)) return null;");
    // The list's "Signed Oct 21" comes from the accepted snapshot (`isSignedSnapshot`), not from a signature read.
    for (const f of ["src/app/dashboard/proposals/page.tsx", "src/lib/proposals/list-rows.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/readSignature|client_proposal_signature|signature-read/);
    }
  });
});

describe("the staff card, by role", () => {
  for (const role of ["viewer", "social_media"] as const) {
    it(`${role}: who signed and when, from the accepted snapshot; no Download, no fingerprint, no filing state`, () => {
      const card = cardFor(role);
      expect(card).toEqual({ kind: "summary", text: "Signed by Sevetri Wilson on November 12, 2026 at 2:14 PM EST" });
      expect(JSON.stringify(card)).not.toContain(FINGERPRINT);
    });

    it(`${role}: the same line whatever the database would have answered (it is never asked)`, () => {
      for (const read of [{ status: "none" }, { status: "unavailable" }] as SignatureRead[]) {
        expect(cardFor(role, read)).toEqual({ kind: "summary", text: "Signed by Sevetri Wilson on November 12, 2026 at 2:14 PM EST" });
      }
    });
  }

  for (const role of ["paralegal", "owner"] as const) {
    it(`${role}: the signature row is the source: signer, zone-named time, fingerprint and Download`, () => {
      const card = cardFor(role);
      expect(card).toMatchObject({ kind: "signed", signer: "Sevetri Wilson", signedLine: "Signed November 12, 2026 at 2:14 PM EST", fingerprint: FINGERPRINT, canDownload: true, fromStoredText: false });
    });

    it(`${role}: a read that returns nothing, or fails, is "couldn't be loaded": never "not signed", never a line made up from the snapshot`, () => {
      for (const read of [{ status: "none" }, { status: "unavailable" }] as SignatureRead[]) {
        const card = cardFor(role, read);
        expect(card).toEqual({ kind: "unavailable", text: SIGNED_CARD_UNAVAILABLE });
        expect(card?.kind === "unavailable" && card.text).not.toMatch(/not signed|wasn't found/i);
      }
    });
  }

  it("a snapshot with no usable agreement block is 'couldn't be loaded' for a viewer, not a blank Signed line", () => {
    const s = signedTrademark();
    const card = buildSignedCard({ proposalId: "p1", status: "accepted", snapshot: { ...s, agreement: undefined }, signature: null, events: [], tz: "UTC", canRetry: false, canDownload: false });
    expect(card).toEqual({ kind: "unavailable", text: SIGNED_CARD_UNAVAILABLE });
  });

  it("no card for a version that isn't accepted or carries no letter, whatever the role", () => {
    expect(buildSignedCard({ proposalId: "p1", status: "sent", snapshot: signedTrademark(), signature: null, events: [], tz: "UTC", canRetry: false, canDownload: false })).toBeNull();
    expect(buildSignedCard({ proposalId: "p1", status: "accepted", snapshot: acceptedSnapshot({ classes: 2 }), signature: OK, events: [], tz: "UTC", canRetry: true, canDownload: true })).toBeNull();
  });
});
