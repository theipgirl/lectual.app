import { describe, it, expect, vi } from "vitest";
import { createMailboxDraft, gmailRawMessage } from "@/lib/mailbox/drafts";

describe("creating a draft (never sending)", () => {
  it("builds a Gmail message that survives non-ASCII and can't be header-injected", () => {
    const raw = Buffer.from(gmailRawMessage({ to: "a@example.com\r\nBcc: evil@example.com", subject: "Your mark — next steps", body: "Hi Amara,\n\nThanks." }), "base64url").toString("utf8");
    expect(raw).toMatch(/^To: a@example\.com Bcc: evil@example\.com\r\n/); // folded onto one line, not a new header
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain(Buffer.from("Hi Amara,\n\nThanks.").toString("base64"));
  });

  it("Gmail: POSTs to drafts, not send", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "d1" }), { status: 200 }));
    await createMailboxDraft("google", { accessToken: "at", draft: { to: "a@b.com", subject: "s", body: "b" }, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(url).not.toContain("send");
    expect(init.method).toBe("POST");
  });

  it("Outlook: creates a message (lands in Drafts), never calls sendMail", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "m1", webLink: "https://outlook/m1" }), { status: 201 }));
    const out = await createMailboxDraft("microsoft", { accessToken: "at", draft: { to: null, subject: "s", body: "b" }, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(JSON.parse(init.body as string)).toMatchObject({ toRecipients: [], body: { contentType: "Text", content: "b" } });
    expect(out.webLink).toBe("https://outlook/m1");
  });

  it("a withdrawn connection asks for a reconnect", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    await expect(createMailboxDraft("google", { accessToken: "at", draft: { to: null, subject: "s", body: "b" }, fetchImpl })).rejects.toMatchObject({ code: "reauth" });
  });
});
