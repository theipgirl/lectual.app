import { ProposalNotice } from "@/components/client-proposal/ProposalNotice";

/**
 * The locked page. One answer for every kind of nothing: an unknown token, a
 * token of the wrong shape, another firm's token, a draft, and an expired or
 * withdrawn proposal (page.tsx sends those here too). A page that told them
 * apart would be an oracle for someone walking token space, so nothing here is
 * read from the database, not even the firm's name.
 */
export default function ProposalNotFound() {
  return (
    <ProposalNotice heading="This link isn’t available.">
      If you think it should be, reply to the email it came from and ask for a new one.
    </ProposalNotice>
  );
}
