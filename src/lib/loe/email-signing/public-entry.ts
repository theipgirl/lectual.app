import "server-only";

import { notifyFirmOfAcceptance, publicProposalsDb, type PublicProposalsDb } from "@/lib/proposals/public";
import { parseInet } from "@/lib/quotes/public";
import { closeOnChange } from "./close-on-change";
import type { SigningDb } from "./db";
import { recordConsent, recordOpened, type ConsentResult } from "./link-actions";
import { readSigningLink, type SignLinkRead } from "./link-read";
import { sendSigningLink, type SendResult } from "./send";
import { signByLink, type SignResult } from "./sign";

/**
 * The emailed signing link's entry points for the anonymous `/p/[token]` route (its page and its server actions), over the public
 * module's own service-role client (`publicProposalsDb`), so the route files reach the database only through library code. Each
 * takes the tokens and the request's raw address and browser; everything else is decided inside. Never throws.
 */

export type RawAudit = { ip: string | null; userAgent: string | null };

function signingDb(): SigningDb {
  return publicProposalsDb() as unknown as SigningDb;
}

export function entrySendLink(token: string, selection: unknown, clientClasses: unknown, details: unknown, audit: RawAudit): Promise<SendResult> {
  return sendSigningLink({ token, selection, clientClasses, details, ip: audit.ip, now: new Date() });
}

export function entryCloseLink(token: string): Promise<{ closed: boolean }> {
  return closeOnChange(token, { now: new Date() });
}

export function entryReadLink(token: string, signToken: string, ip: string | null): Promise<SignLinkRead> {
  let db: SigningDb;
  try {
    db = signingDb();
  } catch {
    return Promise.resolve({ kind: "unavailable" });
  }
  return readSigningLink(token, signToken, { db, now: new Date(), ip });
}

export async function entryRecordOpened(token: string, signToken: string, audit: RawAudit): Promise<void> {
  try {
    await recordOpened(token, signToken, { db: signingDb(), now: new Date(), ip: audit.ip, audit: { ip: parseInet(audit.ip), userAgent: audit.userAgent } });
  } catch {
    // Silent by design.
  }
}

export function entryRecordConsent(token: string, signToken: string, consentSha256: unknown, audit: RawAudit): Promise<ConsentResult> {
  return recordConsent(token, signToken, consentSha256, { db: signingDb(), now: new Date(), ip: audit.ip, audit: { ip: parseInet(audit.ip), userAgent: audit.userAgent } });
}

export function entrySign(token: string, signToken: string, typedName: unknown, signature: unknown, audit: RawAudit): Promise<SignResult> {
  const db = signingDb();
  return signByLink(
    { publicToken: token, signToken, typedName, signature },
    {
      db,
      now: new Date(),
      ip: audit.ip,
      audit: { ip: parseInet(audit.ip), userAgent: audit.userAgent },
      notify: (input) => notifyFirmOfAcceptance(input, db as unknown as PublicProposalsDb),
    },
  );
}
