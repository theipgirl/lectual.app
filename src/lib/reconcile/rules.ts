/** Limits and sentences for the reconciliation screen. Client-safe: no server imports. */

/** One request moves at most this many leads; a larger set is applied in a second pass. */
export const MAX_MOVES_PER_APPLY = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Every sentence a person can read from the two actions. None carries database text. */
export const RECONCILE_MESSAGES = {
  signedOut: "Sign in again to use this page.",
  roleUnknown: "We couldn't check your role, so nothing was done. Try again shortly.",
  notAllowed: "Only an owner or admin can reconcile stages.",
  leadsUnreadable: "We couldn't reach the database to read your leads, so no comparison was made. This is a problem reaching the database, not an empty pipeline. Try again shortly.",
  stagesUnreadable: "We couldn't reach the database to read your pipeline stages, so no comparison was made. Try again shortly.",
  nothingChosen: "No moves were chosen.",
  badRequest: "That request wasn't understood, so nothing was moved. Upload the sheet again.",
  tooMany: `That is more than ${MAX_MOVES_PER_APPLY} moves for one pass. Apply ${MAX_MOVES_PER_APPLY} or fewer, then upload the sheet again for the rest.`,
  stale: "This plan is out of date, so nothing was moved. Upload the sheet again to build a fresh one.",
  notFound: "One of these leads was not found, so nothing was moved. Upload the sheet again to build a fresh plan.",
  stageGone: "One of the target stages no longer exists or can't be moved to from here, so nothing was moved. Upload the sheet again.",
  readFailed: "We couldn't check the current state of these leads, so nothing was moved. Try again shortly.",
  moveFailed: "Couldn't move this lead. Nothing was changed for it.",
  moveForbidden: "You don't have permission to move this lead.",
  allFailed: "None of the moves went through.",
  createBadRequest: "That person's details weren't understood, so no lead was created. Upload the sheet again.",
  createNoStage: "This firm has no open stage to file a new lead in, so no lead was created. Add a stage in Settings first.",
  createExists: "A lead for this person already exists, so no second one was created. Upload the sheet again to see it.",
  createReadFailed: "We couldn't check whether this person already has a lead, so none was created. Try again shortly.",
  createFailed: "Couldn't create this lead. Nothing was changed.",
} as const;
