import type { Role } from "@/lib/auth/roles";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";

/**
 * Who may add a file: the same eight staff roles as CAN_WRITE_LEAD and
 * MATTER_WRITE_ROLES, and the roles in the 0097 insert policies. Re-exported,
 * not copied, so the three cannot drift. RLS is the real boundary; this list
 * makes a refusal a sentence instead of a Postgres error.
 */
export const FILE_UPLOAD_ROLES: readonly Role[] = CAN_WRITE_LEAD;

/** Who may delete one (the 0097 delete policies: the admin tier). */
export const FILE_DELETE_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];
