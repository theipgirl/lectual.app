import "server-only";

import { safeHttpsUrl } from "@/components/client-proposal/format";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { firmDisplayName } from "@/lib/proposals/commitment";
import { logSignedMismatch } from "@/lib/proposals/signed-mismatch-log";
import { agreementTextSha256 } from "../fingerprint";
import { consentSha256 } from "../signing-words";
import { signedLineText } from "../signing";
import { isObject, type SigningDb } from "./db";
import { verifyLinkPair, type VerifiedPair, type VerifyDeps } from "./verify";

/**
 * The `?sign=` page's read (Sprint A items 11-12). A GET can be an email security scanner, so this WRITES NOTHING: no `opened`
 * evidence, no close (the browser posts `recordOpenedAction` after the pair is verified). It runs `verifyLinkPair`, then reads
 * the firm's name and zone (a failed read is unavailable: the done line is timed in the firm's zone), and draws the request's
 * STORED agreement text only after checking it against its stored sha256 (a mismatch is unavailable and one log line).
 *
 * What reaches the browser: the letter as plain paragraphs, the firm's own approved page words (consent line and text, the line
 * beside Sign, the line under the box), the sha256 of the consent text drawn, whether consent was already given, and on a signed
 * link the done line and the pay link. Never a token, an id, the address or the frozen name.
 */

export type SignLinkFirm = { name: string; slug: string; displayName: string };

export type SignLinkView = {
  title: string;
  paragraphs: string[];
  consentLine: string;
  consentText: string;
  /** sha256 of `consentText` as drawn: the consent action posts it back and 0117 checks it against the request's own. */
  consentSha256: string;
  consented: boolean;
  signLine: string;
  boxNote: string;
};

export type SignLinkRead =
  | { kind: "unavailable" }
  | { kind: "open"; firm: SignLinkFirm; view: SignLinkView }
  | { kind: "signed"; firm: SignLinkFirm; signedLine: string; payUrl: string | null };

export async function readFirm(db: SigningDb, orgId: string): Promise<(SignLinkFirm & { timeZone: string }) | null> {
  const [org, profile] = await Promise.all([
    db.from("crm_org").select("name, slug, modules").eq("id", orgId).maybeSingle(),
    db.from("crm_org_profile").select("time_zone, display_name").eq("org_id", orgId).maybeSingle(),
  ]);
  if (org.error || !isObject(org.data) || typeof org.data.name !== "string" || !org.data.name.trim()) return null;
  // The firm's proposals switch is the switch for every link it issued (as on `/p/`).
  if (!Array.isArray(org.data.modules) || !org.data.modules.includes("proposals")) return null;
  if (profile.error && profile.error.code !== "PGRST116") return null;
  const p = isObject(profile.data) ? profile.data : null;
  const name = org.data.name;
  return {
    name,
    slug: typeof org.data.slug === "string" ? org.data.slug : "",
    displayName: firmDisplayName(p && typeof p.display_name === "string" ? p.display_name : null, name),
    timeZone: resolveTimeZone(p && typeof p.time_zone === "string" ? p.time_zone : null),
  };
}

/** The stored final text as plain paragraphs (like `storedSignedLetterView`): one per blank-line block. */
export function storedParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).filter((p) => p.length > 0);
}

export async function readSigningLink(publicToken: string, signToken: string, deps: VerifyDeps): Promise<SignLinkRead> {
  try {
    const pair: VerifiedPair = await verifyLinkPair(publicToken, signToken, deps);
    if (!pair.ok) return { kind: "unavailable" };
    const firm = await readFirm(deps.db, pair.proposal.org_id);
    if (!firm) return { kind: "unavailable" };
    const { request, proposal } = pair;
    const { timeZone, ...shown } = firm;

    if (pair.state === "signed") {
      const signedAt = request.signed_at ?? proposal.accepted_snapshot?.agreement?.signed_at ?? null;
      if (!signedAt) return { kind: "unavailable" };
      return { kind: "signed", firm: shown, signedLine: signedLineText(signedAt, timeZone, request.signer_name), payUrl: safeHttpsUrl(proposal.pay_url) };
    }

    if (agreementTextSha256(request.agreement_text) !== request.agreement_sha256) {
      logSignedMismatch(request.proposal_id, "signing_link");
      return { kind: "unavailable" };
    }
    return {
      kind: "open",
      firm: shown,
      view: {
        title: proposal.content.loe?.title || "Engagement letter",
        paragraphs: storedParagraphs(request.agreement_text),
        consentLine: request.consent_line,
        consentText: request.consent_text,
        consentSha256: consentSha256(request.consent_text),
        consented: request.consent_at !== null,
        signLine: request.sign_line,
        boxNote: request.box_note,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
