import { notFound } from "next/navigation";
import { orgHasModule } from "@/lib/org/modules";

/**
 * THE TENANT BOUNDARY FOR EVERY LETTER GENERATOR (ported from lectual's
 * document-center/layout.tsx). The templates carry one firm's letterhead,
 * attorney voice and signature block, with no org_id for RLS to key on, so
 * the module check is the boundary. Gated at the segment root so a route
 * added under here later is protected by default. Each action re-checks the
 * module itself, because a POST never renders this layout.
 */
export default async function GeneratorsLayout({ children }: { children: React.ReactNode }) {
  if (!(await orgHasModule("document-center"))) notFound();
  return <>{children}</>;
}
