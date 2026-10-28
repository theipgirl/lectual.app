import "./list-page.css";

/** Whether the Clear control shows: only when a search term is set. Pure, so a test can pin it. */
export function showClear(term: string | null | undefined): boolean {
  return (term ?? "").trim().length > 0;
}

type SearchProps = {
  label: string;
  placeholder: string;
  /** The search box's field name when it submits as a plain GET (Matters). */
  name?: string;
  /** Uncontrolled starting value (server pages). */
  defaultValue?: string;
  /** Controlled value (the Leads page filters as you type). */
  value?: string;
  onChange?: (next: string) => void;
  /** Hidden fields that ride with a GET submit (the current view and segment). */
  hidden?: Record<string, string>;
  /** Where Clear goes on a server page. */
  clearHref?: string;
  /** What Clear does on a page that filters in the browser. */
  onClear?: () => void;
};

/** Search with a submit button, and a Clear link only when a term is set. */
export function ListSearch(props: SearchProps) {
  const term = props.value ?? props.defaultValue ?? "";
  return (
    <form
      className="lp-search"
      role="search"
      // A page that filters as you type has nothing to post: a submit must not reload it.
      onSubmit={props.onChange ? (event) => event.preventDefault() : undefined}
    >
      {Object.entries(props.hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        className="lx-input"
        type="search"
        name={props.name ?? "q"}
        {...(props.onChange
          ? { value: props.value ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onChange?.(event.target.value) }
          : { defaultValue: props.defaultValue ?? "" })}
        placeholder={props.placeholder}
        aria-label={props.label}
      />
      <button type="submit" className="lp-search-submit">
        Search
      </button>
      {showClear(term) &&
        (props.clearHref ? (
          <a className="lp-clear" href={props.clearHref}>
            Clear
          </a>
        ) : (
          <button type="button" className="lp-clear" onClick={props.onClear}>
            Clear
          </button>
        ))}
    </form>
  );
}

/**
 * The toolbar row under the header: search (with a submit button), the Table | Board toggle, the
 * page's primary action and a "More" control for the rare ones. All four are slots; each page keeps
 * its own actions.
 */
export function ListToolbar({
  search,
  toggle,
  primary,
  more,
}: {
  search: SearchProps;
  toggle?: React.ReactNode;
  primary?: React.ReactNode;
  more?: React.ReactNode;
}) {
  return (
    <div className="lp-toolbar">
      <ListSearch {...search} />
      {toggle}
      <span className="lp-toolbar-spacer" />
      {more}
      {primary}
    </div>
  );
}
