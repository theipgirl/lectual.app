import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Mailboxes") };

/** Old address of Settings → Integrations. Keeps bookmarks and any in-flight OAuth outcome working. */
export default async function MailboxesMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  const qs = q.toString();
  redirect(`/dashboard/settings/integrations/${qs ? `?${qs}` : ""}`);
}
