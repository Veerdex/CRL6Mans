"use client";

import { useState } from "react";
import { MyTeamEditor } from "./my-team-editor";

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  logo_offset_x: number;
  logo_offset_y: number;
  is_locked: boolean;
}

export function TeamEditToggle({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full py-1.5 text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors"
      >
        {open ? "↑ Close editor" : "Edit team info"}
      </button>
      {open && (
        <div className="mt-2">
          <MyTeamEditor team={team} isAdmin={true} label={team.name} />
        </div>
      )}
    </div>
  );
}
