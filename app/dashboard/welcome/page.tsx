import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/app/lib/constants";
import { dismissWelcome } from "./actions";

export default async function WelcomePage() {
  const cookieStore = await cookies();
  if (cookieStore.get("welcome_seen")?.value === "1") redirect("/dashboard");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome to {APP_NAME} 👋</h1>
        <p className="text-sm text-zinc-400 mt-1">
          A quick tour to get you set up. You&apos;ll only see this once.
        </p>
      </div>

      {/* About */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">What is {APP_NAME}?</h2>
        <p className="text-sm text-zinc-300 leading-relaxed">
          {APP_NAME} is a competitive collegiate Rocket League pickup league. You register with your
          Discord account, enter the draft pool, get placed on a team, and compete through a full
          tournament season — all managed right here on this site.
        </p>
      </section>

      {/* What you can do */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">What you can do here</h2>
        <ul className="text-sm text-zinc-300 space-y-1.5 list-disc list-inside marker:text-zinc-600">
          <li><span className="text-white font-medium">Register</span> and set your Rocket League rank & tracker.</li>
          <li><span className="text-white font-medium">Enter the draft</span> when signups open to join a team.</li>
          <li><span className="text-white font-medium">My Team</span> — see your roster, schedule matches, request subs, and submit replays.</li>
          <li><span className="text-white font-medium">Teams, Players & Stats</span> — browse rosters, rankings, and per-player performance.</li>
          <li><span className="text-white font-medium">Season & Podium</span> — follow the bracket and see past champions.</li>
          <li>Turn on <span className="text-white font-medium">notifications</span> to get pinged for signups, drafts, and matches.</li>
        </ul>
      </section>

      {/* Install as an app */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Install it like an app 📱</h2>
        <p className="text-sm text-zinc-400">
          Add {APP_NAME} to your home screen for a full-screen, app-like experience and quicker access.
        </p>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">iPhone / iPad (Safari)</p>
          <ol className="text-sm text-zinc-300 space-y-1 list-decimal list-inside marker:text-zinc-600">
            <li>Open this site in <span className="text-white font-medium">Safari</span>.</li>
            <li>Tap the <span className="text-white font-medium">Share</span> button (the square with an arrow).</li>
            <li>Scroll down and tap <span className="text-white font-medium">Add to Home Screen</span>.</li>
            <li>Tap <span className="text-white font-medium">Add</span> in the top right.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Android (Chrome)</p>
          <ol className="text-sm text-zinc-300 space-y-1 list-decimal list-inside marker:text-zinc-600">
            <li>Open this site in <span className="text-white font-medium">Chrome</span>.</li>
            <li>Tap the <span className="text-white font-medium">⋮</span> menu (top right).</li>
            <li>Tap <span className="text-white font-medium">Install app</span> (or <span className="text-white font-medium">Add to Home screen</span>).</li>
            <li>Confirm — the icon will appear on your home screen.</li>
          </ol>
        </div>
      </section>

      {/* Dismiss */}
      <form action={dismissWelcome} className="flex justify-center pt-1">
        <button
          type="submit"
          className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          I got it! Take me to the dashboard
        </button>
      </form>
      <p className="text-center text-[11px] text-zinc-600">
        This tab disappears once you click.
      </p>
    </div>
  );
}
