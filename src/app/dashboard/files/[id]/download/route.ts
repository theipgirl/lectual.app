import { NextResponse, type NextRequest } from "next/server";
import { getScopedClient } from "@/lib/db/scoped-client";
import { FILES_BUCKET } from "@/lib/files/rules";

/** How long a download link lives. */
const DOWNLOAD_URL_SECONDS = 60;

/**
 * Downloads a stored file (lectual 0097). The row is read through the caller's
 * scoped client (RLS: another firm's id is simply not found; any member of the
 * firm may read, a viewer included), and the 60-second signed URL is minted
 * through that same client, so the bucket's org-prefix policy is the second
 * gate. The original file name is offered as the download name. Never the
 * service role. Sibling of /dashboard/documents/[id]/download, which serves
 * generated letters.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getScopedClient();
  const { data: row, error } = await supabase.from("crm_file").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (error || !row?.storage_path) return new NextResponse("Not found", { status: 404 });

  const { data, error: signError } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_URL_SECONDS, { download: row.file_name || true });
  if (signError || !data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, 303);
}
