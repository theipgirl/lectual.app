import { intakePublicUrl } from "./links";

/**
 * Where a person came from, read off the link they used (`?utm_source=ig&...`).
 *
 * THIS FILE IS THE ONLY PLACE THE RULES LIVE: the page, the start action, the
 * store, the Lawmatics tags, the link generator and Results all call it.
 *
 * The values are attribution labels, never access, pricing or routing, but
 * they come from a URL anyone can edit and they end up in a lead's text and
 * in tag names, so each one is held to a small alphabet. A value that doesn't
 * fit is DROPPED WHOLE, not cleaned up: a half-sanitised label would look like
 * data. `fbclid`, `gclid` and every other key are ignored.
 */

export type Utm = { source?: string; medium?: string; campaign?: string; content?: string };

const UTM_MAX = 64;
const UTM_SHAPE = /^[A-Za-z0-9_.-]+$/;
const KEYS = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_content", "content"],
] as const;

function one(v: unknown): string | null {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first !== "string") return null;
  const t = first.trim();
  return t.length > 0 && t.length <= UTM_MAX && UTM_SHAPE.test(t) ? t : null;
}

function readKeys(r: Record<string, unknown>, names: (k: (typeof KEYS)[number]) => string): Utm {
  const out: Utm = {};
  for (const k of KEYS) {
    const v = one(r[names(k)]);
    if (v) out[k[1]] = v;
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The link's query (`searchParams`; string or string[] per key, first wins). Reads ONLY the four `utm_*` names; `source=`, `campaign=` and every other key are ignored. */
export function parseUtmParams(searchParams: unknown): Utm {
  return isRecord(searchParams) ? readKeys(searchParams, (k) => k[0]) : {};
}

/** A stored or posted `{ source, medium, campaign, content }`. Not for a URL: use `parseUtmParams`. */
export function parseUtm(input: unknown): Utm {
  return isRecord(input) ? readKeys(input, (k) => k[1]) : {};
}

/** The utm stored on a submission's `contact` jsonb (`contact.utm`), or {}. */
export function utmFromContact(contact: unknown): Utm {
  return typeof contact === "object" && contact !== null ? parseUtm((contact as { utm?: unknown }).utm) : {};
}

export const hasUtm = (u: Utm): boolean => Boolean(u.source || u.medium || u.campaign || u.content);

/** "ig / social / link_in_bio / UGW-2026": source, medium, content, campaign, absent parts left out. */
export function utmReferralPart(u: Utm): string | null {
  const parts = [u.source, u.medium, u.content, u.campaign].filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}

/**
 * Lawmatics tags. The Lawmatics API can't set its own UTM/pixel fields, so a
 * tag is the reliable way to carry the source onto the person's record.
 */
export function utmTags(u: Utm): string[] {
  const tags: string[] = [];
  if (u.source) tags.push(`UTM: ${u.source}`);
  if (u.campaign) tags.push(`Campaign: ${u.campaign}`);
  return tags;
}

/** The firm's source tag ("UGW 2026") as a campaign value that survives `parseUtm`: spaces to "-", other characters dropped, cut to 64. */
export function campaignFromSourceTag(tag: string | null | undefined): string | null {
  const c = (tag ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .slice(0, UTM_MAX);
  return c || null;
}

export type ChannelKey = "instagram" | "linkedin" | "facebook" | "tiktok" | "website" | "email" | "event";

type Preset = { key: ChannelKey; label: string; source: string; medium: string; content?: string };

export const CHANNEL_PRESETS: readonly Preset[] = [
  { key: "instagram", label: "Instagram bio", source: "ig", medium: "social", content: "link_in_bio" },
  { key: "linkedin", label: "LinkedIn", source: "li", medium: "social" },
  { key: "facebook", label: "Facebook", source: "fb", medium: "social" },
  { key: "tiktok", label: "TikTok", source: "tt", medium: "social" },
  { key: "website", label: "Website", source: "web", medium: "website" },
  { key: "email", label: "Email signature", source: "email", medium: "email" },
  { key: "event", label: "Event QR", source: "event", medium: "event" },
];

/** A readable name for a utm_source code; unknown values come back as typed. */
export function sourceLabel(source: string): string {
  return CHANNEL_PRESETS.find((p) => p.source === source)?.label ?? source;
}

export type ChannelLink = { key: ChannelKey; label: string; url: string; utm: Utm };

/** The seven "Links for each channel": the intake's link with utm tags. The caller offers these only for a live form. */
export function channelLinks(slug: string, sourceTag: string | null | undefined, origin: string): ChannelLink[] {
  const campaign = campaignFromSourceTag(sourceTag);
  return CHANNEL_PRESETS.map((p) => {
    const utm: Utm = { source: p.source, medium: p.medium, ...(p.content ? { content: p.content } : {}), ...(campaign ? { campaign } : {}) };
    const q = new URLSearchParams();
    q.set("utm_source", p.source);
    q.set("utm_medium", p.medium);
    if (campaign) q.set("utm_campaign", campaign);
    if (p.content) q.set("utm_content", p.content);
    return { key: p.key, label: p.label, url: `${intakePublicUrl(origin, slug)}?${q.toString()}`, utm };
  });
}
