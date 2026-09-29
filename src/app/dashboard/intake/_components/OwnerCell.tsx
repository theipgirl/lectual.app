"use client";

import type { MemberIdentity } from "@/lib/members/directory";
import { initialsOf, memberLabel } from "@/lib/intake/views";
import Popover, { PopoverItem } from "./Popover";
import { OWNER_TEXT, OWNER_TEXT_NONE } from "./styles";

/**
 * "Who owns the next response" (§1.9), reassignable in place.
 *
 * Initials, per the canvas — a 64px column has room for two letters and the
 * full name lives in the tooltip and in the menu. This is also the board's
 * keyboard fallback for the reassign drag, which is why it is a real menu
 * rather than a drop target's shadow.
 */
export default function OwnerCell({
  leadName,
  owner,
  assignedTo,
  members,
  pending,
  onAssign,
}: {
  leadName: string;
  owner: MemberIdentity | null;
  assignedTo: string | null;
  members: MemberIdentity[];
  pending: boolean;
  onAssign: (userId: string | null) => void;
}) {
  // An assignee the directory couldn't resolve (0031 not applied, or a member
  // removed since) still needs a row of their own in the menu, or the lead
  // would look unassigned and the next click would write that back.
  const unknownAssignee = assignedTo != null && !members.some((m) => m.userId === assignedTo);
  const label = owner ? memberLabel(owner) : unknownAssignee ? "Unknown teammate" : null;

  return (
    <Popover
      label={`Owner for ${leadName}: ${label ?? "unassigned"}. Reassign`}
      width={210}
      trigger={({ onClick, ref, ...aria }) => (
        <button
          {...aria}
          ref={ref}
          type="button"
          title={label ?? "Nobody owns the next response yet"}
          disabled={pending}
          onClick={onClick}
          style={{
            ...(label ? OWNER_TEXT : OWNER_TEXT_NONE),
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 5,
            padding: "2px 5px",
            cursor: pending ? "progress" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {owner ? initialsOf(owner) : unknownAssignee ? "?" : "—"}
        </button>
      )}
    >
      {(close) => (
        <>
          <PopoverItem
            muted
            checked={assignedTo == null}
            onSelect={() => {
              close();
              onAssign(null);
            }}
          >
            Unassigned
          </PopoverItem>
          {unknownAssignee && (
            <PopoverItem checked onSelect={close}>
              Unknown teammate
            </PopoverItem>
          )}
          {members.map((member) => (
            <PopoverItem
              key={member.userId}
              checked={assignedTo === member.userId}
              onSelect={() => {
                close();
                onAssign(member.userId);
              }}
            >
              {memberLabel(member)}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );
}
