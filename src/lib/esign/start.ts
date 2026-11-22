import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { getSiteOrigin } from "@/lib/site-origin";
import { clientLinkOrigin } from "@/lib/proposals/client-link-origin";
import type { PublicProposalsDb } from "@/lib/proposals/public";
import { letterLiveCheck } from "@/lib/loe/live-guard";
import { buildLetterPdf } from "@/lib/loe/pdf";
import { letterLogoForSlug } from "@/lib/loe/letter-logo";
import { ADOBE_SIGN_HERE_INSTEAD } from "@/lib/loe/client-words";
import { adobeClientSigningOn, adobeSignSetup } from "./adobe-config";
import { loadAdobeAccess, markAdobeReauth } from "./adobe-connection";
import type { EsignDb } from "./db";
import { WEBHOOK_PATH } from "./payload";
import { runStartAdobeSigning, type StartInput, type StartResult } from "./start-core";

export type { StartResult } from "./start-core";

/**
 * The production wiring of `runStartAdobeSigning` (see `start-core.ts` for the rules). The service role is used here, fenced on
 * the proposal row's own org; the firm's own Adobe tokens, never a deployment-wide one. Never throws, never logs.
 */
export async function startAdobeSigning(input: StartInput, now: Date = new Date()): Promise<StartResult> {
  try {
    const setup = adobeSignSetup();
    if (!setup.ready) return { ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD };
    const admin = getAdminClient();
    const db = admin as unknown as EsignDb & PublicProposalsDb;
    const site = (await getSiteOrigin()).replace(/\/$/, "");
    return await runStartAdobeSigning(input, {
      now,
      switchOn: adobeClientSigningOn(),
      db,
      access: (orgId, connectionId) => loadAdobeAccess({ db, orgId, connectionId, root: setup.root, creds: setup.creds, now }),
      markReauth: (orgId, connectionId) => markAdobeReauth(db, orgId, connectionId),
      fetchImpl: globalThis.fetch.bind(globalThis),
      renderPdf: (p) =>
        buildLetterPdf({
          blocks: p.blocks,
          exhibit: p.exhibit,
          details: p.details,
          mode: "for-signature",
          firmName: p.firmName,
          logo: letterLogoForSlug(p.firmSlug),
          title: p.title,
        }),
      letterCurrent: (row) => letterLiveCheck(admin, row),
      linkOrigin: clientLinkOrigin,
      webhookUrl: `${site}${WEBHOOK_PATH}`,
    });
  } catch {
    return { ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD };
  }
}
