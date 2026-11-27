import { CLERK_NOTE, ROLE_ABILITIES, roleRows } from "@/lib/team/role-table";
import { Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";

/** "What each role can do": every role, what it can do, and a one-line description. */
export function RoleTable() {
  const rows = roleRows();
  return (
    <SheetCard as="section" aria-labelledby="role-table-heading">
      <div className="lx-pad">
        <h2 id="role-table-heading" className="lx-h2">
          What each role can do
        </h2>
      </div>
      <SheetScroll>
        <SheetTable minWidth={640}>
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
                  <td key={a.key} data-label={a.label}>
                    {r.abilities[a.key] ? <Pill tone="ok">Yes</Pill> : <Pill tone="mute">No</Pill>}
                  </td>
                ))}
                <td className="wrap" data-label="In short">
                  {r.blurb}
                </td>
              </tr>
            ))}
          </tbody>
        </SheetTable>
      </SheetScroll>
      <p className="lx-note lx-pad" style={{ margin: 0 }}>{CLERK_NOTE}</p>
    </SheetCard>
  );
}
