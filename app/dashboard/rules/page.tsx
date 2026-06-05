export default function RulesPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10 text-zinc-300">
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

      {/* Section 1 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 1 — League Format</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">1.1 Basic Information</h3>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ["Default Server", "US West (Central requires all 6 players + admin approval)"],
                ["Gamemode", "3v3"],
                ["In-Season Matches", "Best of 5"],
                ["Playoff Matches", "Based on League Size (TBD)"],
                ["Allowed Maps", "Any standard map"],
                ["Streamed Match Maps", "Boostfield Mall, Salty Shores (all variants), Aquadome, Beckwith Park, Estadio Vida"],
              ].map(([key, val]) => (
                <tr key={key} className="border-b border-zinc-800">
                  <td className="py-2 pr-4 font-medium text-zinc-400 w-40">{key}</td>
                  <td className="py-2 text-zinc-300">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">1.2 League Format</h3>
          <p className="leading-relaxed">
            Teams play one match per week (Wednesday to Wednesday window). Some teams may
            have two matches per week depending on league size. At the conclusion of the 7-week
            regular season, top teams advance through a Play-In then Playoffs stage.
          </p>
          <p className="mt-2 leading-relaxed">
            <strong className="text-white">Default match time:</strong> Sunday at 7:00 PM PT (10:00 PM ET).
            Teams may reschedule by mutual agreement. All matches must be completed by Tuesday
            at 11:59 PM PT or the unavailable team receives a forfeit loss. Match results must be
            reported within 1 hour of completion.
          </p>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 2 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 2 — Eligibility</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">2.1 Collegiate Eligibility</h3>
          <p className="leading-relaxed">
            Players must currently attend or have previously attended a university, college, or
            equivalent academic program <strong className="text-white">located west of the Mississippi River</strong>.
            Residence does not affect eligibility — only school attendance is considered.
          </p>
          <p className="mt-2">Accepted proof of enrollment includes:</p>
          <ul className="list-disc list-inside mt-1 space-y-1 text-zinc-400">
            <li>Official transcript</li>
            <li>Enrollment verification letter</li>
            <li>School-issued ID</li>
            <li>Degree or diploma</li>
            <li>Any other official academic documentation</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">2.2 Rank Eligibility</h3>
          <p className="leading-relaxed">
            All players must have a <strong className="text-white">Rank Value of 1280 or higher</strong>.
          </p>
          <div className="mt-3 bg-zinc-900 border border-zinc-700 rounded-lg px-5 py-4 text-center">
            <p className="text-sm text-zinc-400 mb-1">Rank Value Formula</p>
            <p className="text-white font-mono">
              [(AT Peak 2s + Season Peak 2s) × 1.2 + (AT Peak 3s + Season Peak 3s) × 0.8] ÷ 4
            </p>
          </div>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 3 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 3 — Draft</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">3.1 Auction Draft</h3>
          <p className="leading-relaxed">
            The league uses an <strong className="text-white">auction draft format</strong>. Captains are determined by
            Rank Value. Each captain receives <strong className="text-white">1,000 Credits</strong> to spend on players.
            Captains unable to attend may submit a planning sheet and an admin will act on their behalf.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">3.2 Auction Draft Steps</h3>
          <ol className="list-decimal list-inside space-y-3 text-zinc-300">
            <li><strong className="text-white">Player Nomination</strong> — Captains take turns nominating players (snake format). Each captain has 45 seconds. Maximum starting bid is $800. If no decision is made, the highest ranked available player is automatically nominated.</li>
            <li><strong className="text-white">Bidding Round</strong> — 45-second bidding window with 5-second slow mode. Tie bids go to the first captain who placed the bid.</li>
            <li><strong className="text-white">Round Conclusion</strong> — Admin calls the round end. Any bids after that are void. Winning bid is deducted from the captain&apos;s budget.</li>
            <li><strong className="text-white">Repeat</strong> — Steps 1–3 repeat until all players are drafted.</li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">3.3 Trading</h3>
          <p className="leading-relaxed">
            Once the draft concludes, <strong className="text-white">rosters are locked for the entire season</strong>.
            No trades, exchanges, or player transfers are permitted. Attempting to arrange unofficial
            player swaps is a rules violation subject to disciplinary action.
          </p>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 4 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 4 — Spirit of the Game</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">4.1 Sportsmanship</h3>
          <p className="leading-relaxed">
            This league has a <strong className="text-white">zero-tolerance policy</strong> for bullying, harassment, or
            poor sportsmanship. Any player in violation will be removed. Disrespect toward staff
            regarding rule enforcement will not be tolerated.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">4.2 Inactivity</h3>
          <p className="leading-relaxed">
            A player is inactive if they have missed 50%+ of scheduled matches (after 4+ matches played)
            without a reasonable excuse. Inactive players will be removed; their captain is responsible
            for finding a replacement.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">4.3 Cheating</h3>
          <p className="mb-2">Zero-tolerance policy. Violations include:</p>
          <ul className="space-y-2 text-zinc-300">
            {[
              ["Exploiting", "Intentionally using in-game bugs or glitches for competitive advantage."],
              ["Hacking", "Modifying the game client or using unauthorized third-party software."],
              ["Ringing", "Playing under another player's account or facilitating impersonation."],
              ["Cheating Devices/Programs", "Using hardware or software not approved by admins."],
              ["Intentional Disconnection", "Deliberately leaving a match without both teams' consent."],
              ["Illicit Use of Admin Controls", "Altering match time, score, or outcome without authorization."],
              ["Collusion", "Agreements to manipulate match outcomes, including soft playing or match throwing."],
              ["Smurfing", "Competing on an alternate/unregistered account to misrepresent skill level."],
            ].map(([term, def]) => (
              <li key={term} className="flex gap-2">
                <span className="font-semibold text-white shrink-0">{term} —</span>
                <span>{def}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">4.4 Violations</h3>
          <p className="leading-relaxed">
            The admin team will review all details before making a final decision. The player may
            present their case during review. Once the admin team decides on expulsion,{" "}
            <strong className="text-white">that decision is final and cannot be appealed</strong>.
          </p>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 5 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 5 — Substitutions</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">5.1 Procedures</h3>
          <p className="leading-relaxed">
            Each team may use a maximum of <strong className="text-white">one substitute player per series</strong>.
            Using more than one results in a forfeit loss. The opposing team and admins must be
            notified before the match begins. Subs are drawn from the Sub List on the Master Sheet.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">5.2 Sub Requirements</h3>
          <p className="leading-relaxed">
            A substitute must have an average MMR that is{" "}
            <strong className="text-white">the exact MMR or below</strong> the player they replace.
            The substitute&apos;s Rocket League tracker must be sent to the opposing team for verification.
          </p>
          <div className="mt-2 bg-red-950/40 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
            Confirmation must be received from the opposing team before the substitution is finalized.
            If not in the match channel, a screenshot of confirmation from party chat is required.
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">5.3 Right to Suspect</h3>
          <p className="leading-relaxed">
            If the opposing team believes a substitution is being made solely for competitive advantage,
            they may request admin review before the match is played.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">5.4 In-Game Substitutions</h3>
          <p className="leading-relaxed">
            Substitutions are <strong className="text-white">not permitted during a game</strong> but are
            allowed between games within a series. Must be communicated to the match admin before
            the next game begins.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">5.4 Playoff Substitutions</h3>
          <p className="leading-relaxed">
            Only permitted in emergencies or pre-communicated scheduling conflicts. Subs may not
            be pulled from teams currently active in the playoffs. Last-minute substitutions are not
            permitted — arrange subs in advance if there is any doubt.
          </p>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 6 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 6 — Timeouts</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">6.1 Technical Timeout</h3>
          <p className="leading-relaxed">
            Each team gets <strong className="text-white">one technical timeout per series</strong> (max 1 minute).
            May be called at any point for disconnects, lag, or connection issues. The admin will pause
            the game. If a player cannot reconnect within the timeout, their team plays with available players.
            Both teams are responsible for tracking the timer from the moment the game is paused.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">6.2 Tactical Timeout</h3>
          <p className="leading-relaxed">
            In a Best of 7 series, each team gets <strong className="text-white">one tactical timeout</strong> (max 2 minutes).
            May only be used between games, not during live play. Notify the admin before the next game.
            Unused tactical timeouts do not carry over.
          </p>
        </div>
      </section>

      <hr className="border-zinc-800" />

      {/* Section 7 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Section 7 — Match Management</h2>

        <div>
          <h3 className="font-semibold text-white mb-2">7.1 Match Channels</h3>
          <p className="leading-relaxed">
            Each week, dedicated match channels are created for competing teams. All official
            communication must take place in these channels. Teams may request an early channel
            from admins if they wish to play before the scheduled week.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">7.2 Confirming Gametime</h3>
          <p className="leading-relaxed">
            Teams are solely responsible for managing their own scheduling. Admins will not accept
            excuses for missed matches due to scheduling confusion. Once a match time is confirmed,
            notify a tournament organizer for documentation. Failure to appear at a confirmed time
            may result in a forfeit loss.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">7.3 Rescheduling</h3>
          <p className="leading-relaxed">
            Matches may be rescheduled but must be completed within their designated match week
            by that week&apos;s deadline. Matches cannot be postponed into a subsequent week.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-white mb-2">7.4 Match Reporting</h3>
          <p className="mb-2">The winning team must report the result by:</p>
          <ol className="list-decimal list-inside space-y-1 text-zinc-300">
            <li>Tagging a Tournament Organizer in the match channel.</li>
            <li>Reporting the score as: <code className="bg-zinc-800 px-1 rounded">[Winning Team] __ — __ [Losing Team]</code></li>
            <li>Uploading all replay files to the match channel.</li>
          </ol>
          <p className="mt-2 text-sm text-zinc-500">
            Reports not following this format will not be recorded until correctly submitted.
          </p>
        </div>
      </section>

      <div className="pb-8 text-xs text-zinc-600 text-center">
        All rules are for CRLW6mans Summer League. Rules subject to change.
      </div>
    </div>
  );
}
