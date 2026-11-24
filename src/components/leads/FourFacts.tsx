import type { FactView, LeadStepView } from "@/lib/lead-step/view-model";
import { LEAD_PAGE_FACTS_LABEL } from "@/lib/ui/words";
import "./lead-step.css";

function Fact({ fact, hl }: { fact: FactView; hl?: boolean }) {
  return (
    <div className="ls-fact" data-state={fact.state} data-hl={hl ? "true" : undefined}>
      <dt className="lx-label">{fact.label}</dt>
      <dd>
        {fact.value}
        {fact.sub && <small>{fact.sub}</small>}
      </dd>
    </div>
  );
}

/**
 * Last contact, Consult, Proposal and Waiting on, from the engine's facts. Proposal is absent for a firm without
 * Proposals (the engine returns null); a fact whose read failed says "Couldn't load", never an empty value.
 */
export function FourFacts({ facts }: { facts: LeadStepView["facts"] }) {
  return (
    <dl className="lx-card ls-facts" aria-label={LEAD_PAGE_FACTS_LABEL}>
      <Fact fact={facts.contact} />
      <Fact fact={facts.consult} />
      {facts.proposal && <Fact fact={facts.proposal} />}
      <Fact fact={facts.waiting} hl />
    </dl>
  );
}
