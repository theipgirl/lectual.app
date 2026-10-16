import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkFathomKeyShape, listFathomMeetings, mapFathomMeeting, verifyFathomKey, FATHOM_API_BASE } from "@/lib/meetings/fathom";
import {
  exchangeZoomCode,
  listZoomMeetings,
  mapZoomMeeting,
  parseVtt,
  refreshZoomToken,
  zoomAuthorizeUrl,
  zoomWindows,
} from "@/lib/meetings/zoom";
import { MeetingAuthError } from "@/lib/meetings/types";

// Recorded fixtures, shaped from the providers' documented examples
// (developers.fathom.ai list-meetings; Zoom GET /users/{userId}/recordings).
// Nothing here reaches Fathom or Zoom: every request goes to a fake fetch.
const fx = (f: string) => readFileSync(path.join(__dirname, "../fixtures/meetings", f), "utf8");
const page1 = JSON.parse(fx("fathom-meetings-page1.json"));
const page2 = JSON.parse(fx("fathom-meetings-page2.json"));
const zoomList = JSON.parse(fx("zoom-recordings.json"));
const vtt = fx("zoom-transcript.vtt");

type Call = { url: string; init?: RequestInit };
function fakeFetch(route: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return route(url, init);
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Fathom mapping", () => {
  it("maps the documented Meeting object: title, times, invitees, speaker-labelled transcript, summary, share link", () => {
    const m = mapFathomMeeting(page1.items[0])!;
    expect(m.externalId).toBe("123456789");
    expect(m.title).toBe("QBR 2025 Q1");
    expect(m.startedAt).toBe("2025-03-01T16:01:12Z");
    expect(m.durationSeconds).toBe(3583);
    expect(m.attendees).toEqual([
      { name: "Alice Johnson", email: "alice.johnson@acme.com" },
      { name: "Bob Client", email: "bob@clientco.com" },
    ]);
    expect(m.hostEmails).toEqual(["alice.johnson@acme.com"]);
    expect(m.transcript).toEqual([
      { speaker: "Alice Johnson", text: "Let's revisit the budget allocations.", at: "00:05:32" },
      { speaker: "Bob Client", text: "Sounds good.", at: "00:05:40" },
    ]);
    expect(m.summary).toContain("We reviewed Q1 OKRs");
    expect(m.shareUrl).toBe("https://fathom.video/share/xyz123");
    expect(m.cursorAt).toBe("2025-03-01T17:01:30Z");
  });

  it("a meeting with no transcript or summary maps to nulls, not empty strings", () => {
    const m = mapFathomMeeting(page2.items[0])!;
    expect(m.transcript).toBeNull();
    expect(m.summary).toBeNull();
    expect(m.title).toBe("Trademark consult");
  });

  it("pages with the key in X-Api-Key, asks for transcript + summary, and follows next_cursor", async () => {
    const { fn, calls } = fakeFetch((url) => json(url.includes("cursor=") ? page2 : page1));
    const out = await listFathomMeetings({ key: "firm-key", since: "2025-02-01T00:00:00.000Z", fetchImpl: fn });
    expect(out.truncated).toBe(false);
    expect(out.meetings.map((m) => m.externalId)).toEqual(["123456789", "987654321"]);
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0].url);
    expect(first.origin + first.pathname).toBe(`${FATHOM_API_BASE}/meetings`);
    expect(first.searchParams.get("include_transcript")).toBe("true");
    expect(first.searchParams.get("include_summary")).toBe("true");
    expect(first.searchParams.get("created_after")).toBe("2025-02-01T00:00:00.000Z");
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe(page1.next_cursor);
    expect((calls[0].init?.headers as Record<string, string>)["X-Api-Key"]).toBe("firm-key");
  });

  it("stops at the page cap and says it was truncated", async () => {
    const { fn } = fakeFetch(() => json(page1));
    const out = await listFathomMeetings({ key: "k", since: "2025-01-01T00:00:00Z", fetchImpl: fn, maxPages: 3 });
    expect(out.truncated).toBe(true);
  });

  it("a 401 is an auth error (the connection needs an admin), not a generic failure", async () => {
    const { fn } = fakeFetch(() => json({ error: "unauthorized" }, 401));
    await expect(listFathomMeetings({ key: "k", since: "2025-01-01T00:00:00Z", fetchImpl: fn })).rejects.toBeInstanceOf(MeetingAuthError);
  });

  it("checks a key with one cheap call before saving it", async () => {
    const ok = fakeFetch(() => json({ items: [] }));
    expect(await verifyFathomKey("good-key-1234567890", ok.fn)).toEqual({ ok: true });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0].url).toBe(`${FATHOM_API_BASE}/meetings`);
    const bad = fakeFetch(() => json({}, 401));
    expect((await verifyFathomKey("bad-key-1234567890", bad.fn)).ok).toBe(false);
    expect(checkFathomKeyShape("  ").ok).toBe(false);
    expect(checkFathomKeyShape("has a space in it here").ok).toBe(false);
    expect(checkFathomKeyShape(" abcdefghijklmnopqrstuvwxyz ")).toEqual({ ok: true, key: "abcdefghijklmnopqrstuvwxyz" });
  });
});

