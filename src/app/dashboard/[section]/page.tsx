import { notFound } from "next/navigation";
import { navItemBySlug } from "@/lib/nav";
import { orgHasModule } from "@/lib/org/modules";
import { NotBuilt } from "@/components/shell/NotBuilt";

/**
 * Every rail section that doesn't have its real page yet. The module check
 * lives HERE, not just in the rail: a hidden door is still reachable by
 * typing the URL, and a section a firm doesn't hold must not exist for it.
 * Real pages replace this route one by one as their build step lands, and
 * must carry the same check.
 */
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = navItemBySlug(section);
  if (!item || item.slug === "") notFound();
  if (item.module && !(await orgHasModule(item.module))) notFound();
  return <NotBuilt label={item.label} step={item.step} />;
}
