import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { AUTOMATION_ADMIN_ROLES, listTemplates } from "@/lib/automation";
import { relativeTime } from "@/lib/relative-time";
import { NewTemplateForm } from "./_components/TemplateForms";
import "../campaigns.css";

export const dynamic = "force-dynamic";

/**
 * The email-template library campaign steps draft from
 * (crm_email_template — src/lib/automation/drips.ts). Read by anyone in the
 * firm; only AUTOMATION_ADMIN_ROLES may add one, mirroring
 * `crm_email_template_insert_admin`.
 */
export default async function CampaignTemplatesPage() {
  const role = await currentRole();
  const canManage = role !== null && AUTOMATION_ADMIN_ROLES.includes(role);

  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  let loadError: string | null = null;
  try {
    templates = await listTemplates();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Couldn't load templates.";
  }

  return (
    <>
      <Link href="/dashboard/campaigns/" className="lx-back">
        ← Campaigns
      </Link>

      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Campaigns</div>
          <h1 className="lx-h1">Email templates</h1>
          <p className="lx-sub">
            The wording a campaign&apos;s email steps draft from. A step never invents its own copy — it fills one of
            these templates with the enrolled lead&apos;s own details and holds the result for approval.
          </p>
        </div>
      </div>

      {canManage && (
        <details className="lx-card lx-disclosure">
          <summary>New template</summary>
          <NewTemplateForm />
        </details>
      )}

      {loadError ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Templates couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            This is a problem reaching the database, not an empty library. Try again shortly.
          </p>
        </div>
      ) : templates.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            No templates yet
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {canManage ? "Create one above — an email step needs one to draft from." : "Ask a firm admin to add one."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Template</th>
                <th>Subject</th>
                <th>Variables</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const variables = Array.isArray(template.variables) ? (template.variables as unknown[]) : [];
                return (
                  <tr key={template.id}>
                    <td className="pri">{template.name}</td>
                    <td className="wrap">{template.subject}</td>
                    <td className="lx-note">
                      {variables.length === 0 ? "—" : variables.map((v) => `{{${String(v)}}}`).join(", ")}
                    </td>
                    <td className="lx-num">{relativeTime(template.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