describe("Zoom mapping", () => {
  it("parses Zoom's VTT into speaker turns, merging consecutive cues and reading <v> tags", () => {
    expect(parseVtt(vtt)).toEqual([
      { speaker: "Taylor Atty", text: "Thanks for joining. Tell me about the brand.", at: "00:00:01" },
      { speaker: "Dana Founder", text: "We launched MarkRight six months ago. Mostly online sales.", at: "00:00:04" },
      { speaker: "Taylor Atty", text: "Great, let's check clearance.", at: "00:00:09" },
    ]);
  });

  it("maps a recording: uuid as the id, minutes to seconds, speakers as name-only attendees, host kept aside", () => {
    const m = mapZoomMeeting(zoomList.meetings[0], parseVtt(vtt))!;
    expect(m.externalId).toBe("4444AAAiAAAAAiAiAiiAii==");
    expect(m.durationSeconds).toBe(2700);
    expect(m.attendees).toEqual([
      { name: "Taylor Atty", email: null },
      { name: "Dana Founder", email: null },
    ]);
    expect(m.hostEmails).toEqual(["atty@firm.example"]);
    expect(m.shareUrl).toBe("https://example.zoom.us/rec/share/abc");
  });

  it("lists recordings, downloads the transcript with the Bearer token, and never sends the token off zoom.us", async () => {
    const { fn, calls } = fakeFetch((url) => (url.includes("/users/me/recordings") ? json(zoomList) : new Response(vtt)));
    const out = await listZoomMeetings({ accessToken: "zoom-at", since: "2025-03-01T00:00:00Z", now: Date.parse("2025-03-10T00:00:00Z"), fetchImpl: fn });
    expect(out.meetings).toHaveLength(2);
    expect(out.meetings[0].transcript?.length).toBe(3);
    expect(out.meetings[1].transcript).toBeNull();
    expect(calls.some((c) => c.url.includes("attacker.example"))).toBe(false);
    const download = calls.find((c) => c.url.endsWith("/rec/download/vtt"))!;
    expect((download.init?.headers as Record<string, string>).Authorization).toBe("Bearer zoom-at");
  });

  it("splits the look-back into windows of at most 30 days", () => {
    const w = zoomWindows("2025-01-01T00:00:00Z", Date.parse("2025-03-05T12:00:00Z"));
    expect(w[0]).toEqual({ from: "2025-01-01", to: "2025-01-30" });
    expect(w.at(-1)!.to).toBe("2025-03-05");
    for (const x of w) expect((Date.parse(x.to) - Date.parse(x.from)) / 86_400_000).toBeLessThanOrEqual(29);
  });

  it("authorize URL carries the nonce and an S256 PKCE challenge, never the verifier", () => {
    const url = new URL(zoomAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.example/api/meetings/zoom/callback/", nonce: "n1", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("n1");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges the code with Basic auth + code_verifier, and a refresh keeps the ROTATED refresh token", async () => {
    const { fn, calls } = fakeFetch(() => json({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "cloud_recording:read:list_user_recordings" }));
    const t = await exchangeZoomCode({ creds: { clientId: "cid", clientSecret: "sec" }, code: "c", verifier: "v", redirectUri: "https://r/", fetchImpl: fn, now: 0 });
    expect(t).toMatchObject({ accessToken: "at2", refreshToken: "rt2", expiresAt: new Date(3_600_000).toISOString() });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v");
    const r = await refreshZoomToken({ creds: { clientId: "cid", clientSecret: "sec" }, refreshToken: "rt1", fetchImpl: fn, now: 0 });
    expect(r.refreshToken).toBe("rt2");
  });

  it("a dead refresh token is an auth error", async () => {
    const { fn } = fakeFetch(() => json({ reason: "Invalid Token!", error: "invalid_grant" }, 400));
    await expect(refreshZoomToken({ creds: { clientId: "c", clientSecret: "s" }, refreshToken: "x", fetchImpl: fn })).rejects.toBeInstanceOf(MeetingAuthError);
  });
});
