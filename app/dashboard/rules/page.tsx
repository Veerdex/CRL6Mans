import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { getRulesMarkdown, getSeasonMinMmr } from "./rules-content";
import { RulesEditorShell, RulesEditButton, RulesMarkdownBody } from "./rules-editable";
import { filterRulesMarkdown, seasonRulesContext } from "./rules-filter";

export default async function RulesPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const [canEdit, markdown, { minMmr2v2, minMmr3v3 }] = await Promise.all([
    session?.userId ? isDirectorVerified(session.userId) : Promise.resolve(false),
    getRulesMarkdown(),
    getSeasonMinMmr(),
  ]);
  const displayMarkdown = filterRulesMarkdown(markdown, seasonRulesContext(minMmr2v2, minMmr3v3));

  return (
    <RulesEditorShell key={markdown} canEdit={canEdit} markdown={markdown} displayMarkdown={displayMarkdown}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-10 text-zinc-300">
      <div>
        <h1 className="text-3xl font-bold text-white">CRL West 6mans Summer League</h1>
        <p className="text-xl text-zinc-400 mt-1">2026 Rulebook</p>
        <p className="mt-4 leading-relaxed">
          Welcome to the CRL West 6mans Summer League! By participating you automatically
          agree to all rules outlined in this rulebook. Admin will be referring to this document
          when issues arise.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <a
            href="https://docs.google.com/document/d/1jaBb4avEkXO2yC0iO1OP9xqQKahvW0PhEZmuFGAnxTQ/edit"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View original document
          </a>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Last Modified: May 22nd, 2026</p>
      </div>

      <RulesEditButton />

      {/* Important Dates */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3">Important Dates</h2>
        <table className="w-full text-sm border-collapse">
          <tbody>
            {[
              ["Signups Open", "April 1st, 2026"],
              ["Signups Close", "May 10th, 2026"],
              ["Draft Day", "May 22nd, 2026"],
              ["Team Personalization Deadline", "May 24th, 2026"],
              ["Week 1 Begins", "May 27th, 2026"],
              ["Week 7 Ends", "July 14th, 2026"],
              ["Championship Weekend", "July 25th–26th, 2026"],
            ].map(([event, date]) => (
              <tr key={event} className="border-b border-zinc-800">
                <td className="py-2 pr-4 text-zinc-400">{event}</td>
                <td className="py-2 text-right text-white font-medium">{date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Tournament Organizers */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3">Tournament Organizers</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-700 text-zinc-400 text-left">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">IGN</th>
              <th className="pb-2 font-medium">Discord</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Kotala ★", "Kotala", "kotala."],
              ["Buns", "FlufBun", "flufbuns"],
              ["Sw33t", "Sw33t0404", "sw33t0404"],
              ["Bava", "Bava", "bava."],
              ["Fiat", "Fiatcolour", "fiatcolour"],
            ].map(([name, ign, discord]) => (
              <tr key={name} className="border-b border-zinc-800">
                <td className="py-2 text-white">{name}</td>
                <td className="py-2">{ign}</td>
                <td className="py-2">{discord}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <hr className="border-zinc-800" />

      <RulesMarkdownBody />
      </div>
    </RulesEditorShell>
  );
}
