import Link from "next/link";
import { getScopedClient } from "@/lib/db/scoped-client";
import { DOC_FILTERS, DOC_KIND, DOC_TYPE_LABEL, docStatus, isDocFilter, type DocFilter } from "@/lib/documents/list";
import { relativeTime } from "@/lib/relative-time";
import { orgHasModule } from "@/lib/org/modules";

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
  const supabase = await getScopedClient();
  const canGenerate = await orgHasModule("document-center");

  const { data, error } = await supabase
    .from("crm_document_draft")
    .select("id, matter_id, doc_type, status, file_name, queue_item_id, error_message, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(300);
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
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Matter files</div>
          <h1 className="lx-h1">Documents</h1>
          <p className="lx-sub">
            Every letter drafted for a matter, on the matter it belongs to. Nothing leaves the firm until an attorney approves it in the queue.
          </p>
        </div>
        {canGenerate && (
          <Link href="/dashboard/documents/new/" className="lx-btn lx-btn-pri">
            New letter
          </Link>
        )}
      </div>

      <nav aria-label="Filter documents" className="lx-chips">
        {DOC_FILTERS.map((x) => (
          <Link key={x.key} href={x.key === "all" ? "/dashboard/documents/" : `/dashboard/documents/?f=${x.key}`} aria-current={filter === x.key ? "page" : undefined}>
            {x.label}
            <span className="lx-chip-count">{count(x.key)}</span>
          </Link>
        ))}
      </nav>

      {error ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>Documents couldn&apos;t be loaded</h2>
          <p className="lx-note" style={{ margin: 0 }}>This is a problem reaching the database, not an empty list. Try again shortly.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{all.length === 0 ? "No documents yet" : "Nothing matches"}</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {all.length === 0 ? "Engagement and opinion letters drafted for a matter show up here." : "Try another filter."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 720 }}>
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
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span className="lx-doc-kind" aria-hidden="true">{DOC_KIND[d.doc_type] ?? "DOC"}</span>
                        <div style={{ minWidth: 0 }}>
                          <div>{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</div>
                          {d.file_name && <div className="lx-note lx-num">{d.file_name}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {m ? (
                        <Link href={`/dashboard/matters/${m.id}/`}>{m.mark_text ?? m.title ?? m.matter_number}</Link>
                      ) : (
                        <span className="lx-note">—</span>
                      )}
                      {m && <div className="lx-note lx-num">{m.matter_number}{m.owner_name ? ` · ${m.owner_name}` : ""}</div>}
                    </td>
                    <td>
                      <span className={`lx-pill ${st.tone}`}>{st.label}</span>
                    </td>
                    <td className="lx-num">{relativeTime(d.updated_at)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {d.status === "queued" && d.queue_item_id && (
                        <Link href={`/dashboard/queue/${d.queue_item_id}/`} className="lx-btn lx-btn-sec lx-btn-sm">
                          Review
                        </Link>
                      )}
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
          </table>
        </div>
      )}
    </>
  );
}
