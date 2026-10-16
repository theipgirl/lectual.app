import Link from "next/link";
import { listMatters } from "@/lib/matters";
import { isOpenMatter, matterLabel } from "@/lib/matters/docket-summary";
import { MATTER_TYPE_LABEL } from "@/app/dashboard/matters/labels";

export const dynamic = "force-dynamic";

/** Pick the matter a new letter is for. Open matters, newest first. */
export default async function NewLetterPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim().toLowerCase();
  let matters: Awaited<ReturnType<typeof listMatters>> = [];
  let failed = false;
  try {
    matters = (await listMatters()).filter(isOpenMatter);
  } catch {
    failed = true;
  }
  const shown = term
    ? matters.filter((m) => [m.mark_text, m.title, m.matter_number, m.owner_name].some((v) => v?.toLowerCase().includes(term)))
    : matters;

  return (
    <>
      <Link href="/dashboard/documents/" className="lx-back">
        ← Documents
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Document Center</div>
          <h1 className="lx-h1">New letter</h1>
          <p className="lx-sub">Choose the matter. Every letter is drafted into the approval queue; the file is made once an attorney approves it.</p>
        </div>
        <form className="lx-search-form" role="search">
          <input className="lx-input" name="q" defaultValue={q ?? ""} placeholder="Mark, number or client" aria-label="Search matters" />
        </form>
      </div>
      {failed ? (
        <div role="alert" className="lx-banner lx-banner-risk">We couldn&apos;t load your matters. Try again shortly.</div>
      ) : shown.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{matters.length === 0 ? "No open matters" : "Nothing matches"}</h2>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl">
            <thead>
              <tr>
                <th>Matter</th>
                <th>Type</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((m) => (
                <tr key={m.id}>
                  <td className="pri">
                    <Link href={`/dashboard/documents/new/${m.id}/`} className="lx-rowlink">
                      {matterLabel(m)}
                    </Link>
                    <div className="lx-note lx-num">{m.matter_number}</div>
                  </td>
                  <td>{MATTER_TYPE_LABEL[m.type]}</td>
                  <td>{m.owner_name ?? <span className="lx-note">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
