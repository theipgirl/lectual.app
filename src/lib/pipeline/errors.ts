/**
 * The one error type the lead data layer raises on purpose for a human to read.
 *
 * Everything a firm user sees on a failed write comes from here. Anything the
 * data layer throws that is NOT a LeadWriteError is treated as internal by the
 * server actions and replaced with a generic sentence — so a raw PostgREST
 * string ("new row violates row-level security policy for table
 * \"crm_lead\"", a constraint name, a column list) can never reach the screen,
 * and we don't have to keep an allowlist of message shapes in sync.
 */
export class LeadWriteError extends Error {
  /** Set for a permission refusal, so the UI can say something actionable. */
  readonly forbidden: boolean;
  /** Per-field validation messages, keyed by form field name. */
  readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    opts: { forbidden?: boolean; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "LeadWriteError";
    this.forbidden = opts.forbidden ?? false;
    this.fieldErrors = opts.fieldErrors;
  }
}

export function isLeadWriteError(err: unknown): err is LeadWriteError {
  return err instanceof LeadWriteError;
}

/** Builds the refusal thrown by every lead-write role gate. */
export function forbiddenLeadWrite(role: string, what: string): LeadWriteError {
  return new LeadWriteError(`Forbidden: role '${role}' cannot ${what}`, { forbidden: true });
}
