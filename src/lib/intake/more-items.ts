export type LeadsMoreItem = { label: string; href: string };

export const RECONCILE_HREF = "/dashboard/intake/reconcile/";
export const IMPORT_HREF = "/dashboard/settings/integrations/lawmatics/";

/**
 * The rare actions on the Leads page, in the "More" menu: Import for everyone who can see the page, and
 * Reconcile stages only when the caller is in the admin tier (`showReconcile`, decided by the server
 * from the role; the screen and its actions check the role again).
 */
export function leadsMoreItems(opts: { showReconcile: boolean }): LeadsMoreItem[] {
  return [...(opts.showReconcile ? [{ label: "Reconcile stages", href: RECONCILE_HREF }] : []), { label: "Import", href: IMPORT_HREF }];
}
