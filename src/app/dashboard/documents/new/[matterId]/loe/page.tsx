import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import LoeForm from "./_components/LoeForm";

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
        <h1 className="lx-h1">New letter of engagement</h1>
        <p className="lx-sub">{"Trademark matters use the firm's fee chart: pick the current or legacy template explicitly, it's never guessed. Other matters use the general letter: describe the scope and it becomes bullet points; fee and deposit figures are exactly what you enter."}</p>
      </div>
      <LoeForm matterId={matter.id} defaultMarkText={matter.mark_text} defaultPackage={matter.package_name} />
    </>
  );
}
