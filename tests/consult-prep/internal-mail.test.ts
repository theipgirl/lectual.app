import { describe, expect, it, vi } from "vitest";
import { cancelInternalMail, sendInternalMail } from "@/lib/mail/internal-mail";

vi.mock("server-only", () => ({}));

const base = { apiKey: "re_key", from: "a@firm.example", to: ["b@firm.example"], subject: "s", text: "t" };
const okFetch = (body: unknown = { id: "re_123" }) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("sendInternalMail: cc, scheduled time and the id", () => {
  it("sends cc and scheduled_at only when given, and returns Resend's id", async () => {
    const f = okFetch();
    const res = await sendInternalMail({ ...base, cc: ["c@firm.example"], scheduledAt: "2026-11-25T14:00:00.000Z", idempotencyKey: "k", fetchImpl: f as never });
    expect(res).toEqual({ status: "sent", id: "re_123" });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ cc: ["c@firm.example"], scheduled_at: "2026-11-25T14:00:00.000Z", to: ["b@firm.example"] });
    const plain = okFetch();
    await sendInternalMail({ ...base, fetchImpl: plain as never });
    const plainBody = JSON.parse((plain.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(plainBody).not.toHaveProperty("cc");
    expect(plainBody).not.toHaveProperty("scheduled_at");
  });
  it("an empty cc list is not sent", async () => {
    const f = okFetch();
    await sendInternalMail({ ...base, cc: [], fetchImpl: f as never });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).not.toHaveProperty("cc");
  });
  it("an answer with no readable id is still a send, with a null id; the body is never returned", async () => {
    const f = vi.fn(async () => new Response("not json SECRET", { status: 200 }));
    const res = await sendInternalMail({ ...base, fetchImpl: f as never });
    expect(res).toEqual({ status: "sent", id: null });
    expect(JSON.stringify(res)).not.toContain("SECRET");
  });
  it("a refusal and a thrown error are failures with no text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await sendInternalMail({ ...base, fetchImpl: (async () => new Response("RESEND BODY b@firm.example", { status: 422 })) as never });
    const thrown = await sendInternalMail({ ...base, fetchImpl: (async () => { throw new Error("boom b@firm.example"); }) as never });
    expect(refused).toEqual({ status: "failed", http: 422 });
    expect(thrown).toEqual({ status: "failed", http: null });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("b@firm.example");
    spy.mockRestore();
  });
});

describe("cancelInternalMail", () => {
  it("POSTs to /emails/{id}/cancel with the key and answers cancelled", async () => {
    const f = okFetch({ object: "email", id: "re_9" });
    expect(await cancelInternalMail({ apiKey: "re_key", id: "re_9", fetchImpl: f as never })).toEqual({ status: "cancelled" });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://api.resend.com/emails/re_9/cancel");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_key");
  });
  it("encodes the id, and a refusal or an error is a failure with no text, never a throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = okFetch();
    await cancelInternalMail({ apiKey: "k", id: "a/b c", fetchImpl: f as never });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.resend.com/emails/a%2Fb%20c/cancel");
    expect(await cancelInternalMail({ apiKey: "k", id: "x", fetchImpl: (async () => new Response("SECRET", { status: 422 })) as never })).toEqual({ status: "failed", http: 422 });
    expect(await cancelInternalMail({ apiKey: "k", id: "x", fetchImpl: (async () => { throw new Error("SECRET"); }) as never })).toEqual({ status: "failed", http: null });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
    spy.mockRestore();
  });
});

describe("sendInternalMail: attachments (S2b)", () => {
  it("sends each file as a name and base64 content, and nothing when there are none", async () => {
    const f = okFetch();
    await sendInternalMail({ ...base, attachments: [{ filename: "a.pdf", content: Buffer.from("PDF!") }, { filename: "b.xlsx", content: "eGxzeA==" }], fetchImpl: f as never });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.attachments).toEqual([
      { filename: "a.pdf", content: Buffer.from("PDF!").toString("base64") },
      { filename: "b.xlsx", content: "eGxzeA==" },
    ]);
    const none = okFetch();
    await sendInternalMail({ ...base, attachments: [], fetchImpl: none as never });
    expect(JSON.parse((none.mock.calls[0] as unknown as [string, { body: string }])[1].body)).not.toHaveProperty("attachments");
  });
  it("never logs a file name or its content on a refusal", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendInternalMail({ ...base, attachments: [{ filename: "Dana_Packages.pdf", content: Buffer.from("x") }], fetchImpl: (async () => new Response("", { status: 422 })) as never });
    expect(res).toEqual({ status: "failed", http: 422 });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Dana");
    spy.mockRestore();
  });
});
