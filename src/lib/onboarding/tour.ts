import { ROLES } from "@/lib/auth/roles";
import { canApproveQueue } from "@/lib/queue/roles";
import { canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";

/**
 * The first-sign-in tour. The seen flag is `user_metadata.lectual_tour` on the
 * person's own Supabase account, so it follows them across devices. It is a UI
 * preference ONLY: user_metadata is user-editable, so it decides whether the
 * tour is drawn and never what anyone may see or do.
 */
export const TOUR_VERSION = 1;

export type TourOutcome = "finished" | "skipped";
export type TourMeta = { version: number; seen_at: string; outcome: TourOutcome };

/** Dispatched on `window` by the account menu's "Show tips again"; the tour listens. */
export const SHOW_TOUR_EVENT = "lectual:show-tour";

export function isTourOutcome(value: unknown): value is TourOutcome {
  return value === "finished" || value === "skipped";
}

/** True when the stored version is missing, malformed or older than `version`. Never throws. */
export function shouldShowTour(userMetadata: unknown, version: number = TOUR_VERSION): boolean {
  if (typeof userMetadata !== "object" || userMetadata === null) return true;
  const stored = (userMetadata as Record<string, unknown>).lectual_tour;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return true;
  const seen = (stored as Record<string, unknown>).version;
  if (typeof seen !== "number" || !Number.isFinite(seen)) return true;
  return seen < version;
}

export function buildTourMeta(outcome: TourOutcome, now: Date, version: number = TOUR_VERSION): TourMeta {
  return { version, seen_at: now.toISOString(), outcome };
}

/** Anything that can dispatch an event (window, or a fake in tests). */
export type EventTargetLike = { dispatchEvent: (event: Event) => boolean };

export function requestTourAgain(target: EventTargetLike): void {
  target.dispatchEvent(new Event(SHOW_TOUR_EVENT));
}

/** The `data-tour` token a rail row carries for a section. Today's slug is "". */
export function navTourToken(slug: string): string {
  return `nav-${slug || "today"}`;
}

/** CSS selector for a step target. `data-tour` holds space-separated tokens, so it is matched with `~=`. */
export function tourSelector(target: string): string {
  return `[data-tour~="${target.replace(/[^a-z0-9-]/gi, "")}"]`;
}

export type TourSide = "top" | "bottom" | "left" | "right";

export type TourStep = {
  id: string;
  /** A `data-tour` token, or null for a centered card. */
  target: string | null;
  title: string;
  body: string;
  side?: TourSide;
  link?: { href: string; label: string };
};

export type TourStepsInput = {
  role: string;
  /** The rail sections this person can see: exactly what the layout hands the rail. */
  navItems: readonly { slug: string }[];
  aiConfigured: boolean;
  firmName?: string;
};

const FIRM_NAME_MAX = 60;

function isKnownRole(role: string): boolean {
  return (ROLES as readonly string[]).includes(role);
}

function firmTitle(firmName: string | undefined): string {
  const name = (firmName ?? "").trim().slice(0, FIRM_NAME_MAX);
  return name ? `Welcome to ${name} on Lectual` : "Welcome to Lectual";
}

/**
 * The tour for one person. A step whose target the person cannot see is
 * dropped, never pointed at: rail steps come from `navItems` (module gates fail
 * closed upstream), Copilot from `aiConfigured`, setup from the admin tier. A
 * role this app does not know gets the read-only wording and no admin step.
 */
export function tourSteps({ role, navItems, aiConfigured, firmName }: TourStepsInput): TourStep[] {
  const slugs = new Set(navItems.map((item) => item.slug));
  const known = isKnownRole(role);
  const readOnly = !known || role === "viewer" || role === "social_media";
  const approves = known && canApproveQueue(role as Parameters<typeof canApproveQueue>[0]);
  const steps: TourStep[] = [];

  steps.push({
    id: "welcome",
    target: null,
    title: firmTitle(firmName),
    body: readOnly
      ? "This is a short look at where things are. You have read-only access, so you can look around freely."
      : "This is a short look at where things are and how your day is laid out. You can skip it at any time.",
  });

  steps.push({
    id: "rail",
    target: "rail",
    side: "right",
    title: "Your sections",
    body: "Everything in the workspace is reached from this rail. Hover it to read the names, or pin it open.",
  });

  if (slugs.has("")) {
    steps.push({
      id: "today",
      target: navTourToken(""),
      side: "right",
      title: "Today",
      body: "Your day at a glance: what needs attention and what is coming up.",
    });
  }

  if (slugs.has("intake")) {
    steps.push({
      id: "intake",
      target: navTourToken("intake"),
      side: "right",
      title: "Intake",
      body: "Your leads, sorted by last touch. Open a lead to see its answers, files and timeline.",
    });
  }

  if (slugs.has("matters")) {
    steps.push({
      id: "matters",
      target: navTourToken("matters"),
      side: "right",
      title: "Matters",
      body: "Open matters with their deadlines, documents and activity in one place.",
    });
  }

  if (slugs.has("queue")) {
    steps.push({
      id: "queue",
      target: navTourToken("queue"),
      side: "right",
      title: "Approval queue",
      body: approves
        ? "Drafts wait here for review. Nothing goes to a client until someone approves it."
        : "You can see the drafts waiting here but not approve them. Nothing goes to a client until someone approves it.",
    });
  }

  if (aiConfigured) {
    steps.push({
      id: "copilot",
      target: "copilot",
      side: "left",
      title: "AI copilot",
      body: "Ask a question about your matters, leads or deadlines. Press Command-J (Ctrl-J elsewhere) to open it from any page.",
    });
  }

  steps.push({
    id: "bell",
    target: "bell",
    side: "bottom",
    title: "Notifications",
    body: "Updates for you show up here and stay inside Lectual. A client never sees them.",
  });

  steps.push({
    id: "account",
    target: "account",
    side: "bottom",
    title: "Your account",
    body: "Switch firm, sign out, or choose Show tips again to see this tour another time.",
  });

  if (known && canSeeSetup(role)) {
    steps.push({
      id: "setup",
      // Never dropped for the admin tier: with no Settings row it is a centered card.
      target: slugs.has("settings") ? navTourToken("settings") : null,
      side: "right",
      title: "Setup and settings",
      body: "The setup checklist shows what is left to switch on for your firm. Settings holds integrations, members and modules.",
      link: { href: SETUP_PATH, label: "Open the setup checklist" },
    });
  }

  steps.push({
    id: "done",
    target: null,
    title: "You are ready",
    body: "That is the tour. You can show it again from the account menu whenever you like.",
  });

  return steps;
}
