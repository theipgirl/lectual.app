"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog } from "@/components/ui/Dialog";

/**
 * A QR code for an intake's link, made in the browser (nothing is uploaded):
 * SVG for print (scales without blurring), PNG for slides and social posts.
 *
 * Error correction "Q" (25%) so a code printed on a banner still scans when
 * part of it is creased or covered. The code always encodes the link as SAVED:
 * renaming the link later keeps the printed one working (0093's alias table).
 */

const OPTS = { errorCorrectionLevel: "Q" as const, margin: 2, color: { dark: "#2A1216", light: "#FFFFFF" } };

function fileBase(slug: string) {
  return `qr-${slug}`;
}

export function IntakeQrButton({
  url,
  name,
  slug,
  compact = false,
  shareable = true,
  describedBy,
}: {
  url: string;
  name: string;
  slug: string;
  compact?: boolean;
  /** False for a draft or archived intake: its link answers nothing, so the code is off. */
  shareable?: boolean;
  /** Id of the element that says why the code is off. */
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.all([QRCode.toString(url, { ...OPTS, type: "svg" }), QRCode.toDataURL(url, { ...OPTS, width: 1200 })])
      .then(([s, p]) => {
        if (!live) return;
        setSvg(s);
        setPng(p);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, url]);

  if (!shareable) {
    return (
      <button type="button" className={compact ? "lx-btn lx-btn-sm lx-btn-ghost" : "lx-btn lx-btn-sec"} disabled aria-describedby={describedBy}>
        QR code
      </button>
    );
  }

  const svgHref = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;

  return (
    <>
      <button type="button" className={compact ? "lx-btn lx-btn-sm lx-btn-ghost" : "lx-btn lx-btn-sec"} onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
        aria-haspopup="dialog">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2" />
        </svg>
        QR code
      </button>
      {open && (
        <Dialog
          size="sm"
          title={`QR code · ${name}`}
          titleId="ifq-title"
          onClose={() => setOpen(false)}
          footer={
            <>
              <a className="lx-btn lx-btn-sec" href={svgHref} download={`${fileBase(slug)}.svg`} aria-disabled={!svgHref}>
                Download SVG (print)
              </a>
              <a className="lx-btn lx-btn-pri" href={png ?? undefined} download={`${fileBase(slug)}.png`} aria-disabled={!png}>
                Download PNG
              </a>
            </>
          }
        >
          <div className="ifq-code">
            {failed ? (
              <p className="ifm-help">Couldn&apos;t make the code. Reload the page and try again.</p>
            ) : png ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={png} alt={`QR code for ${url}`} width={240} height={240} />
            ) : (
              <span className="ifm-spin" aria-label="Making the code" />
            )}
          </div>
          <p className="ifq-url">{url.replace(/^https?:\/\//, "")}</p>
          <p className="ifm-help">Test it with your phone camera before you print. If you rename the link later, this code keeps working.</p>
        </Dialog>
      )}
    </>
  );
}
