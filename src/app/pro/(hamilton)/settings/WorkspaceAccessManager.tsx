"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  grantWorkspaceAccess,
  revokeWorkspaceInvitation,
  revokeWorkspaceAccess,
  type WorkspaceAccessActionState,
} from "./actions";
import type {
  InstitutionWorkspaceInvitation,
  InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import { SITE_NAME } from "@/lib/constants";
import { SERIF } from "@/components/hamilton/memo/memo";
import { WORKSPACE_SEAT_LIMIT, countWorkspaceSeats } from "@/lib/hamilton/workspace-seats";

interface WorkspaceAccessManagerProps {
  institutionId: number | null;
  members: InstitutionWorkspaceMembership[];
  invitations: InstitutionWorkspaceInvitation[];
  canManage: boolean;
  /** Signed /workspace-invite path per invitation id, computed on the server. */
  inviteLinks: Record<number, string | null>;
  /** False when the server secret is missing, so no link can be signed. */
  inviteLinksReady: boolean;
}

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";
const secondaryButton =
  "inline-block rounded-md border border-warm-300 bg-warm-50 px-3 py-1.5 text-sm font-medium text-warm-800 hover:border-warm-500 disabled:cursor-not-allowed disabled:opacity-60";

const initialState: WorkspaceAccessActionState = { success: false };
const INVITE_LINK_UNAVAILABLE =
  "Invite links can't be signed because the server secret (BFI_COOKIE_SECRET) is not set.";

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function sourceLabel(source: string): string {
  if (source === "claim") return "bank claim";
  if (source === "delegated") return "invitation";
  if (source === "manual_admin") return `${SITE_NAME} admin`;
  return "import";
}

/**
 * Copies one invitation's signed /workspace-invite link, on this site's origin, to the
 * clipboard. The server signs the path; this only adds the origin. Nothing is emailed: the
 * owner sends the link themselves, and the invitee opens it signed in with the invited
 * email. If the clipboard is unavailable, the link is shown selected to copy by hand.
 */
function CopyInviteLink({ email, path }: { email: string; path: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [link, setLink] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== "manual") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [status]);

  async function handleCopy() {
    const url = `${window.location.origin}${path}`;
    setLink(url);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={handleCopy} className={secondaryButton}>
        Copy invite link
      </button>
      {status === "copied" && (
        <p role="status" className="text-sm text-warm-600">
          Copied. Send it to {email}; they open it signed in with that email.
        </p>
      )}
      {status === "manual" && (
        <label className="flex flex-col gap-1 text-sm text-warm-600">
          <span>Copy this link and send it to {email}:</span>
          <input
            ref={inputRef}
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className={inputClass}
          />
        </label>
      )}
    </div>
  );
}

function InviteLinkCell({ email, path }: { email: string; path: string | null }) {
  if (!path) return <p className="text-sm text-terra-text">{INVITE_LINK_UNAVAILABLE}</p>;
  return <CopyInviteLink email={email} path={path} />;
}

