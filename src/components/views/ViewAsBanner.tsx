import { VIEW_AS_EXIT_PATH } from "@/lib/views/view-as-rules";
import { VIEW_AS_BANNER, VIEW_AS_BANNER_SHORT, VIEW_AS_EXIT, VIEW_AS_TEAM_UNREADABLE, VIEW_AS_UNCHECKED } from "@/lib/ui/words";
import "./view-as.css";

/**
 * The banner above the top bar on every dashboard page while previewing (spec Scope item 3). It can't be dismissed; Exit
 * is a plain form posting to the fixed Exit path. On phones it is one short sticky line with a 44px Exit.
 *   name      previewing that teammate
 *   unchecked the preview state couldn't be read: writes are refused until a refresh
 *   team      a preview is on but the teammate couldn't be read from the team list (the owner's own view is drawn)
 */
export function ViewAsBanner(props: { kind: "name"; name: string } | { kind: "unchecked" } | { kind: "team" }) {
  const firstName = props.kind === "name" ? props.name.trim().split(/\s+/)[0] || props.name : "";
  return (
    <div role="status" className="lx-viewas-bar" data-view-as={props.kind}>
      <span className="lx-viewas-text">
        {props.kind === "name" ? (
          <>
            <span className="lx-viewas-long">{VIEW_AS_BANNER(props.name)}</span>
            <span className="lx-viewas-short">{VIEW_AS_BANNER_SHORT(firstName)}</span>
          </>
        ) : props.kind === "unchecked" ? (
          VIEW_AS_UNCHECKED
        ) : (
          VIEW_AS_TEAM_UNREADABLE
        )}
      </span>
      <form action={VIEW_AS_EXIT_PATH} method="post">
        <button type="submit" className="lx-viewas-exit">
          {VIEW_AS_EXIT}
        </button>
      </form>
    </div>
  );
}
