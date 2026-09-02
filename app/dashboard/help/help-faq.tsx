"use client";

import { useState } from "react";
import Link from "next/link";

type QA = { q: string; a: React.ReactNode };
type Section = { title: string; items: QA[] };

const SECTIONS: Section[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I join the league?",
        a: "Log in with Discord, then fill out the Register form: your Rocket League tracker link, your four MMR numbers (All-Time Peak and Season Peak for 2v2/3v3), and proof of current or past enrollment at a school west of the Mississippi River (a transcript, enrollment letter, school ID, or diploma all work — blur out anything sensitive like an ID number or birthdate first). Submitting puts your account into “pending” until staff reviews it.",
      },
      {
        q: "Why is my account still pending?",
        a: "Pending just means a staff member hasn't reviewed your registration yet. You'll get a Discord DM once it's approved or rejected — there's nothing else you need to do in the meantime.",
      },
      {
        q: "My registration was rejected — what now?",
        a: "The rejection reason shows on your dashboard, along with whether you can resubmit right away or need to wait out a cooldown. Once that cooldown passes (if any), you'll see a “Re-submit Registration” option.",
      },
      {
        q: "I don't see the register form at all.",
        a: "If you're a member of the Discord server the league runs in but haven't joined it under this account, you'll see a “Join the Discord First” prompt instead — join the server, then come back.",
      },
    ],
  },
  {
    title: "Draft & teams",
    items: [
      {
        q: "How do teams get formed?",
        a: "Depends on the tournament: either a live snake draft where team captains pick players, or auto-balance, where the system sorts everyone onto teams automatically to keep things fair. Which one's in use is decided per tournament.",
      },
      {
        q: "How does the snake draft actually work?",
        a: <>The draft page (<Link href="/dashboard/draft" className="text-indigo-400 underline">/dashboard/draft</Link>) is a spectator view only — picks are made in Discord with the <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">/pick &lt;player name&gt;</code> slash command, typed by whichever captain is on the clock. Each captain gets a 45-second timer per pick; if it runs out, the system auto-picks the best available player on their behalf.</>,
      },
      {
        q: "Who's my team's captain?",
        a: "Whoever has the highest Rank Value on the team, automatically. Captaincy is locked in for the season — it doesn't change if MMR changes later. A team of 2 or fewer players doesn't count as having a captain at all.",
      },
      {
        q: "What is Rank Value (RV)?",
        a: "A single number built from your peak and current in-game MMR (weighted mostly toward 2v2, with some credit for 3v3) that the site uses to keep the draft and team balancing fair. It also acts as a minimum-skill bar for some formats and the basis for who can sub in for whom.",
      },
    ],
  },
  {
    title: "Matches & scheduling",
    items: [
      {
        q: "How do I schedule my next match?",
        a: <>From your <Link href="/dashboard/my-team" className="text-indigo-400 underline">My Team</Link> page — propose a time, and the other team accepts or proposes a different one. A time outside the league&rsquo;s standard scheduling window still works but needs the opponent to confirm first and an admin to sign off afterward.</>,
      },
      {
        q: "What's tournament check-in?",
        a: "For tournament matches, a 10-minute check-in window opens before kickoff. Both teams need to check in independently within that window or risk a disqualification for the match. Once both sides are checked in, you'll see who's Home and who's Away for setting up the private lobby.",
      },
      {
        q: "How do I report a match result?",
        a: "Any approved player on either team (not just the captain) can upload the series' replay files from the My Team page and submit the score. The other team then confirms or disputes it — if nobody responds in time, it auto-finalizes on its own.",
      },
      {
        q: "I need a substitute for an upcoming match — how does that work?",
        a: "Request one from your My Team page. You can only pick from players who've marked themselves sub-available, and their Rank Value has to be at or below the player they're replacing (with a small cushion for lower-rated outgoing players). The opposing team accepts or rejects the request directly.",
      },
    ],
  },
  {
    title: "Stats, standings & the podium",
    items: [
      {
        q: "Where can I see my career stats?",
        a: <>The <Link href="/dashboard/stats" className="text-indigo-400 underline">Stats</Link> page — a sortable leaderboard built from every replay that&rsquo;s been uploaded, including goals, assists, saves, shots, and an MVP rating per game.</>,
      },
      {
        q: "How is MVP rating calculated?",
        a: "It's built from goals, assists, saves, and shots per game, plus a small bonus based on in-game score. The exact formula isn't published, but that's the general shape of it.",
      },
      {
        q: "Where's the bracket / standings?",
        a: <>The <Link href="/dashboard/season" className="text-indigo-400 underline">Season</Link> tab shows whichever stages are relevant to the current format — standings, bracket, Swiss, groups, and so on.</>,
      },
    ],
  },
  {
    title: "Wagers (Westside Wages)",
    items: [
      {
        q: "What are Westside Wages?",
        a: "An in-app virtual currency (🪙) you can bet with on upcoming matches. It has no real-world value — it's just for fun and league bragging rights.",
      },
      {
        q: "How do I place a bet?",
        a: <>On the <Link href="/dashboard/wagers" className="text-indigo-400 underline">Wagers</Link> page, click a side of any market to add it to your bet slip, set a stake, then place it. You can also combine multiple fixed-odds selections into a parlay.</>,
      },
      {
        q: "What's the difference between Fixed Odds and Pool Mode?",
        a: "Fixed odds lock in your payout multiplier the instant you place the bet. Pool mode is more like a shared pot — the odds move live based on how much has actually been staked on each side, and your payout isn't set until the match closes.",
      },
    ],
  },
  {
    title: "Your account & settings",
    items: [
      {
        q: "How do I change my MMR or tracker link?",
        a: <>Use the Profile Change Request form in <Link href="/dashboard/settings" className="text-indigo-400 underline">Settings</Link>. Changes need admin approval before they apply to your live record.</>,
      },
      {
        q: "How do I link my Steam/Epic/PlayStation/Xbox/Switch account?",
        a: "From Settings → Platform Accounts, upload a replay and pick which scoreboard row is you. An admin verifies the claim before it counts toward match-identity checks.",
      },
      {
        q: "How do I turn on notifications?",
        a: "Settings → Notifications, then grant browser push permission. You can independently toggle Tournament updates, Draft, Season, and Announcements.",
      },
      {
        q: "Can I change my display name, theme, or nav layout?",
        a: "Yes — all in Settings, and all apply instantly with no approval needed.",
      },
    ],
  },
  {
    title: "Discord bot",
    items: [
      {
        q: "What can I do with the Discord bot myself?",
        a: <><code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">/site</code> replies with the league website link, and <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">/pick &lt;player&gt;</code> is how a captain submits a live-draft pick. Everything else under <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">/admin</code> is staff-only.</>,
      },
    ],
  },
];

export function HelpFaq() {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{section.title}</p>
          <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800">
            {section.items.map((item) => {
              const key = `${section.title}::${item.q}`;
              const isOpen = open.has(key);
              return (
                <div key={key} className="bg-zinc-900">
                  <button
                    onClick={() => toggle(key)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-zinc-800/60 transition-colors"
                  >
                    <span className="text-sm font-medium text-white">{item.q}</span>
                    <span className="text-zinc-500 text-xs shrink-0">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 text-sm text-zinc-400 leading-relaxed">{item.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
