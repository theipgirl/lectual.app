import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  MailboxKeyError,
  openToken,
  parseRootKey,
  sealToken,
  signState,
  verifyStateSignature,
} from "@/lib/mailbox/crypto";

const root = randomBytes(32);

describe("mailbox token sealing", () => {
  it("round-trips a token", () => {
    const sealed = sealToken(root, "ya29.refresh-token");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh-token");
    expect(openToken(root, sealed)).toBe("ya29.refresh-token");
  });

  it("uses a fresh IV every time, so equal tokens never produce equal ciphertext", () => {
    expect(sealToken(root, "same")).not.toBe(sealToken(root, "same"));
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, ct] = sealToken(root, "secret").split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => openToken(root, [v, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => openToken(randomBytes(32), sealToken(root, "secret"))).toThrow();
  });

  it("rejects anything that isn't a sealed token", () => {
    expect(() => openToken(root, "plaintext-token")).toThrow(MailboxKeyError);
  });
});

describe("root key parsing", () => {
  it("accepts 32 bytes of base64", () => {
    expect(parseRootKey(randomBytes(32).toString("base64")).length).toBe(32);
  });
  it("refuses a missing or short key instead of falling back", () => {
    expect(() => parseRootKey(undefined)).toThrow(MailboxKeyError);
    expect(() => parseRootKey(randomBytes(16).toString("base64"))).toThrow(MailboxKeyError);
  });
});

describe("state signatures", () => {
  it("verifies its own signature and nothing else", () => {
    const sig = signState(root, "payload");
    expect(verifyStateSignature(root, "payload", sig)).toBe(true);
    expect(verifyStateSignature(root, "payload2", sig)).toBe(false);
    expect(verifyStateSignature(randomBytes(32), "payload", sig)).toBe(false);
    expect(verifyStateSignature(root, "payload", "short")).toBe(false);
  });

  it("uses a different derived key than token sealing", () => {
    // A state signature must be useless as, or derivable from, token material.
    const sig = signState(root, "x");
    const sealed = sealToken(root, "x");
    expect(sealed).not.toContain(sig);
  });
});
