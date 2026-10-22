import type { OrgModule } from "@/lib/org/modules";
import type { Role } from "@/lib/auth/roles";

/**
 * The staff-run skills this app already has, as a fixed list written here. The lectual-plugin holds
 * prompts for Cowork, not UI: nothing is read from it at runtime, and the wording below is this app's
 * own summary of what each existing action does. PURE: no database, no `server-only`.
 *
 * Every skill lands on a place that already exists. The catalog adds no action of its own, so
 * a card can only ever open the real form or panel on a chosen record.
 */

export type RecordKind = "lead" | "matter";

export type SkillSlug =
  | "prep-consult"
  | "engagement-letter"
  | "welcome-client"
  | "filing-follow-up"
  | "opinion-letter"
  | "trademark-clearance"
  | "meeting-follow-up";

export type Skill = {
  slug: SkillSlug;
  name: string;
  /** What it does, in plain words. */
  does: string;
  /** What it reads, in the record kinds it uses. */
  reads: string;
  /** Which records "Run it on..." lists. */
  picks: readonly RecordKind[];
  /** Only matters of these types are listed (the type code, e.g. "TM"). */
  matterTypes?: readonly string[];
  /** The module the destination page needs. A firm without it is not sent there. */
  module: OrgModule;
  /** Where the link lands, in a few words, so the card says what one click does. */
  lands: string;
  /** The link for one chosen record. Built from the record's id only. */
  href: (kind: RecordKind, id: string) => string;
  /** A plain link beside the picker, for something the picker can't reach. */
  extra?: { label: string; href: string };
};

/** The words every card carries. */
export const DRAFTS_ONLY = "Drafts only, attorney reviews";

/** The matter type the Welcome a client skill is limited to. */
export const TRADEMARK_MATTER_TYPE = "TM";

/** Anchors on the existing pages. Defined once so a page and a link cannot drift apart. */
export const PREP_CONSULT_ANCHOR = "prep-consult";
export const CLIENT_UPDATES_ANCHOR = "client-updates";

const leadPage = (id: string) => `/dashboard/leads/${encodeURIComponent(id)}/`;
const matterPage = (id: string) => `/dashboard/matters/${encodeURIComponent(id)}/`;
const documentForm = (id: string, form: "loe" | "opinion-letter" | "trademark-clearance") =>
  `/dashboard/documents/new/${encodeURIComponent(id)}/${form}/`;

