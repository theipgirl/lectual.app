import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadActiveQueue } from "@/lib/queue/load";
import { mineQueue } from "@/lib/queue/mine-load";
import { RAIL_PIN_COOKIE, railIsPinned, visibleNav } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { loadRailCounts } from "@/lib/nav-counts";
import { SectionLabel } from "@/components/shell/SectionLabel";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NoFirmAccess } from "@/components/shell/NoFirmAccess";
import { CopilotLauncher } from "@/components/copilot/CopilotLauncher";
import { aiConfigured } from "@/lib/ai/claude";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { GettingStartedRunner } from "@/components/onboarding/GettingStartedRunner";
import { FeedbackTrailRecorder } from "@/components/feedback/FeedbackTrailRecorder";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { NavProgress } from "@/components/shell/NavProgress";
import { shouldShowTour } from "@/lib/onboarding/tour";
import { FirmWordmark } from "@/components/shell/FirmWordmark";
import { YourNameDialog } from "@/components/account/YourNameDialog";

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
  const [allQueue, counts, cookieStore] = await Promise.all([
    loadActiveQueue(),
    loadRailCounts().catch(() => ({})),
    cookies(),
  ]);
  // The badge counts what is the viewer's own (a routing read that fails counts every pending item).
  const queue = await mineQueue(allQueue, { userId: user.id, role });
  const railPinned = railIsPinned(cookieStore.get(RAIL_PIN_COOKIE)?.value);

  return (
    <div className="lx-app">
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
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
          <FirmWordmark org={org} />
        </div>
        <SectionLabel />
        <div style={{ flex: 1 }} />
        <NotificationBell />
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
        />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
      <MobileBar items={items} queueStatus={queue.status} pendingCount={queue.items.length} counts={counts} />
      <CopilotLauncher configured={aiConfigured()} />
      <FeedbackTrailRecorder />
      <FeedbackDialog />
      <YourNameDialog currentFullName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null} />
      <OnboardingTour open={shouldShowTour(user.user_metadata) && !actingAsStaff} role={role} navSlugs={items.map((i) => i.slug)} firmName={org.name} aiConfigured={aiConfigured()} />
      <GettingStartedRunner role={role} modules={org.modules} aiConfigured={aiConfigured()} />
    </div>
  );
}
