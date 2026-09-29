import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import { MATTER_TYPE_LABEL } from "@/app/dashboard/matters/labels";

export const dynamic = "force-dynamic";

const LETTERS = [
  { slug: "opinion-letter", kind: "OPN", name: "Opinion letter", what: "From the TMTKO knockout search report: the firm's standard clearance-opinion structure, for attorney redline." },
  { slug: "trademark-clearance", kind: "CLR", name: "Preliminary trademark clearance", what: "A lighter, pre-engagement knockout opinion from preliminary search findings. Never a substitute for the opinion letter." },
  { slug: "loe", kind: "LOE", name: "Letter of engagement", what: "Trademark matters use the firm's fee chart; other matters describe the scope. Fees are exactly what you enter." },
];

export default async function MatterLettersPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const matter = await getMatter(matterId); // RLS: another firm's matter is not found
  if (!matter) notFound();
  return (
    <>
      <Link href="/dashboard/documents/new/" className="lx-back">
        ← Choose another matter
      </Link>
      <div>
        <div className="lx-label">
          {MATTER_TYPE_LABEL[matter.type]} · <span className="lx-num">{matter.matter_number}</span>
        </div>
        <h1 className="lx-h1">{matterLabel(matter)}</h1>
        <p className="lx-sub">Which letter? Each is drafted into the approval queue, where an attorney reviews it before anything is made or sent.</p>
      </div>
      <div className="lx-kpis">
        {LETTERS.map((l) => (
          <Link key={l.slug} href={`/dashboard/documents/new/${matter.id}/${l.slug}/`} className="lx-card lx-kpi">
            <span className="lx-doc-kind" aria-hidden="true">{l.kind}</span>
            <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 16 }}>{l.name}</span>
            <span className="lx-note">{l.what}</span>
          </Link>
        ))}
      </div>
      <Link href={`/dashboard/matters/${matter.id}/`} className="lx-note">
        Open the matter →
      </Link>
    </>
  );
}