export const SKILLS: readonly Skill[] = [
  {
    slug: "prep-consult",
    name: "Prep a consult",
    does: "Drafts an internal heads-up for the attorney and a short email telling the client what to have ready for the call, from the facts on the lead's record. It never picks classes, a package or a price.",
    reads: "A lead: contact details, intake answers and the booked consult",
    picks: ["lead"],
    module: "agent-toolkit",
    lands: "the lead's page, at Prep this consult",
    href: (_kind, id) => `${leadPage(id)}#${PREP_CONSULT_ANCHOR}`,
  },
  {
    slug: "engagement-letter",
    name: "Draft the engagement letter",
    does: "Opens the engagement-letter form for a matter, filled in from its signed quote when it has one, and holds the draft for review.",
    reads: "A matter and its signed quote",
    picks: ["matter"],
    module: "document-center",
    lands: "the engagement-letter form",
    href: (_kind, id) => documentForm(id, "loe"),
  },
  {
    slug: "welcome-client",
    name: "Welcome a client",
    does: "Drafts the welcome email for a new trademark client into the approval queue. Only the client's name, the mark and the matter number are filled in.",
    reads: "A trademark matter: client name, mark and matter number",
    picks: ["matter"],
    matterTypes: [TRADEMARK_MATTER_TYPE],
    module: "agent-toolkit",
    lands: "the matter's page, at Client updates",
    href: (_kind, id) => `${matterPage(id)}#${CLIENT_UPDATES_ANCHOR}`,
  },
  {
    slug: "filing-follow-up",
    name: "Filing follow-up",
    does: "Drafts the next monthly status update for an application that is waiting on registration, one month at a time. The card appears on a matter that has a mark and is in Awaiting Trademark Registration.",
    reads: "A matter: mark, filing date and the updates already drafted",
    picks: ["matter"],
    module: "agent-toolkit",
    lands: "the matter's page, at Client updates",
    href: (_kind, id) => `${matterPage(id)}#${CLIENT_UPDATES_ANCHOR}`,
  },
  {
    slug: "opinion-letter",
    name: "Opinion letter",
    does: "Assembles a draft opinion letter from the search report you upload, following the attorney's own starring. It assembles; it does not redo the analysis.",
    reads: "A matter and the search report you upload",
    picks: ["matter"],
    module: "document-center",
    lands: "the opinion-letter form",
    href: (_kind, id) => documentForm(id, "opinion-letter"),
  },
  {
    slug: "trademark-clearance",
    name: "Trademark clearance",
    does: "Writes a preliminary clearance draft from the search findings you type in. It is marked preliminary and is never a substitute for the full search and opinion.",
    reads: "A matter and the findings you enter",
    picks: ["matter"],
    module: "document-center",
    lands: "the clearance form",
    href: (_kind, id) => documentForm(id, "trademark-clearance"),
  },
  {
    slug: "meeting-follow-up",
    name: "Meeting follow-up",
    does: "Drafts a follow-up email from a recorded meeting's transcript into the approval queue. It works on a recorded meeting, so this opens the lead or matter the meeting is filed on, where its Meetings panel lists the recordings.",
    reads: "A recorded meeting filed on a lead or matter",
    picks: ["lead", "matter"],
    module: "agents",
    lands: "the record's page, at its Meetings panel",
    href: (kind, id) => (kind === "lead" ? leadPage(id) : matterPage(id)),
    extra: { label: "Open Meetings", href: "/dashboard/meetings/" },
  },
];

export function skillBySlug(slug: unknown): Skill | undefined {
  return SKILLS.find((s) => s.slug === slug);
}

/** The skills that exist only in Claude (the Cowork plugin). Text only: nothing here can be run from this app. */
export const COWORK_SKILLS: readonly { name: string; line: string }[] = [
  { name: "Start my day", line: "Runs the morning briefing, preps every consult on today's calendar and shows the dashboard." },
  { name: "End my day", line: "Sweeps USPTO deadlines, drafts follow-ups for stalled matters and shows the approval queue." },
  { name: "Triage the pipeline", line: "Ranks the day's pipeline work: who to follow up with and which leads have stalled." },
  { name: "Monday review", line: "Builds the deadline-first weekly review of the trademark docket." },
  { name: "Weekly wrap", line: "Closes out the week: next week's deadlines, monthly status drafts and anything still pending." },
  { name: "Process a consult", line: "Reads the Zoom notes after a consult and drafts the post-consult email for review." },
  { name: "Wrap a consult", line: "Processes a consult into a queued draft and refreshes the approval queue in one move." },
  { name: "Show my dashboard", line: "Builds an interactive view of daily tasks, the approval queue and the pipeline." },
  { name: "Manage the pipeline", line: "Moves a matter between stages or tags a contact in Lawmatics." },
];

/**
 * Who sees pickers. Mirrors CAN_WRITE_LEAD and MATTER_WRITE_ROLES (every staff role except
 * social media and viewer); the pages the links open check the role again themselves. Kept as
 * its own list so this pure module pulls in no database code; a test holds the two equal.
 */
export const SKILL_RUN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"];

export const canRunSkills = (role: Role | null | undefined): boolean => !!role && SKILL_RUN_ROLES.includes(role);

/** Whether a firm holding `modules` can be sent to the skill's destination. The Skills page itself needs agent-toolkit. */
export function skillAvailable(skill: Skill, modules: readonly string[]): boolean {
  return skill.module === "agent-toolkit" || modules.includes(skill.module);
}
