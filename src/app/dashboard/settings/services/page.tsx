import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { listServiceItems } from "@/lib/quotes/service-library";
import type { ServiceItemRow } from "@/lib/quotes/types";
import { NewServiceItemForm, ServiceItemRowEditor } from "@/components/quotes/ServiceLibraryForms";

export const dynamic = "force-dynamic";

/**
 * Service library — the firm's standing offerings and default prices, picked
 * rather than retyped when a quote is built (`crm_service_item`).
 *
 * Who sees what:
 *  - owner / admin / senior_admin: read and edit (mirrors
 *    `crm_service_item_{insert,update,delete}_admin`). Every write is re-gated
 *    in `@/lib/quotes/service-library` and again by RLS.
 *  - attorney: read-only. They build quotes FROM this list (quoting is
 *    attorney+), but changing what EVERY future proposal charges is the
 *    admins' call — lectual's reasoning, kept.
 *  - everyone else: the same in-firm explanation the quotes pages give.
 *
 * Archived items stay listed here (the archive is part of the catalogue) and
 * drop out of the builder's picker, which reads active items only.
 */
export default async function ServiceLibraryPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canEdit = hasRole(session.role, "senior_admin");
  const canRead = hasRole(session.role, "attorney");

  let items: ServiceItemRow[] = [];
  let loadError = false;
  if (canRead) {
    try {
      items = await listServiceItems(true);
    } catch {
      loadError = true;
    }
  }
  const active = items.filter((i) => i.active);
  const archived = items.filter((i) => !i.active);

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1">Service library</h1>
        <p className="lx-sub">
          Your standing offerings and their default prices. A quote copies an item&apos;s values when it is added, so
          changing a price here never changes a quote that was already built.
        </p>
      </div>

      {!canRead ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Restricted to the firm&apos;s principals
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            The service library is managed by owners, admins and senior admins. Ask one of them for access.
          </p>
        </div>
      ) : loadError ? (
        <div role="alert" className="lx-banner lx-banner-risk">
          The service library couldn&apos;t be loaded. That is a problem reaching the database, not an empty list.
        </div>
      ) : (
        <>
          {canEdit ? (
            <details className="lx-card lx-disclosure">
              <summary>Add a service</summary>
              <NewServiceItemForm />
            </details>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>
              You can use these on quotes. Owners, admins and senior admins change the list.
            </p>
          )}
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 8 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              Services
            </h2>
            {active.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>
                No services yet.{canEdit ? " Add your standing offerings above so quotes are built by picking, not retyping." : ""}
              </p>
            ) : (
              <ul className="lx-list">
                {active.map((item) => (
                  <ServiceItemRowEditor key={item.id} item={item} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </section>
          {archived.length > 0 && (
            <details className="lx-card lx-disclosure">
              <summary>Archived ({archived.length})</summary>
              <ul className="lx-list" style={{ padding: "0 18px 12px" }}>
                {archived.map((item) => (
                  <ServiceItemRowEditor key={item.id} item={item} canEdit={canEdit} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
