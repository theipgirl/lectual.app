import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SETUP_PATH } from "@/lib/setup/routes";
import { pageTitle } from "@/lib/ui/page-title";
import { SETUP_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(SETUP_NAME) };

/** Setup moved into Settings (a tab there). This keeps the old address working; the new page does its own role check. */
export default function OldSetupAddress() {
  redirect(SETUP_PATH);
}
