export const DEFAULT_RULES_MARKDOWN = `# Section 1 — Basic Information

|  |  |
|---|---|
| **Default Server** | US West (Central requires all 6 players + admin approval) |
| **Gamemode** | 3v3 |
| **Allowed Maps** | Any standard map |
| **Streamed Match Maps** | Boostfield Mall, Salty Shores (all variants), Aquadome, Beckwith Park, Estadio Vida |

Match count, best-of length, and the season schedule vary by tournament — see that tournament's Format tab. Every time on the site is shown in your own local timezone.

---

# Section 2 — Eligibility

### 2.1 Collegiate Eligibility

Players must currently attend or have previously attended a university, college, or equivalent academic program **located west of the Mississippi River**. Residence does not affect eligibility — only school attendance is considered.

Accepted proof of enrollment includes:

- Official transcript
- Enrollment verification letter
- School-issued ID
- Degree or diploma
- Any other official academic documentation

### 2.2 MMR Eligibility

Each season and each tournament can independently set its own **minimum peak MMR** requirement in 2v2 and/or 3v3 — **1v1 is not used**. Meeting either playlist's threshold is enough to qualify; you don't need to clear both. Neither value is fixed league-wide, and either (or both) can be left unset, in which case there's no MMR floor to join.

{{MMR_NOTE}}

---

# Section 3 — Draft

### 3.1 Team Formation

Once sign-ups close, all entered players are sorted onto teams — see below for how this specific season or tournament forms its rosters. Captains are always whoever has the highest Rank Value on their team.

### 3.2 Snake Draft

When a snake draft is used, it runs on a live, shared draft page that anyone can watch — but picks aren't made on the website. A captain submits their pick with the \`/pick <player>\` Discord command when it's their turn. Pick order alternates direction each round: the first round runs from the highest-numbered team down to Team 1, the next round reverses, and so on. Each captain has **45 seconds** to submit a pick — if the clock runs out, the system automatically picks the best-available player on that captain's behalf.

### 3.3 Auto-Balance

When auto-balance is used, there is no live draft to watch or participate in. Once the sign-up period closes, the system automatically sorts all entered players onto teams by Rank Value to keep rosters even. Captains are still assigned normally — whoever has the highest Rank Value on a team becomes its captain.

### 3.4 Rosters Lock

Once teams are formed — whether by draft or auto-balance — **rosters are locked for the entire season**. No trades, exchanges, or player transfers are permitted. Attempting to arrange unofficial player swaps is a rules violation subject to disciplinary action.

---

# Section 4 — Spirit of the Game

### 4.1 Sportsmanship

This league has a **zero-tolerance policy** for bullying, harassment, or poor sportsmanship. Any player in violation will be removed. Disrespect toward staff regarding rule enforcement will not be tolerated.

### 4.2 Inactivity

A player is inactive if they have missed 50%+ of scheduled matches (after 4+ matches played) without a reasonable excuse. Inactive players will be removed; their captain is responsible for finding a replacement.

### 4.3 Cheating

Zero-tolerance policy. Violations include:

- **Exploiting** — Intentionally using in-game bugs or glitches for competitive advantage.
- **Hacking** — Modifying the game client or using unauthorized third-party software.
- **Ringing** — Playing under another player's account or facilitating impersonation.
- **Cheating Devices/Programs** — Using hardware or software not approved by admins.
- **Intentional Disconnection** — Deliberately leaving a match without both teams' consent.
- **Illicit Use of Admin Controls** — Altering match time, score, or outcome without authorization.
- **Collusion** — Agreements to manipulate match outcomes, including soft playing or match throwing.
- **Smurfing** — Competing on an alternate/unregistered account to misrepresent skill level.

### 4.4 Violations

The admin team will review all details before making a final decision. The player may present their case during review. Once the admin team decides on expulsion, **that decision is final and cannot be appealed**.

---

# Section 5 — Substitutions

### 5.1 Procedures

Each team may use a maximum of **one substitute player per series**. Using more than one results in a forfeit loss. The opposing team and admins must be notified before the match begins. Subs are drawn from the Sub List on the Master Sheet.

### 5.2 Sub Requirements

A substitute must have an average MMR that is **the exact MMR or below** the player they replace. The substitute's Rocket League tracker must be sent to the opposing team for verification.

> Confirmation must be received from the opposing team before the substitution is finalized. If not in the match channel, a screenshot of confirmation from party chat is required.

### 5.3 Right to Suspect

If the opposing team believes a substitution is being made solely for competitive advantage, they may request admin review before the match is played.

### 5.4 In-Game Substitutions

Substitutions are **not permitted during a game** but are allowed between games within a series. Must be communicated to the match admin before the next game begins.

### 5.5 Playoff Substitutions

Only permitted in emergencies or pre-communicated scheduling conflicts. Subs may not be pulled from teams currently active in the playoffs. Last-minute substitutions are not permitted — arrange subs in advance if there is any doubt.

---

# Section 6 — Timeouts

### 6.1 Technical Timeout

Each team gets **one technical timeout per series** (max 2 minutes). May be called at any point for disconnects, lag, or connection issues. The admin will pause the game. If a player cannot reconnect within the timeout, their team plays with available players. Both teams are responsible for tracking the timer from the moment the game is paused.

### 6.2 Tactical Timeout

In a Best of 7 series, each team gets **one tactical timeout** (max 2 minutes). May only be used between games, not during live play. Notify the admin before the next game. Unused tactical timeouts do not carry over.

---

# Section 7 — Match Management

### 7.1 Match Channels

Dedicated match channels are created for competing teams each round. All official communication must take place in these channels. Teams may request an early channel from admins if they wish to play before their scheduled round.

### 7.2 Confirming Gametime

Teams are solely responsible for managing their own scheduling. Admins will not accept excuses for missed matches due to scheduling confusion. Once a match time is confirmed, notify a tournament organizer for documentation. Failure to appear at a confirmed time may result in a forfeit loss.

### 7.3 Rescheduling

Matches may be rescheduled but must be completed within their designated round by that round's deadline. Matches cannot be postponed into a subsequent round.

### 7.4 Match Reporting

Match results are reported entirely on the website — there is no manual score entry for teams. Any player on either roster can submit:

1. Go to your team's series on the site and upload the \`.replay\` file(s) from the games you played (\`.replay\` only, 5MB max per file).
2. The site automatically parses each replay, determines the score, and matches players to rosters to decide the winner — you do not type in a score.
3. A player on the **opposing** team must then confirm the submitted result. Confirming immediately finalizes the match and advances the bracket.

> If the opposing team doesn't confirm in time, the result auto-confirms on its own — no admin action is required either way. Contact an admin only if something looks wrong before it auto-confirms.

---

All rules are for CRLW6mans Summer League. Rules subject to change.
`;
