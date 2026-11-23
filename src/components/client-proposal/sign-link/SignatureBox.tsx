"use client";

import { useEffect, useRef, useState } from "react";
import { CLEAR_LABEL, DRAW_INSTEAD_LABEL, SIGNATURE_STEP_NAME, TYPED_SIGNATURE_LABEL, TYPE_INSTEAD_LABEL } from "@/lib/loe/client-words";

/**
 * The signature box (Sprint A item 14). No dependency: a `<canvas>` with pointer events (mouse, pen and touch; `touch-action:
 * none` on the canvas only), Clear, and a radio between drawing and typing. The radio comes FIRST in the focus order, so a keyboard
 * user reaches "Type it instead" before the canvas. Typing draws the typed legal name in the one `print` style, in the page's own
 * body face (no style picker). The drawing is exported at most 600 x 200 px; over 100 KB is refused here and on the server.
 */

export const BOX_WIDTH = 600;
export const BOX_HEIGHT = 200;
export const MAX_PNG_BYTES = 102_400;

export type SignatureValue = { kind: "drawn"; png: string } | { kind: "typed"; style: "print" } | null;

/** Bytes in a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function SignatureBox({
  typedName,
  boxNote,
  onChange,
  disabled,
}: {
  typedName: string;
  boxNote: string;
  onChange: (value: SignatureValue, tooLarge: boolean) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"drawn" | "typed">("drawn");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  useEffect(() => {
    if (mode === "typed") onChange({ kind: "typed", style: "print" }, false);
    else onChange(null, false);
    drew.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reported once per mode change only.
  }, [mode]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || !canvas.current) return;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    canvas.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !canvas.current) return;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drew.current = true;
  }

  function end() {
    if (!drawing.current || !canvas.current) return;
    drawing.current = false;
    if (!drew.current) return;
    const png = canvas.current.toDataURL("image/png");
    const tooLarge = dataUrlBytes(png) > MAX_PNG_BYTES;
    onChange(tooLarge ? null : { kind: "drawn", png }, tooLarge);
  }

  function clear() {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    drew.current = false;
    onChange(null, false);
  }

  return (
    <div className="cp-sl-box">
      <fieldset className="cp-sl-mode" disabled={disabled}>
        <legend className="cp-sl-legend">{SIGNATURE_STEP_NAME}</legend>
        <label className="cp-sl-radio">
          <input type="radio" name="sig-mode" value="typed" checked={mode === "typed"} onChange={() => setMode("typed")} />
          <span>{TYPE_INSTEAD_LABEL}</span>
        </label>
        <label className="cp-sl-radio">
          <input type="radio" name="sig-mode" value="drawn" checked={mode === "drawn"} onChange={() => setMode("drawn")} />
          <span>{DRAW_INSTEAD_LABEL}</span>
        </label>
      </fieldset>
      {mode === "drawn" ? (
        <>
          <canvas
            ref={canvas}
            className="cp-sl-canvas"
            width={BOX_WIDTH}
            height={BOX_HEIGHT}
            aria-label="Signature drawing area"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerLeave={end}
          />
          <button type="button" className="cp-linkbtn cp-sl-clear" onClick={clear} disabled={disabled}>
            {CLEAR_LABEL}
          </button>
        </>
      ) : (
        <div className="cp-sl-typed" aria-label={TYPED_SIGNATURE_LABEL}>
          <span className="cp-sl-typed-name">{typedName}</span>
          <span className="cp-sl-typed-label">{TYPED_SIGNATURE_LABEL}</span>
        </div>
      )}
      <p className="cp-sl-note">{boxNote}</p>
    </div>
  );
}
