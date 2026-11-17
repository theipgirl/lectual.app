import { after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { completeStartedIntake, readIntakeHandle, recordIntakeEvent, startPublicIntake } from "@/lib/intake-forms/public";
import { syncIntakeCompletion, syncIntakeStart } from "@/lib/intake-forms/lawmatics-sync";
import { intakeSalt } from "@/lib/intake-forms/secrets";
import { SlidingWindowThrottle } from "@/lib/intake-forms/spam";
import { sendInternalMail } from "@/lib/mail/internal-mail";
import { bookingLinkFor } from "@/lib/worksheet/booking-link-live";
import { fullName } from "@/lib/worksheet/answers";
import {
  DEFAULT_ALLOWED_ORIGINS,
  handleWorksheetPost,
  preflight,
  WORKSHEET_MESSAGES,
  type WorksheetConfig,
  type WorksheetResponse,
} from "@/lib/worksheet/handle";
import { WORKSHEET_BODY_MAX } from "@/lib/worksheet/schema";

/**
 * The master-class worksheet's endpoint (lectual-plugin `sites/rpb-masterclass/trademark/worksheet/`, SUBMIT_MODE
 * "post-json"). Public and unauthenticated: the rules are in src/lib/worksheet/handle.ts. The trailing slash matters
 * (`trailingSlash: true` would 308 a POST to `/api/worksheet`, and a redirected preflight fails), so the page posts to
 * `/api/worksheet/`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In memory, per server instance: a courtesy limit, not a wall (the same as the public intake's throttles).
const ipThrottle = new SlidingWindowThrottle(20, 10 * 60_000);
const emailThrottle = new SlidingWindowThrottle(4, 10 * 60_000);
const inFlight = new Set<string>();

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function config(): WorksheetConfig {
  const origins = list(env.WORKSHEET_ALLOWED_ORIGINS).filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
  return {
    slug: env.WORKSHEET_INTAKE_SLUG?.trim() || null,
    allowedOrigins: origins.length ? origins : [...DEFAULT_ALLOWED_ORIGINS],
    notifyTo: list(env.WORKSHEET_NOTIFY_TO),
    from: env.WORKSHEET_FROM?.trim() || null,
    replyTo: env.WORKSHEET_REPLY_TO?.trim() || null,
    resendKey: env.RESEND_API_KEY?.trim() || null,
    tokenKey: intakeSalt(),
    lawmaticsSync: env.WORKSHEET_LAWMATICS_SYNC?.trim().toLowerCase() === "on",
  };
}

function toResponse(r: WorksheetResponse): Response {
  if (r.status === 204) return new Response(null, { status: 204, headers: r.headers });
  return Response.json(r.body, { status: r.status, headers: r.headers });
}

export async function OPTIONS(req: NextRequest): Promise<Response> {
  return toResponse(preflight(req.headers.get("origin"), config().allowedOrigins));
}

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = config();
  try {
    // Read at most a little past the cap, so an oversized body is refused without holding all of it.
    const declared = Number(req.headers.get("content-length") ?? "0");
    const rawBody = declared > WORKSHEET_BODY_MAX * 2 ? "x".repeat(WORKSHEET_BODY_MAX + 1) : await req.text();
    const result = await handleWorksheetPost(
      { headers: req.headers, rawBody },
      {
        config: cfg,
        readHandle: readIntakeHandle,
        start: startPublicIntake,
        complete: (handle, token, answers, mode, now) => completeStartedIntake(handle, token, answers, mode, now),
        recordEvent: (handle, kind) => recordIntakeEvent(handle, kind, null),
        mail: sendInternalMail,
        bookingLinkFor,
        lawmatics: async (handle, submissionId, input, noteBody) => {
          const contact = {
            name: fullName(input),
            email: input.contact.email.toLowerCase(),
            phone: "",
            company: input.contact.business,
          };
          after(async () => {
            await syncIntakeStart(handle, submissionId, contact);
            await syncIntakeCompletion(handle, submissionId, {
              contact,
              note: { name: `Intake: ${handle.sourceTag ?? handle.name}`, body: noteBody },
            });
          });
        },
        now: () => new Date(),
        ipThrottle,
        emailThrottle,
        inFlight,
      },
    );
    return toResponse(result);
  } catch {
    console.error("[worksheet] the request failed");
    return toResponse({
      status: 503,
      body: { ok: false, error: WORKSHEET_MESSAGES.failed },
      headers: preflight(req.headers.get("origin"), cfg.allowedOrigins).headers,
    });
  }
}
