import type { Role } from "@/lib/auth/roles";

/** Who may press "Re-run prep" on the lead page: the admin tier and attorneys. Re-resolved from the session in the action. */
export const CONSULT_PREP_RERUN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney"];

export const canRerunConsultPrep = (role: Role | null | undefined): boolean => !!role && CONSULT_PREP_RERUN_ROLES.includes(role);
