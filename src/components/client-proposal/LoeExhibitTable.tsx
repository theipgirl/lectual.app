import type { Exhibit } from "@/lib/loe/exhibit";

/** Exhibit A as a table of React text. The strings come from the pure formatter; nothing is calculated here. */
export function LoeExhibitTable({ exhibit }: { exhibit: Exhibit }) {
  return (
    <section className="cp-exhibit" aria-labelledby="cp-exhibit-h">
      <h3 id="cp-exhibit-h">{exhibit.title}</h3>
      {exhibit.groups.map((g, gi) => (
        <div className="cp-ex-group" key={gi}>
          <h4>{g.title}</h4>
          <table className="cp-ex-table">
            <tbody>
              {g.rows.map((r, ri) => (
                <tr key={ri}>
                  <th scope="row">
                    {r.label}
                    {r.detail ? <small>{r.detail}</small> : null}
                  </th>
                  <td className="cp-num">{r.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <dl className="cp-ex-totals">
        <div>
          <dt>{exhibit.legalDue.label}</dt>
          <dd className="cp-num">{exhibit.legalDue.amount}</dd>
        </div>
        {exhibit.usptoDue ? (
          <div>
            <dt>{exhibit.usptoDue.label}</dt>
            <dd className="cp-num">{exhibit.usptoDue.amount}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
