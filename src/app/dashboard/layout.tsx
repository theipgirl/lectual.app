import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { RETURN_PATH_HEADER, isDashboardPath } from "@/lib/auth/return-path";
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
import { connectableProviders } from "@/lib/mailbox/config";
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
import { dealReadyLine, staffInsideFirm } from "@/lib/ui/words";
import { friendlyZoneLabel } from "@/lib/org/firm-form";
import { getFirmTimeZone } from "@/lib/org/profile";
import { YourNameDialog } from "@/components/account/YourNameDialog";
import { NoShowNotices } from "@/components/record-card/NoShowNotices";
import { drawnNav, NO_PREVIEW, previewFor, shellFor, viewFor, viewMenuFor } from "@/lib/views";
import { resolveViewer } from "@/lib/views/view-as";
import { VIEW_AS_COOKIE, isRealOwner } from "@/lib/views/view-as-rules";
import { StalePreviewCookie } from "@/components/views/StalePreviewCookie";
import { ViewAsBanner } from "@/components/views/ViewAsBanner";
import { PreviewBell } from "@/components/views/PreviewBell";
import { ReadOnlyPreview } from "@/components/views/ReadOnlyPreview";

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
  // Come back to the page that was asked for (the proxy passes its path + query; see return-path.ts).
  const returnTo = (await headers()).get(RETURN_PATH_HEADER);
  const session = await resolveFirmSession({ signInNext: isDashboardPath(returnTo) ? returnTo : "/dashboard/" });

  if (session.kind === "signed-out") redirect(session.redirectTo);
  if (session.kind === "no-access") return <NoFirmAccess email={session.user.email} />;

  const { org, role, actingAsStaff, switchableFirms, displayName, user } = session;
  // View as (src/lib/views/view-as.ts): the session stays the owner's; the VIEWER is the teammate while previewing. Every
  // drawn decision below reads the viewer. `previewing` covers "on" and "couldn't check": writes are refused in both.
  const resolved = await resolveViewer().catch(() => null);
  const viewAs = resolved?.viewAs ?? null;
  const previewing = Boolean(resolved && resolved.previewState !== "off");
  const viewerRoleNow = resolved?.viewer.role ?? role;
  const viewerId = resolved?.viewer.userId ?? user.id;
  // The drawn rows follow the viewer's own role, never the previewed one: a Lectual staff member previewing a view sees that view's
  // shape over the sections THEIR role and this firm allow, so a preview never shows a row the previewed role alone would have.
  const items = visibleNav(org.modules ?? [], viewerRoleNow);
  // The view decides only what is DRAWN (src/lib/views): read off the user already in hand, never a second read.
  // Every page and action keeps its own gate; with the firm's switch off this is today's shell, unchanged.
  const firmHasRoleViews = (org.modules ?? []).includes("role-views");
  // Firm members have no preference: their view is their role's. Only Lectual staff acting here carry a preview,
  // kept per firm, so one chosen in another firm never applies in this one. A View as preview is the teammate's view.
  const viewPreview = actingAsStaff && !viewAs ? previewFor(user.user_metadata, org.id) : NO_PREVIEW;
  const view = viewFor({ role: viewerRoleNow, preview: viewPreview, firmHasRoleViews, actingAsStaff: viewAs ? false : actingAsStaff });
  const shell = shellFor(view);
  // The one draw-only filter, after visibleNav: it can drop a section, never add one.
  const drawn = drawnNav(items, view);
  const viewMenu = previewing ? undefined : viewMenuFor({ preview: viewPreview, firmHasRoleViews, actingAsStaff });
  // "View as a teammate" in the menu: a REAL owner (owner row in this firm), on a database with View as, not previewing.
  const viewAsLink =
    !previewing && Boolean(resolved?.viewAsAvailable) && isRealOwner({ userId: user.id, orgId: org.id, member: session.member });

  // Three states, carried to the rail badge — an unreachable queue must never
  // render like an empty one (src/lib/queue/load.ts).
  const [allQueue, counts, cookieStore] = await Promise.all([
    loadActiveQueue(),
    loadRailCounts().catch(() => ({})),
    cookies(),
  ]);
  // The badge counts what is the viewer's own (a routing read that fails counts every pending item).
  // The owner shell's deal-ready dot, from the queue read above (no second queue read), in parallel with the badge count.
  // The technician shell never asks. A teammate's own deal times and deck-seen stamp live on their account, which can't be
  // read: a preview uses the firm's default deal times and no stamp (D10).
  const viewerMeta = viewAs ? {} : user.user_metadata;
  const [queue, nudge] = await Promise.all([
    mineQueue(allQueue, { userId: viewerId, role: viewerRoleNow }),
    shell.deck ? loadDealNudge(allQueue, { userId: viewerId, role: viewerRoleNow }, parseDealTimes(viewerMeta), parseDeckSeen(viewerMeta)) : Promise.resolve(null),
  ]);
  const dealReady = nudge && nudge.ready ? dealReadyLine(nudge.label, nudge.count) : null;
  const railPinned = railIsPinned(cookieStore.get(RAIL_PIN_COOKIE)?.value);
  // A hint cookie with no open preview behind it (closed by the database, or View as not on): clear it, or the proxy
  // refuses every write until it expires.
  const staleHint = Boolean(cookieStore.get(VIEW_AS_COOKIE)?.value) && resolved?.previewState === "off";

  return (
    <div className="lx-app">
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      {viewAs ? (
        <ViewAsBanner kind="name" name={viewAs.targetName} />
      ) : resolved?.previewState === "unknown" ? (
        <ViewAsBanner kind="unchecked" />
      ) : previewing ? (
        <ViewAsBanner kind="team" />
      ) : staleHint ? (
        <StalePreviewCookie />
      ) : null}
      {actingAsStaff && !viewAs && (
        <div role="status" className="lx-staff-bar">
          {staffInsideFirm(org.name)}
        </div>
      )}
      <header className={shell.look ? `lx-top lx-top--owner${shell.look === "team" ? " lx-top--team" : ""}` : "lx-top"}>
        <div className="lx-wordmark" title={org.name}>
          <FirmWordmark org={org} />
        </div>
        {!shell.look && <SectionLabel />}
        <div className="lx-top-spacer" />
        {viewAs ? <PreviewBell name={viewAs.targetName} /> : <NotificationBell />}
        <AccountMenu
          initials={initialsOf(viewAs ? viewAs.targetName : displayName)}
          name={viewAs ? viewAs.targetName : displayName}
          email={user.email ?? null}
          role={viewerRoleNow}
          firmName={org.name}
          activeOrgId={org.id}
          switchableFirms={switchableFirms}
          viewMenu={viewMenu}
          settingsInMenu={shell.settingsInMenu}
          variant={shell.variant}
          deck={shell.deck}
          look={shell.look}
          viewAsLink={viewAsLink}
          previewing={viewAs ? { name: viewAs.targetName } : undefined}
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
          deck={shell.deck}
          look={shell.look}
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
        reports={shell.showReports}
        more={shell.showMore}
        variant={shell.variant}
        deck={shell.deck}
        look={shell.look}
        dealReady={dealReady}
      />
      {previewing ? (
        // A preview: no Copilot (it would answer with the owner's access and save to the owner's history), no tour,
        // welcome deal, Getting started runner, or name / deal-times / feedback dialogs. The courtesy submit guard only.
        <ReadOnlyPreview />
      ) : (
        <>
          <CopilotLauncher configured={aiConfigured()} />
          <FeedbackTrailRecorder />
          <FeedbackDialog />
          <NoShowNotices />
          {shell.deck && <DealTimesDialog current={parseDealTimes(user.user_metadata)} zoneLabel={friendlyZoneLabel(await getFirmTimeZone())} />}
          <YourNameDialog currentFullName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null} />
          {/* One first-sign-in guide, never both: the owner shell draws the welcome deal, every other shell the tour. */}
          {guideFor(shell.variant) === "welcome" ? (
            <WelcomeDeal open={shouldShowWelcomeDeal({ userMetadata: user.user_metadata, shellVariant: shell.variant, actingAsStaff })} dealTimes={parseDealTimes(user.user_metadata)} persist={!actingAsStaff} />
          ) : (
            <OnboardingTour open={shouldShowTour(user.user_metadata) && !actingAsStaff} role={role} navSlugs={drawn.map((i) => i.slug)} firmName={org.name} aiConfigured={aiConfigured()} />
          )}
          <GettingStartedRunner role={role} modules={org.modules} aiConfigured={aiConfigured()} outlookConnectable={connectableProviders().microsoft} />
        </>
      )}
    </div>
  );
}
