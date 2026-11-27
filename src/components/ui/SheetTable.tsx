import { createElement, type CSSProperties, type HTMLAttributes, type Ref, type TableHTMLAttributes } from "react";

/**
 * The sheet table kit (classes `.sheet-*` in globals.css). These components only DRAW markup and forward every other prop, so a
 * page keeps its own handlers, ids, data attributes and refs. The Weekly review Sheet is the model.
 *
 *   <SheetCard>                      the card (add `as="section"` when it carries a heading)
 *     <SheetScroll scroll={false}>   scrolls sideways inside the card; `scroll={false}` = "it fits", which lets the header stick
 *       <SheetTable minWidth={900}>  `lx-tbl lx-stack sheet-tbl`; cells after the first carry data-label for the phone cards
 */
const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function SheetCard({ as = "div", className, children, ...rest }: { as?: "div" | "section" } & HTMLAttributes<HTMLElement>) {
  return createElement(as, { ...rest, className: join("lx-card", "sheet-card", className) }, children);
}

export function SheetScroll({ scroll, className, ref, children, ...rest }: { scroll?: boolean; ref?: Ref<HTMLDivElement> } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} ref={ref} className={join("sheet-scroll", className)} data-scroll={scroll === undefined ? undefined : scroll ? "true" : "false"}>
      {children}
    </div>
  );
}

export function SheetTable({ minWidth, fixed, style, className, children, ...rest }: { minWidth?: number; fixed?: boolean } & TableHTMLAttributes<HTMLTableElement>) {
  const merged = minWidth === undefined ? style : ({ ...style, "--sheet-min": `${minWidth}px` } as CSSProperties);
  return (
    <table {...rest} style={merged} className={join("lx-tbl", "lx-stack", "sheet-tbl", fixed && "sheet-fixed", className)}>
      {children}
    </table>
  );
}
