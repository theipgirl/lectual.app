/**
 * Who a record is waiting on. Pure.
 *
 * "With the USPTO" is decided in ONE place: a matter whose docket stage says it is waiting on the
 * office (`waiting_on = "uspto"`), or whose stage NAME matches the table below (a firm's own stage
 * names are the fallback when a stage has no waiting_on set the way we expect). Nothing else in the
 * review decides this.
 *
 * Otherwise it is the firm's turn or the client's, read from the newest directional contact: they
 * replied last, so it is on us; we sent last, so it is on the client. A pending approval is its
 * own chip: the move is a person's review.
 */

export type Waiting = "uspto" | "approval" | "us" | "client";
export type Direction = "we" | "they";

export const WAITING_LABEL: Record<Waiting, string> = {
  uspto: "USPTO",
  approval: "Approval",
  us: "Us",
  client: "Client",
};

/** Stage-name keywords for "the ball is with the USPTO". One table; matched on the lowercased label. */
export const USPTO_STAGE_PATTERNS: readonly RegExp[] = [
  /application filed/,
  /awaiting (trademark )?registration/,
  /awaiting (first )?(office )?action/,
  /publication/,
  /published for opposition/,
  /opposition period/,
  /oa response (sent|filed)/,
  /office action response (sent|filed)/,
  /response (sent|filed) to (the )?(office action|uspto)/,
  /statement of use (sent|filed)/,
  /notice of allowance/,
  /with (the )?uspto/,
  /awaiting uspto/,
];

export function stageIsWithUspto(stage: { label: string; waiting_on?: string | null } | null | undefined): boolean {
  if (!stage) return false;
  if (stage.waiting_on === "uspto") return true;
  const label = String(stage.label ?? "").toLowerCase();
  return USPTO_STAGE_PATTERNS.some((p) => p.test(label));
}

export function waitingOn(input: { withUspto: boolean; pendingApproval: boolean; lastDirection: Direction | null }): Waiting | null {
  if (input.withUspto) return "uspto";
  if (input.pendingApproval) return "approval";
  if (input.lastDirection === "they") return "us";
  if (input.lastDirection === "we") return "client";
  return null;
}
