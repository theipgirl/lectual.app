import { viewerRole } from "@/lib/views/view-as";
import { AUTOMATION_ADMIN_ROLES, listTemplates } from "@/lib/automation";
import { relativeTime } from "@/lib/relative-time";
import { NewTemplateForm } from "./_components/TemplateForms";
import { EmptyState, LoadFailedCard, PageHeader, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
import { getFirmTimeZone } from "@/lib/org/profile";
import { BLANK, EMAIL_TEMPLATES_NAME } from "@/lib/ui/words";
import "../campaigns.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { campaignLoadError } from "@/lib/campaigns/load-errors";

export const metadata: Metadata = { title: pageTitle(EMAIL_TEMPLATES_NAME) };

export const dynamic = "force-dynamic";

/**
 * The email-template library campaign steps draft from
 * (crm_email_template — src/lib/automation/drips.ts). Read by anyone in the
 * firm; only AUTOMATION_ADMIN_ROLES may add one, mirroring
 * `crm_email_template_insert_admin`.
 */
export default async function CampaignTemplatesPage() {
  const role = await viewerRole();
  const canManage = role !== null && AUTOMATION_ADMIN_ROLES.includes(role);

  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  let loadError: string | null = null;
  try {
    templates = await listTemplates();
  } catch (err) {
    loadError = campaignLoadError("templates", err);
  }

  const tz = await getFirmTimeZone();

  return (
    <>
      <PageHeader
        back={{ href: "/dashboard/campaigns/", label: "Campaigns" }}
        title={EMAIL_TEMPLATES_NAME}
        sub="The wording a campaign's email steps draft from. A step never invents its own copy — it fills one of these templates with the enrolled lead's own details and holds the result for approval."
      />

      {canManage && (
        <details className="lx-card lx-disclosure">
          <summary>New template</summary>
          <NewTemplateForm />
        </details>
      )}

      {loadError ? (
        <LoadFailedCard what="templates" body={loadError} />
      ) : templates.length === 0 ? (
        <EmptyState title="No templates yet">
          {canManage ? "Create one above — an email step needs one to draft from." : "Ask a firm admin to add one."}
        </EmptyState>
      ) : (
        <SheetCard>
          <SheetScroll>
            <SheetTable minWidth={640}>
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
                      <td className="wrap" data-label="Subject">{template.subject}</td>
                      <td className="lx-note" data-label="Variables">
                        {variables.length === 0 ? BLANK : variables.map((v) => `{{${String(v)}}}`).join(", ")}
                      </td>
                      <td data-label="Updated">{relativeTime(template.updated_at, undefined, tz)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
    </>
  );
}
