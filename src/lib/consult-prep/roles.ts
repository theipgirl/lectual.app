import type { Role } from "@/lib/auth/roles";

/** Who may press "Re-run prep" on the lead page: the admin tier and attorneys. Re-resolved from the session in the action. */
export const CONSULT_PREP_RERUN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney"];

export const canRerunConsultPrep = (role: Role | null | undefined): boolean => !!role && CONSULT_PREP_RERUN_ROLES.includes(role);

/**
 * S2c: who may press "Send a test brief": the firm's OWNER, and only a real one. Lectual staff acting inside a firm carry the owner role
 * claim but are refused (`actingAsStaff` must be exactly false, as for the owner's money columns). Re-resolved from the session in the action.
 */
export const canSendTestBrief = (role: unknown, actingAsStaff: unknown): boolean => role === "owner" && actingAsStaff === false;
