/**
 * Proposals made before the builder existed: fixed pages served by the old `lectual` app on the
 * firm's proposals domain (`proposals.rpblawfirm.com/<id>/`, built by the lectual-plugin's
 * build_proposal_page.py, accepted through lawmatics-mcp). They are not `client_proposal` rows, so
 * the list cannot track them; it only links to them, with their link unchanged, because the client
 * already has it (Taylor, Oct 30).
 *
 * Keyed by org id and fail closed: a firm with no entry sees nothing, and one firm never sees
 * another's clients. Add an entry only for a page that exists in lectual's `public/proposals/`.
 */

export type LegacyProposal = {
  client: string;
  company: string | null;
  /** The page as the client has it. https, on the firm's own proposals domain. */
  url: string;
  /** As printed on the page. */
  date: string;
  expires: string;
  leadId: string | null;
};

const RPB_ORG_ID = "11111111-1111-1111-1111-111111111111";

export const LEGACY_PROPOSALS_BY_ORG: Readonly<Record<string, readonly LegacyProposal[]>> = {
  [RPB_ORG_ID]: [
    {
      client: "Sevetri Wilson",
      company: "Prosperall",
      url: "https://proposals.rpblawfirm.com/prosperall-ojvfsf5ivxlu/",
      date: "Oct 16, 2026",
      expires: "Oct 26, 2026",
      leadId: "1d0d9e21-a9f8-4ef9-84f4-717f95611d6c",
    },
  ],
};

const SAFE_URL = /^https:\/\/proposals\.[a-z0-9-]+(\.[a-z0-9-]+)+\/[a-z0-9-]+\/$/;

/** The firm's older proposals; an unknown or missing org, or a malformed entry, gives nothing. */
export function legacyProposalsFor(orgId: string | null | undefined): LegacyProposal[] {
  if (!orgId) return [];
  return (LEGACY_PROPOSALS_BY_ORG[orgId] ?? []).filter((p) => SAFE_URL.test(p.url));
}
