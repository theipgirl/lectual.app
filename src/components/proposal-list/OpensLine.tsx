import type { OpensKind } from "@/lib/proposals/opens";

/**
 * Spec 7: one line under a proposal row's Accepted cell saying whether the client has opened the link. The text
 * comes from `opensListText`; a failed read reads "Couldn't load opens", never "Not opened yet".
 */
export function OpensLine({ opens }: { opens: { kind: OpensKind; text: string } }) {
  return (
    <div className="pq-mono pq-sub pq-opens" data-opens={opens.kind}>
      {opens.text}
    </div>
  );
}
