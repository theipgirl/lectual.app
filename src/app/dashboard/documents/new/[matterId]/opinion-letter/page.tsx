import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import OpinionLetterForm from "./_components/OpinionLetterForm";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const matter = await getMatter(matterId);
  if (!matter) notFound();
  return (
    <>
      <Link href={`/dashboard/documents/new/${matter.id}/`} className="lx-back">
        ← {matterLabel(matter)}
      </Link>
      <div>
        <div className="lx-label">Document Center</div>
        <h1 className="lx-h1">New opinion letter</h1>
        <p className="lx-sub">{"Upload the TMTKO knockout search report. The draft follows the firm's clearance-opinion structure and is attorney work product for redline, never sent to a client directly. A .docx is made once it's approved."}</p>
      </div>
      <OpinionLetterForm matterId={matter.id} matter={matter} />
    </>
  );
}
