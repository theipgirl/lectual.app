import { CLERK_NOTE, ROLE_ABILITIES, roleRows } from "@/lib/team/role-table";

/** "What each role can do": every role, what it can do, and a one-line description. */
export function RoleTable() {
  const rows = roleRows();
  return (
    <section className="lx-card" style={{ overflow: "auto" }} aria-labelledby="role-table-heading">
      <div style={{ padding: "16px 18px 0" }}>
        <h2 id="role-table-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
          What each role can do
        </h2>
      </div>
      <table className="lx-tbl" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Role</th>
            {ROLE_ABILITIES.map((a) => (
              <th key={a.key}>{a.label}</th>
            ))}
            <th>In short</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.role}>
              <td className="pri">{r.label}</td>
              {ROLE_ABILITIES.map((a) => (
                <td key={a.key}>{r.abilities[a.key] ? <span className="lx-pill lx-pill-ok">Yes</span> : <span className="lx-pill lx-pill-mute">No</span>}</td>
              ))}
              <td className="wrap">{r.blurb}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lx-note" style={{ margin: 0, padding: "12px 18px 16px" }}>
        {CLERK_NOTE}
      </p>
    </section>
  );
}
