import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadActiveQueue } from "@/lib/queue/load";
import { RAIL_PIN_COOKIE, visibleNav } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
import { loadRailCounts } from "@/lib/nav-counts";
import { SectionLabel } from "@/components/shell/SectionLabel";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { NoFirmAccess } from "@/components/shell/NoFirmAccess";

export const metadata: Metadata = { title: "Lectual" };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The firm workspace door. Every read inside resolveFirmSession goes through
 * the RLS-scoped client, so this decides what to DRAW, never what data is
 * reachable — that is RLS's job on the active_org_id claim.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveFirmSession({ signInNext: "/dashboard/" });

  if (session.kind === "signed-out") redirect(session.redirectTo);
  if (session.kind === "no-access") return <NoFirmAccess email={session.user.email} />;

  const { org, role, actingAsStaff, switchableFirms, displayName, user } = session;
  const items = visibleNav(org.modules ?? [], role);

  // Three states, carried to the rail badge — an unreachable queue must never
  // render like an empty one (src/lib/queue/load.ts).
  const [queue, counts, cookieStore] = await Promise.all([
    loadActiveQueue(),
    loadRailCounts().catch(() => ({})),
    cookies(),
  ]);
  const railPinned = cookieStore.get(RAIL_PIN_COOKIE)?.value === "pinned";

  return (
    <div className="lx-app">
      {actingAsStaff && (
        <div
          role="status"
          style={{
            background: "var(--warn)",
            color: "var(--cream)",
            fontSize: 13.5,
            padding: "7px 26px",
            fontFamily: "var(--mono)",
            letterSpacing: ".08em",
          }}
        >
          Lectual staff · you are inside {org.name}, a firm you are not a member of. This visit
          is logged.
        </div>
      )}
      <header className="lx-top">
        <div className="lx-wordmark" title={org.name}>
          {org.name}
        </div>
        <div className="lx-vr" />
        <SectionLabel />
        <div style={{ flex: 1 }} />
        <AccountMenu
          initials={initialsOf(displayName)}
          name={displayName}
          email={user.email ?? null}
          role={role}
          firmName={org.name}
          activeOrgId={org.id}
          switchableFirms={switchableFirms}
        />
      </header>
      <div className="lx-main">
        <Rail
          items={items}
          queueStatus={queue.status}
          pendingCount={queue.items.length}
          counts={counts}
          initialPinned={railPinned}
          initials={initialsOf(displayName)}
          name={displayName}
        />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
    </div>
  );
}
