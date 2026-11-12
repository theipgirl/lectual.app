import "server-only";
import { env } from "@/lib/env";
import { getSiteOrigin } from "@/lib/site-origin";
import { metadataResponse } from "./discovery";

/** GET for both discovery URLs (the path-suffixed one and the bare one). Public, no session. */
export async function protectedResourceGET(): Promise<Response> {
  return metadataResponse(await getSiteOrigin(), env.NEXT_PUBLIC_SUPABASE_URL);
}
