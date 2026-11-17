import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * The in-firm refusal for the quotes pages. An explanatory card rather than
 * `notFound()`, on purpose: this gate is a decision INSIDE one firm about who
 * quotes, so naming the roles discloses nothing a colleague couldn't ask. The
 * per-firm module gates are the opposite case and must never explain.
 */
export function QuotesRestricted({ title, detail }: { title: string; detail?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Restricted to the firm's principals">
        {detail ?? "Quotes are built by owners, admins, senior admins and attorneys. Ask one of them for access."}
      </EmptyState>
    </>
  );
}
