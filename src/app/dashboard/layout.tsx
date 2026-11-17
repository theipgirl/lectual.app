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
import { guideFor, shouldShowWelcomeDeal } from "@/lib/onboarding/welcome-deal";
import { WelcomeDeal } from "@/components/onboarding/WelcomeDeal";
import { FirmWordmark } from "@/components/shell/FirmWordmark";
import { DealTimesDialog } from "@/components/deck/DealTimesDialog";
import { parseDealTimes } from "@/lib/deal/person-times";
import { parseDeckSeen } from "@/lib/deal/nudge";
import { loadDealNudge } from "@/lib/queue/deal-nudge-load";
import { dealReadyLine } from "@/lib/ui/words";
import { friendlyZoneLabel } from "@/lib/org/firm-form";
import { getFirmTimeZone } from "@/lib/org/profile";
import { YourNameDialog } from "@/components/account/YourNameDialog";
import { drawnNav, NO_PREVIEW, previewFor, shellFor, viewFor, viewMenuFor } from "@/lib/views";

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
  // The view decides only what is DRAWN (src/lib/views): read off the user already in hand, never a second read.
  // Every page and action keeps its own gate; with the firm's switch off this is today's shell, unchanged.
  const firmHasRoleViews = (org.modules ?? []).includes("role-views");
  // Firm members have no preference: their view is their role's. Only Lectual staff acting here carry a preview,
  // kept per firm, so one chosen in another firm never applies in this one.
  const viewPreview = actingAsStaff ? previewFor(user.user_metadata, org.id) : NO_PREVIEW;
  const view = viewFor({ role, preview: viewPreview, firmHasRoleViews, actingAsStaff });
  const shell = shellFor(view);
  // The one draw-only filter, after visibleNav: it can drop a section, never add one.
  const drawn = drawnNav(items, view);
  const viewMenu = viewMenuFor({ preview: viewPreview, firmHasRoleViews, actingAsStaff });

  // Three states, carried to the rail badge — an unreachable queue must never
  // render like an empty one (src/lib/queue/load.ts).
  const [allQueue, counts, cookieStore] = await Promise.all([
    loadActiveQueue(),
    loadRailCounts().catch(() => ({})),
    cookies(),
  ]);
  // The badge counts what is the viewer's own (a routing read that fails counts every pending item).
  // The owner shell's deal-ready dot, from the queue read above (no second queue read), in parallel with the badge count.
  // The technician shell never asks.
  const [queue, nudge] = await Promise.all([
    mineQueue(allQueue, { userId: user.id, role }),
    shell.variant === "owner" ? loadDealNudge(allQueue, { userId: user.id, role }, parseDealTimes(user.user_metadata), parseDeckSeen(user.user_metadata)) : Promise.resolve(null),
  ]);
  const dealReady = nudge && nudge.ready ? dealReadyLine(nudge.label, nudge.count) : null;
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
      <header className={shell.variant === "owner" ? "lx-top lx-top--owner" : "lx-top"}>
        <div className="lx-wordmark" title={org.name}>
          <FirmWordmark org={org} />
        </div>
        {shell.variant !== "owner" && <SectionLabel />}
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
          viewMenu={viewMenu}
          settingsInMenu={shell.settingsInMenu}
          variant={shell.variant}
        />
      </header>
      <div className="lx-main">
        <Rail
          items={drawn}
          queueStatus={queue.status}
          pendingCount={queue.items.length}
          counts={counts}
          initialPinned={railPinned}
          showSettings={shell.showSettings}
          showReports={shell.showReports}
          tree={shell.tree}
          variant={shell.variant}
          dealReady={dealReady}
        />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
      <MobileBar
        items={drawn}
        queueStatus={queue.status}
        pendingCount={queue.items.length}
        counts={counts}
        bar={shell.bar}
        groups={shell.moreGroups}
        variant={shell.variant}
        dealReady={dealReady}
      />
      <CopilotLauncher configured={aiConfigured()} />
      <FeedbackTrailRecorder />
      <FeedbackDialog />
      {shell.variant === "owner" && <DealTimesDialog current={parseDealTimes(user.user_metadata)} zoneLabel={friendlyZoneLabel(await getFirmTimeZone())} />}
      <YourNameDialog currentFullName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null} />
      {/* One first-sign-in guide, never both: the owner shell draws the welcome deal, every other shell the tour. */}
      {guideFor(shell.variant) === "welcome" ? (
        <WelcomeDeal open={shouldShowWelcomeDeal({ userMetadata: user.user_metadata, shellVariant: shell.variant, actingAsStaff })} dealTimes={parseDealTimes(user.user_metadata)} persist={!actingAsStaff} />
      ) : (
        <OnboardingTour open={shouldShowTour(user.user_metadata) && !actingAsStaff} role={role} navSlugs={drawn.map((i) => i.slug)} firmName={org.name} aiConfigured={aiConfigured()} />
      )}
      <GettingStartedRunner role={role} modules={org.modules} aiConfigured={aiConfigured()} />
    </div>
  );
}
