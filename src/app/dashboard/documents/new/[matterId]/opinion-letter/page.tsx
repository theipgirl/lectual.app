import { PageHeader } from "@/components/ui";
import { NEW_LETTER_NAMES } from "@/lib/ui/words";
import { notFound } from "next/navigation";
import { getMatter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import OpinionLetterForm from "./_components/OpinionLetterForm";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(NEW_LETTER_NAMES.opinion) };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const matter = await getMatter(matterId);
  if (!matter) notFound();
  return (
    <>
      <PageHeader
        back={{ href: `/dashboard/documents/new/${matter.id}/`, label: matterLabel(matter) }}
        title={NEW_LETTER_NAMES.opinion}
        sub={"Upload the TMTKO knockout search report. The draft follows the firm's clearance-opinion structure and is attorney work product for redline, never sent to a client directly. A .docx is made once it's approved."}
      />
      <OpinionLetterForm matterId={matter.id} matter={matter} />
    </>
  );
}
