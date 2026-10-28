"use client";

import { useState } from "react";
import { channelLinks } from "@/lib/intake-forms/utm";
import { NOT_LIVE_MESSAGE } from "@/lib/intake-forms/share";
import { IntakeQrButton } from "./IntakeQr";

/**
 * Share → "Links for each channel": the intake's link with utm tags for
 * Instagram, LinkedIn, Facebook, TikTok, your website, an email signature and
 * an event QR, each with Copy and a QR code. When someone arrives on one, the
 * lead is stamped with that channel and Results counts them under it.
 *
 * Only a live form has links to hand out (`shareable`, from `shareState`): a
 * draft or archived one shows the not-live sentence and no URLs at all.
 */
export function IntakeLinksForChannels({
  slug,
  name,
  sourceTag,
  origin,
  shareable,
}: {
  slug: string;
  name: string;
  sourceTag: string | null;
  origin: string;
  shareable: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!shareable) {
    return (
      <div className="ifm-field">
        <span className="ifm-field-label">Links for each channel</span>
        <span className="ifm-help">{NOT_LIVE_MESSAGE}</span>
      </div>
    );
  }
  const links = channelLinks(slug, sourceTag, origin);
  const copy = (key: string, url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
      },
      () => setCopied(null),
    );
  };
  return (
    <div className="ifm-field">
      <span className="ifm-field-label">Links for each channel</span>
      <span className="ifm-help">Use a different link wherever you share this form. Results then shows how many people came from each one.</span>
      <ul className="ifl-chan">
        {links.map((l) => (
          <li key={l.key}>
            <span>{l.label}</span>
            <span className="ifl-chan-url" title={l.url}>
              {l.url.replace(/^https?:\/\//, "")}
            </span>
            <button type="button" className="lx-btn lx-btn-sm lx-btn-sec" onClick={() => copy(l.key, l.url)} aria-label={`Copy the ${l.label} link`}>
              {copied === l.key ? "Copied" : "Copy"}
            </button>
            <IntakeQrButton url={l.url} name={`${name} · ${l.label}`} slug={`${slug}-${l.key}`} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}
