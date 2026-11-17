import { PageHeader } from "@/components/ui";
import { NEW_LETTER_NAMES } from "@/lib/ui/words";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import TrademarkClearanceForm from "./_components/TrademarkClearanceForm";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(NEW_LETTER_NAMES.clearance) };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const matter = await getMatter(matterId);
  if (!matter) notFound();
  return (
    <>
      <PageHeader
        back={{ href: `/dashboard/documents/new/${matter.id}/`, label: matterLabel(matter) }}
        title={NEW_LETTER_NAMES.clearance}
        sub={"A preliminary, pre-engagement knockout opinion, lighter than the full opinion letter and never a substitute for it. Paste in the preliminary search findings. It is attorney work product, never sent to a client directly."}
      />
      <TrademarkClearanceForm matterId={matter.id} matter={matter} />
    </>
  );
}
