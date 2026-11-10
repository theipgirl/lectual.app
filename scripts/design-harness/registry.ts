import type { ReactElement } from "react";

export type Viewport = "desktop" | "phone";

export type Screen = {
  /** File name of the output (out/<id>.html, shots/<id>.png, pairs/<id>.png). */
  id: string;
  title: string;
  /** Design board name: $DESIGN_SHOTS/<designBoard>.png (e.g. "Main", "PhoneToday"). */
  designBoard: string;
  /** desktop = 1440x900 full page; phone = 375x812 full page. */
  viewport: Viewport;
  /**
   * Crop box [x, y, w, h] in PIXELS of the full-size design board PNG. Needed when the board holds several phones or
   * extra chrome. Omit to use the whole board.
   */
  designCrop?: [number, number, number, number];
  /** The pathname the rail / phone bar should treat as current. Default "/dashboard/". */
  pathname?: string;
  /** "owner" (default) wraps in the owner shell; "none" renders the element alone (for single-component boards). */
  shell?: "owner" | "none";
  /** Called before render() to set what the mocked loaders return (see state.ts). */
  prepare?: () => void;
  /** The page content. May be async: the render test awaits it and renders async server components. */
  render: () => ReactElement | Promise<ReactElement>;
  /** Last-chance edit of the HTML string (e.g. open a <details>). */
  transformHtml?: (html: string) => string;
  /** Free text shown in the README table / run log: what is real, what is a placeholder. */
  note?: string;
};