export function WorkspaceAccessManager({
  institutionId,
  members,
  invitations,
  canManage,
  inviteLinks,
  inviteLinksReady,
}: WorkspaceAccessManagerProps) {
  const [grantState, grantAction, isGrantPending] = useActionState(
    grantWorkspaceAccess,
    initialState,
  );
  const [revokeState, revokeAction, isRevokePending] = useActionState(
    revokeWorkspaceAccess,
    initialState,
  );
  const [revokeInviteState, revokeInviteAction, isRevokeInvitePending] = useActionState(
    revokeWorkspaceInvitation,
    initialState,
  );

  if (!institutionId) {
    return <p className="text-sm text-warm-700">Pick your bank above before adding colleagues.</p>;
  }

  const seatsUsed = countWorkspaceSeats(members, invitations);
  const seatsFull = seatsUsed >= WORKSPACE_SEAT_LIMIT;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-warm-700">
          An institution account includes up to {WORKSPACE_SEAT_LIMIT} people, you included. Each
          one gets full Pro access and unlimited Hamilton questions.
        </p>
        <p role="status" className="mt-1 text-sm font-medium text-warm-900">
          {seatsUsed} of {WORKSPACE_SEAT_LIMIT} seats used
        </p>
      </div>

      <div>
        <h3 className="text-base text-warm-900" style={SERIF}>
          People with access
        </h3>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-warm-700">No one has access yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-warm-200 border-y border-warm-200">
            {members.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-warm-900">
                    {member.userDisplayName ?? member.userEmail ?? `User ${member.userId}`}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
                    {member.userEmail && <span>{member.userEmail}</span>}
                    <span>{roleLabel(member.role)}</span>
                    <span>Added by {sourceLabel(member.source)}</span>
                    <span>Since {new Date(member.grantedAt).toLocaleDateString()}</span>
                  </p>
                </div>
                {canManage && member.role !== "owner" && (
                  <form action={revokeAction}>
                    <input type="hidden" name="institution_id" value={institutionId} />
                    <input type="hidden" name="membership_id" value={member.id} />
                    <button type="submit" disabled={isRevokePending} className={secondaryButton}>
                      Remove access
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {invitations.length > 0 && (
        <div>
          <h3 className="text-base text-warm-900" style={SERIF}>
            Invitations waiting
          </h3>
          <ul className="mt-2 divide-y divide-warm-200 border-y border-warm-200">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-warm-900">{invitation.email}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
                    <span>{roleLabel(invitation.role)}</span>
                    <span>Waiting for them to open the invite link</span>
                    <span>Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-start gap-2">
                    <InviteLinkCell email={invitation.email} path={inviteLinks[invitation.id] ?? null} />
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="institution_id" value={institutionId} />
                      <input type="hidden" name="invitation_id" value={invitation.id} />
                      <button type="submit" disabled={isRevokeInvitePending} className={secondaryButton}>
                        Cancel invite
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage ? (
        <form
          action={grantAction}
          className="grid grid-cols-1 gap-4 rounded-md border border-warm-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_10rem]"
        >
          <input type="hidden" name="institution_id" value={institutionId} />
          <label htmlFor="workspace_access_email" className="flex min-w-0 flex-col gap-1 text-sm text-warm-800">
            <span className="font-medium">Colleague&apos;s email</span>
            <input
              id="workspace_access_email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="analyst@yourbank.com"
              className={inputClass}
            />
          </label>
          <label htmlFor="workspace_access_role" className="flex flex-col gap-1 text-sm text-warm-800">
            <span className="font-medium">Role</span>
            <select id="workspace_access_role" name="role" defaultValue="analyst" className={inputClass}>
              <option value="admin">Admin</option>
              <option value="analyst">Analyst</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label htmlFor="workspace_access_notes" className="flex flex-col gap-1 text-sm text-warm-800 sm:col-span-2">
            <span className="font-medium">Note (optional)</span>
            <textarea
              id="workspace_access_notes"
              name="notes"
              rows={2}
              placeholder="Why they need access, or what they should see"
              className={`${inputClass} resize-y`}
            />
          </label>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <p className="text-sm text-warm-600">
              We save an invite and give you a link to copy and send them. They open it signed in
              with this email, or create a free {SITE_NAME} account with it first, and their seat
              starts then. We don&apos;t email anyone.
            </p>
            {!inviteLinksReady && (
              <p className="text-sm font-medium text-terra-text">{INVITE_LINK_UNAVAILABLE}</p>
            )}
            {seatsFull && (
              <p className="text-sm font-medium text-terra-text">
                All {WORKSPACE_SEAT_LIMIT} seats are in use. To add someone new, remove a person or cancel an
                invite first.
              </p>
            )}
            <div>
              <button
                type="submit"
                disabled={isGrantPending}
                className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGrantPending ? "Saving..." : "Create invite"}
              </button>
            </div>
            {grantState.success && grantState.inviteLink && grantState.inviteEmail && (
              <CopyInviteLink
                key={grantState.inviteLink}
                email={grantState.inviteEmail}
                path={grantState.inviteLink}
              />
            )}
          </div>
        </form>
      ) : (
        <p className="text-sm text-warm-700">
          Only the bank&apos;s owner or an admin on this workspace can add or remove people.
        </p>
      )}

      <ActionMessage state={grantState} />
      <ActionMessage state={revokeState} />
      <ActionMessage state={revokeInviteState} />
    </div>
  );
}

function ActionMessage({ state }: { state: WorkspaceAccessActionState }) {
  if (state.success && state.message) {
    return (
      <p role="status" className="text-sm font-medium text-warm-900">
        {state.message}
      </p>
    );
  }
  if (!state.success && state.error) {
    return (
      <p role="alert" className="text-sm font-medium text-terra-text">
        {state.error}
      </p>
    );
  }
  return null;
}
