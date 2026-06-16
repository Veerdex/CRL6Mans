"use client";

import { useState, useTransition } from "react";
import type { StaffMember } from "./staff-actions";
import { addStaffMember, removeStaffMember, transferCEO } from "./staff-actions";

const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO",
  director: "Director",
  moderator: "Moderator",
};

const ROLE_COLOR: Record<string, string> = {
  ceo: "text-amber-400 bg-amber-950/40 border-amber-800/60",
  director: "text-indigo-400 bg-indigo-950/40 border-indigo-800/60",
  moderator: "text-zinc-300 bg-zinc-800 border-zinc-700",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${ROLE_COLOR[role] ?? "text-zinc-400 bg-zinc-800 border-zinc-700"}`}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function ConfirmRemove({
  member,
  canRemove,
  onRemove,
}: {
  member: StaffMember;
  canRemove: boolean;
  onRemove: (m: StaffMember) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canRemove || member.role === "ceo") return null;
  return open ? (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-400">Remove {member.username ?? member.discord_id}?</span>
      <button onClick={() => onRemove(member)} className="text-xs text-red-400 underline">Confirm</button>
      <button onClick={() => setOpen(false)} className="text-xs text-zinc-500 underline">Cancel</button>
    </div>
  ) : (
    <button onClick={() => setOpen(true)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
      Remove
    </button>
  );
}

type Props = {
  staff: StaffMember[];
  userIsCEO: boolean;
  userIsDirector: boolean;
};

export function StaffManager({ staff, userIsCEO, userIsDirector }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [addRole, setAddRole] = useState<"moderator" | "director">("moderator");
  const [addId, setAddId] = useState("");
  const [addUsername, setAddUsername] = useState("");

  const [transferId, setTransferId] = useState("");
  const [transferUsername, setTransferUsername] = useState("");
  const [transferCode, setTransferCode] = useState("");

  function notify(msg: string, isError = false) {
    if (isError) { setError(msg); setSuccess(null); }
    else { setSuccess(msg); setError(null); }
  }

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const res = await addStaffMember(addId, addUsername, addRole);
      if (res.error) notify(res.error, true);
      else { notify(`Added ${addUsername} as ${ROLE_LABEL[addRole]}.`); setAddId(""); setAddUsername(""); }
    });
  }

  function handleRemove(member: StaffMember) {
    startTransition(async () => {
      const res = await removeStaffMember(member.discord_id, member.role as "moderator" | "director");
      if (res.error) notify(res.error, true);
      else notify(`Removed ${member.username ?? member.discord_id}.`);
    });
  }

  function handleTransfer() {
    setError(null);
    startTransition(async () => {
      const res = await transferCEO(transferId, transferUsername, transferCode);
      if (res.error) notify(res.error, true);
      else { notify("CEO transferred."); setTransferId(""); setTransferUsername(""); setTransferCode(""); }
    });
  }

  const moderators = staff.filter(s => s.role === "moderator");
  const directors = staff.filter(s => s.role === "director");
  const ceo = staff.find(s => s.role === "ceo");

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2">{error}</p>}
      {success && <p className="text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 rounded-lg px-4 py-2">{success}</p>}

      {/* CEO */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Chief Executive Officer</p>
        {ceo ? (
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
            <span className="flex-1 text-sm text-white font-medium">{ceo.username ?? ceo.discord_id}</span>
            <span className="text-xs text-zinc-500 font-mono">{ceo.discord_id}</span>
            <RoleBadge role="ceo" />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No CEO set.</p>
        )}
      </div>

      {/* Directors */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Directors</p>
        {directors.length === 0 ? (
          <p className="text-sm text-zinc-500">No directors.</p>
        ) : (
          <div className="space-y-2">
            {directors.map(m => (
              <div key={m.discord_id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
                <span className="flex-1 text-sm text-white font-medium">{m.username ?? m.discord_id}</span>
                <span className="text-xs text-zinc-500 font-mono">{m.discord_id}</span>
                <RoleBadge role="director" />
                <ConfirmRemove member={m} canRemove={userIsCEO} onRemove={handleRemove} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Moderators */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Moderators</p>
        {moderators.length === 0 ? (
          <p className="text-sm text-zinc-500">No moderators.</p>
        ) : (
          <div className="space-y-2">
            {moderators.map(m => (
              <div key={m.discord_id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
                <span className="flex-1 text-sm text-white font-medium">{m.username ?? m.discord_id}</span>
                <span className="text-xs text-zinc-500 font-mono">{m.discord_id}</span>
                <RoleBadge role="moderator" />
                <ConfirmRemove member={m} canRemove={userIsDirector} onRemove={handleRemove} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add staff (Director can add Moderators, CEO can add Directors) */}
      {(userIsDirector || userIsCEO) && (
        <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-zinc-300">Add Staff Member</p>
          <div className="flex flex-wrap gap-3">
            <select
              value={addRole}
              onChange={e => setAddRole(e.target.value as "moderator" | "director")}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {userIsDirector && <option value="moderator">Moderator</option>}
              {userIsCEO && <option value="director">Director</option>}
            </select>
            <input
              value={addId}
              onChange={e => setAddId(e.target.value)}
              placeholder="Discord ID"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            />
            <input
              value={addUsername}
              onChange={e => setAddUsername(e.target.value)}
              placeholder="Username"
              className="flex-1 min-w-[120px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            />
            <button
              onClick={handleAdd}
              disabled={isPending || !addId.trim() || !addUsername.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Transfer CEO */}
      {userIsCEO && (
        <div className="border border-amber-800/50 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-amber-400">Transfer CEO Role</p>
          <p className="text-xs text-zinc-500">This will remove your CEO role and assign it to the new user. This cannot be undone without direct database access.</p>
          <div className="flex flex-wrap gap-3">
            <input
              value={transferId}
              onChange={e => setTransferId(e.target.value)}
              placeholder="New CEO Discord ID"
              className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            />
            <input
              value={transferUsername}
              onChange={e => setTransferUsername(e.target.value)}
              placeholder="New CEO username"
              className="flex-1 min-w-[120px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            />
          </div>
          <div className="flex gap-3">
            <input
              value={transferCode}
              onChange={e => setTransferCode(e.target.value)}
              placeholder='Type: TRANSFER CEO'
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 font-mono"
            />
            <button
              onClick={handleTransfer}
              disabled={isPending || transferCode !== "TRANSFER CEO" || !transferId.trim()}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Transfer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
