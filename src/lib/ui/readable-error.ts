/**
 * An error whose message was written as a sentence for a person. The friendly*Error helpers pass
 * only these through; any other Error (a queue 502, a missing env var, a timeout) becomes the
 * caller's fixed fallback. Never build one from a caught error's own text.
 */
export class ReadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadableError";
  }
}

/** Env-var shaped token (QUEUE_API_URL) or a raw queue/transport message: never a sentence for a person. */
const LEAKY = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]{2,}\b|\bQueue API\b/;

/**
 * The message of a typed, person-written error, or null. A typed message that still looks like a
 * transport or env leak is refused as well, so a careless `new ReadableError(err.message)` cannot
 * smuggle one through.
 */
export function readableMessage(err: unknown): string | null {
  if (!(err instanceof ReadableError)) return null;
  const msg = err.message.trim();
  if (!msg || LEAKY.test(msg)) return null;
  return msg;
}

/** True for the queue client's own errors (not configured, 4xx/5xx), which have a fixed sentence of their own. */
export function isQueueError(err: unknown): boolean {
  return err instanceof Error && /\bQueue API\b/.test(err.message);
}
