import "server-only";

import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { makeStamp } from "./spam";

/**
 * `INTAKE_EVENT_SALT`, or null when unset (sessions then go unhashed and
 * render stamps unsigned — see spam.ts).
 */
export function intakeSalt(): string | null {
  const v = env.INTAKE_EVENT_SALT?.trim();
  return v ? v : null;
}

/**
 * The key for the in-memory throttle's IP hash. The salt when there is one;
 * otherwise a per-process random key that is never written anywhere — the
 * hashes it makes live only in this instance's memory anyway.
 */
const processKey = randomBytes(32).toString("base64url");
export function throttleKey(): string {
  return intakeSalt() ?? processKey;
}

/** The render stamp for `/i/<slug>`: now, and where the visitor came from. */
export function renderStamp(formId: string, sourceHost: string | null): string {
  return makeStamp({ formKey: formId, now: Date.now(), host: sourceHost, key: intakeSalt() });
}
