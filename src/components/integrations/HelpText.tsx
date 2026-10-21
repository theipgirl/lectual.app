import type { ReactNode } from "react";
import "./integrations.css";

/** The one-line explanation under an integration's title (or a note inside its card). */
export function HelpText({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "problem" }) {
  return <p className={tone === "problem" ? "lx-note lxi-help lxi-help-problem" : "lx-note lxi-help"}>{children}</p>;
}
