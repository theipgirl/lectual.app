/** Sample proposals for the mono screens (invented names). Built on the tests' own content fixture. */
import { sevetri } from "../../tests/proposals/fixture";
import type { ProposalRow, ProposalEventRow } from "@/lib/proposals/types";
import type { ProposalListItem, ProposalDetail } from "@/lib/proposals/store";
import { ORG, OWNER_ID } from "./fixtures";
import { L } from "./mono-data";

const pid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).padStart(12, "0")}`;
export const P = { crumb: pid(1), halcyon: pid(2), lumen: pid(3), oat: pid(4), north: pid(5), moon: pid(6) };

function content() {
  const c = sevetri();
  c.client = { first_name: "Maya", full_name: "Maya Chen", company: "CRUMB & CO." };
  c.greeting = "Hi Maya, thank you again for meeting with us for your strategy call. Your proposal is outlined below for your review and acceptance.";
  c.names[0].name = "CRUMB & CO.";
  c.names[1].name = "Crumb Kitchen";
  return c;
}

const listItem = (id: string, client: string, status: ProposalListItem["status"], over: Partial<ProposalListItem> = {}): ProposalListItem => ({
  id,
  family_id: id,
  version: 1,
  client_name: client,
  title: "Trademark Proposal",
  status,
  source: "manual",
  expires_on: "2026-11-24",
  lead_id: null,
  matter_id: null,
  approved_at: null,
  sent_at: null,
  accepted_at: null,
  created_at: "2026-11-02T12:00:00Z",
  updated_at: "2026-11-05T12:00:00Z",
  brands: [],
  offered: [{ name: "Enhanced", legalAtSigningCents: 407_500, usptoAtFilingCents: 70_000 }],
  class_count: 2,
  signed_package: null,
  package_basis: null,
  legal_total_cents: 407_500,
  gov_total_cents: 70_000,
  blocking_issue: null,
  ...over,
});

export const proposalList: ProposalListItem[] = [
  listItem(P.crumb, "Maya Chen", "sent", { brands: ["CRUMB & CO.", "Crumb Kitchen"], lead_id: L.maya, sent_at: "2026-11-07T15:00:00Z", expires_on: "2026-11-11" }),
  listItem(P.halcyon, "Lena Ortiz", "accepted", { brands: ["HALCYON PRESS"], lead_id: L.lena, sent_at: "2026-11-01T15:00:00Z", accepted_at: "2026-11-04T16:00:00Z", signed_package: "Essential" }),
  listItem(P.lumen, "Sam Lee", "draft", { brands: ["LUMEN TEA"], lead_id: L.sam, source: "agent", blocking_issue: "Add the pay link before creating the link." }),
  listItem(P.oat, "Priya Nair", "sent", { brands: ["OAT & ORCHARD"], sent_at: "2026-10-20T15:00:00Z", expires_on: "2026-11-03" }),
  listItem(P.north, "Jonah Reyes", "approved", { brands: ["NORTHFIELD GOODS"] }),
  listItem(P.moon, "Ines Walker", "withdrawn", { brands: ["PAPER MOON"] }),
];

export const proposalRow: ProposalRow = {
  id: P.crumb,
  org_id: ORG.id,
  family_id: P.crumb,
  version: 1,
  public_token: "t".repeat(43),
  lead_id: L.maya,
  matter_id: null,
  client_name: "Maya Chen",
  client_email: "maya@crumbco.example",
  title: "Trademark Proposal",
  status: "sent",
  content: content(),
  expires_on: "2026-11-11",
  pay_url: "https://pay.example/crumb",
  source: "manual",
  created_by: OWNER_ID,
  updated_by: OWNER_ID,
  approved_by: OWNER_ID,
  approved_at: "2026-11-07T14:50:00Z",
  sent_at: "2026-11-07T15:00:00Z",
  accepted_at: null,
  superseded_at: null,
  withdrawn_at: null,
  accepted_selection: null,
  accepted_snapshot: null,
  created_at: "2026-11-06T12:00:00Z",
  updated_at: "2026-11-07T15:00:00Z",
} as unknown as ProposalRow;

const ev = (n: number, type: string, at: string, payload: Record<string, unknown>, actor = "staff"): ProposalEventRow =>
  ({ id: pid(n + 20), org_id: ORG.id, proposal_id: P.crumb, family_id: P.crumb, type, actor, actor_user_id: OWNER_ID, payload, created_at: at }) as unknown as ProposalEventRow;

export const proposalDetail: ProposalDetail = {
  proposal: proposalRow,
  versions: [{ id: P.crumb, version: 1, status: "sent", source: "manual", created_at: proposalRow.created_at, updated_at: proposalRow.updated_at, approved_at: proposalRow.approved_at, sent_at: proposalRow.sent_at, accepted_at: null, superseded_at: null, withdrawn_at: null }] as unknown as ProposalDetail["versions"],
  events: [ev(1, "viewed", "2026-11-08T10:12:00Z", {}, "client"), ev(2, "sent", "2026-11-07T15:00:00Z", {}), ev(3, "approved", "2026-11-07T14:50:00Z", {}), ev(4, "created", "2026-11-06T12:00:00Z", {})],
};
