import { NextResponse, type NextRequest } from "next/server";
import { getScopedClient } from "@/lib/db/scoped-client";

const BUCKET = "matter-documents";

/**
 * Downloads a generated document. The row is read through the caller's scoped
 * client (RLS: another firm's id is simply not found), and the short-lived
 * signed URL is minted through that same client, so the bucket's org-prefix
 * storage policy is the second gate. Never the service role.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getScopedClient();
  const { data: row } = await supabase
    .from("crm_document_draft")
    .select("storage_path, status")
    .eq("id", id)
    .maybeSingle();
  if (!row?.storage_path || row.status !== "generated") return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60, { download: true });
  if (error || !data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, 303);
}
