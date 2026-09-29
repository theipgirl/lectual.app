import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import TrademarkClearanceForm from "./_components/TrademarkClearanceForm";

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
        <h1 className="lx-h1">New preliminary trademark clearance</h1>
        <p className="lx-sub">{"A preliminary, pre-engagement knockout opinion, lighter than the full opinion letter and never a substitute for it. Paste in the preliminary search findings. It is attorney work product, never sent to a client directly."}</p>
      </div>
      <TrademarkClearanceForm matterId={matter.id} matter={matter} />
    </>
  );
}
