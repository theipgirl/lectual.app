import Link from "next/link";
import { notFound } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { DOC_FILTERS, DOC_KIND, DOC_TYPE_LABEL, docStatus, isDocFilter, type DocFilter } from "@/lib/documents/list";
import { formatRelative } from "@/lib/ui/dates";
import { getFirmTimeZone } from "@/lib/org/profile";
import { EmptyState, LoadFailedCard, Notice, PageHeader, Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import { BLANK, DOCUMENTS_NAME, noneYet } from "@/lib/ui/words";
import "@/components/documents/documents.css";
import { orgHasModule } from "@/lib/org/modules";
import type { Metadata } from "next";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import { pageTitle } from "@/lib/ui/page-title";
import { DOCUMENT_LIST_LIMIT, failureReason, listCutNotice } from "@/lib/documents/failure-reason";
import { RetryButton } from "@/components/documents/RetryButton";

export const metadata: Metadata = { title: pageTitle("Documents") };

export const dynamic = "force-dynamic";

type Row = { id: string; matter_id: string; doc_type: string; status: string; file_name: string | null; queue_item_id: string | null; error_message: string | null; created_at: string; updated_at: string };

/**
 * Documents: every letter generated for a matter (crm_document_draft), with
 * where it stands. Read through RLS, so a firm only ever sees its own. The
 * template generators are per-firm (one firm's letterhead and
 * attorney voice), so they live under /dashboard/documents/new behind the
 * `document-center` module.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const filter: DocFilter = isDocFilter(f) ? f : "all";
  // The letter templates carry one firm's letterhead and voice, so the whole area is a module: a firm
  // without Document Center (or whose module list can't be read) gets the same not-found as any unknown page.
  if (!(await orgHasModule("document-center").catch(() => false))) notFound();
  const supabase = await getScopedClient();
  const tz = await getFirmTimeZone();

  const { data, error } = await supabase
    .from("crm_document_draft")
    .select("id, matter_id, doc_type, status, file_name, queue_item_id, error_message, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(DOCUMENT_LIST_LIMIT);
  const all = (data ?? []) as Row[];
  const matterIds = [...new Set(all.map((d) => d.matter_id))];
  const { data: matters } = matterIds.length
    ? await supabase.from("crm_matter").select("id, matter_number, mark_text, title, owner_name").in("id", matterIds)
    : { data: [] };
  const matterById = new Map((matters ?? []).map((m) => [m.id, m]));
  const rows = filter === "all" ? all : all.filter((d) => d.status === filter);
  const count = (k: DocFilter) => (k === "all" ? all.length : all.filter((d) => d.status === k).length);

  return (
    <>
      <PageHeader
        title={DOCUMENTS_NAME}
        sub="Every letter drafted for a matter, on the matter it belongs to. Nothing leaves the firm until an attorney approves it in the queue."
        actions={
          <Link href="/dashboard/documents/new/" className="lx-btn lx-btn-pri">
            New letter
          </Link>
        }
      />

      <FilterChips as="nav" label="Filter documents">
        {DOC_FILTERS.map((x) => (
          <Chip key={x.key} href={x.key === "all" ? "/dashboard/documents/" : `/dashboard/documents/?f=${x.key}`} active={filter === x.key} count={count(x.key)}>
            {x.label}
          </Chip>
        ))}
      </FilterChips>

      {!error && listCutNotice(all.length) && (
        <Notice tone="warn" role="status">
          {listCutNotice(all.length)}
        </Notice>
      )}

      {error ? (
        <LoadFailedCard what="documents" />
      ) : rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState action={<Link href="/dashboard/documents/new/" className="lx-btn lx-btn-pri">New letter</Link>}>
            {noneYet("documents", "Engagement and opinion letters drafted for a matter show up here.")}
          </EmptyState>
        ) : (
          <EmptyState title="Nothing matches">Try another filter.</EmptyState>
        )
      ) : (
        <SheetCard>
          <SheetScroll>
            <SheetTable minWidth={760}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Matter</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const m = matterById.get(d.matter_id);
                  const st = docStatus(d.status);
                  return (
                    <tr key={d.id}>
                      <td className="pri">
                        <div className="doc-kind-cell">
                          <span className="lx-doc-kind" aria-hidden="true">{DOC_KIND[d.doc_type] ?? "DOC"}</span>
                          <div className="doc-kind-text">
                            <div>{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</div>
                            {d.file_name && <div className="lx-note">{d.file_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td data-label="Matter">
                        {m ? <Link href={`/dashboard/matters/${m.id}/`}>{matterDisplayTitle(m).title}</Link> : BLANK}
                        {m && (
                          <div className="lx-note">
                            {m.matter_number}
                            {m.owner_name ? ` · ${m.owner_name}` : ""}
                          </div>
                        )}
                      </td>
                      <td data-label="Status">
                        <Pill tone={st.tone}>{st.label}</Pill>
                        {d.status === "failed" && <div className="lx-note">{failureReason(d.error_message)}</div>}
                      </td>
                      <td data-label="Updated">{formatRelative(d.updated_at, { tz }) ?? BLANK}</td>
                      <td className="lx-stack-actions doc-actions">
                        {d.status === "queued" && d.queue_item_id && (
                          <Link href={`/dashboard/queue/${d.queue_item_id}/`} className="lx-btn lx-btn-sec lx-btn-sm">
                            Review
                          </Link>
                        )}
                        {d.status === "failed" && d.queue_item_id && <RetryButton draftId={d.id} />}
                        {d.status === "generated" && (
                          <a href={`/dashboard/documents/${d.id}/download/`} className="lx-btn lx-btn-sec lx-btn-sm">
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
    </>
  );
}
