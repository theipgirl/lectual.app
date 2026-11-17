import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { listServiceItems } from "@/lib/quotes/service-library";
import type { ServiceItemRow } from "@/lib/quotes/types";
import { NewServiceItemForm, ServiceItemRowEditor } from "@/components/quotes/ServiceLibraryForms";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { SERVICE_LIBRARY_READ_ONLY, noneYet } from "@/lib/ui/words";
import { EmptyState, LoadFailedCard, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: pageTitle("Service library") };

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
      <PageHeader
        title="Service library"
        sub={
          <>
            Your standing offerings and their default prices. A quote copies an item&apos;s values when it is added, so
            changing a price here never changes a quote that was already built.
          </>
        }
      />

      {!canRead ? (
        <EmptyState title="Restricted">{`${ADMIN_TIER_PHRASE} can manage the service library. Ask one of them for access.`}</EmptyState>
      ) : loadError ? (
        <LoadFailedCard what="the service library" />
      ) : (
        <>
          {canEdit ? (
            <details className="lx-card lx-disclosure">
              <summary>Add a service</summary>
              <NewServiceItemForm />
            </details>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>{SERVICE_LIBRARY_READ_ONLY}</p>
          )}
          <section className="lx-card lx-pad" style={{ display: "grid", gap: 8 }}>
            <h2 className="lx-h2">Services</h2>
            {active.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>{noneYet("services", canEdit ? "Add your standing offerings above so quotes are built by picking, not retyping." : undefined)}</p>
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
