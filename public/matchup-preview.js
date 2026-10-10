// Every style below is lifted from the real components so this previews what
// ships, not a lookalike. STATE_STYLES / STATE_LABELS mirror bracket-display.tsx,
// "live" included — it has a real counterpart now. The pulsing dot is the one
// thing on this page with none, so it is off by default and labelled proposed.
const STATES = {
  completed: {
    name: "Completed", tag: "FINAL", real: true,
    card: { border: "rgba(5,150,105,.7)",  bg: "rgba(2,44,34,.3)" },
    tagColor: "var(--emerald-400)",
    desc: "Both scores recorded. The winner's row lifts to white on a white/5 wash; the loser dims to zinc-500.",
  },
  upcoming: {
    name: "Upcoming", tag: "UPCOMING", real: true,
    card: { border: "rgba(99,102,241,.6)", bg: "rgba(30,27,75,.25)", shadow: "0 4px 6px -1px rgba(30,27,75,.3)" },
    tagColor: "var(--indigo-400)",
    desc: "Both teams assigned, no scores yet. This is <code>ready</code> in bracket-display's own vocabulary.",
  },
  live: {
    name: "Active", tag: "LIVE", real: true,
    // border-cyan-500/70 bg-cyan-950/30 shadow-cyan-900/30 shadow-md
    card: { border: "rgba(6,182,212,.7)", bg: "rgba(8,51,68,.3)", shadow: "0 4px 6px -1px rgba(22,78,99,.3)" },
    tagColor: "var(--cyan-400)",
    desc: "Both teams checked in, no scores yet. The clock counts up from <code>matches.started_at</code>, " +
      "stamped the instant the second team checks in. Check-in is tournament-only, so a season match never reaches this.",
    foot: "<code>isMatchLive</code> in <code>app/lib/match-live.ts</code> is the one predicate all four views share: " +
      "stamped, still <code>scheduled</code>, no scores. The stamp is never cleared — a match stops being live because it " +
      "has scores — so the read also requires both check-in booleans to still be true, which is what ends the state if a " +
      "check-in is cleared by hand. Every clock on a page ticks off one shared interval " +
      "(<code>season/live-clock.tsx</code> via <code>useSyncExternalStore</code>) and renders nothing during SSR, so no " +
      "elapsed time is ever baked into the HTML. The schedule row below is the one surface not wired up.",
  },
  waiting: {
    name: "Waiting", tag: "WAITING", real: true,
    card: { border: "rgba(180,83,9,.5)",   bg: "rgba(69,26,3,.2)" },
    tagColor: "var(--amber-500)",
    desc: "One side advanced, the other slot still shows its <code>Winner of …</code> feeder label.",
  },
  pending: {
    name: "TBD", tag: "TBD", real: true,
    card: { border: "rgba(185,28,28,.5)",  bg: "rgba(69,10,10,.2)" },
    tagColor: "var(--red-500)",
    desc: "Neither slot filled. Both rows render clickable feeder labels that pan the canvas.",
  },
  bye: {
    name: "Bye", tag: "BYE", real: true,
    card: { border: "rgba(63,63,70,.6)",   bg: "rgba(24,24,27,.4)" },
    tagColor: "var(--zinc-500)",
    desc: "Scores present but a slot is empty — an auto-advance. The empty row reads <code>BYE</code>.",
  },
};

// hybrid-display.tsx's statusStyle has only four branches — completed, live,
// hasTeams, else — so it does not share bracket-display.tsx's six. Several bracket
// states collapse into one treatment here, and pending is zinc there, not red.
// live sits above hasTeams, so a live match with both slots filled reads LIVE.
const HYBRID = {
  completed: { border: "rgba(5,150,105,.7)",  bg: "rgba(2,44,34,.3)",   tag: "var(--emerald-400)", label: "FINAL" },
  upcoming:  { border: "rgba(99,102,241,.6)", bg: "rgba(30,27,75,.25)", tag: "var(--indigo-400)",  label: "UPCOMING" },
  live:      { border: "rgba(6,182,212,.7)",  bg: "rgba(8,51,68,.3)",   tag: "var(--cyan-400)",    label: "LIVE" },
  waiting:   { border: "rgba(63,63,70,.6)",   bg: "rgba(24,24,27,.4)",  tag: "var(--zinc-600)",    label: "TBD", via: "collapses to TBD" },
  pending:   { border: "rgba(63,63,70,.6)",   bg: "rgba(24,24,27,.4)",  tag: "var(--zinc-600)",    label: "TBD" },
  bye:       { border: "rgba(5,150,105,.7)",  bg: "rgba(2,44,34,.3)",   tag: "var(--emerald-400)", label: "FINAL", via: "collapses to FINAL" },
};

// The schedule row's pill is a different dimension entirely: schedule/page.tsx
// derives `confirmed` from scheduled_at + schedule_accepted/admin_scheduled, so it
// says whether the play time is agreed — nothing about the match being played.
const SCHED = {
  confirmed: { name: "Confirmed", tag: "AGREED",   t: "Confirmed", fg: "var(--emerald-400)", bg: "rgba(52,211,153,.1)", bd: "rgba(4,120,87,.3)", time: true,  timeOk: true },
  proposed:  { name: "Pending",   tag: "PROPOSED", t: "Pending",   fg: "var(--amber-400)",   bg: "rgba(251,191,36,.1)", bd: "rgba(180,83,9,.3)", time: true,  timeOk: false },
  none:      { name: "No time",   tag: "TBD",      t: "TBD",       fg: "var(--zinc-500)",    bg: "var(--zinc-800)",     bd: "var(--zinc-700)",   time: false, timeOk: false },
};

// Which states each view can actually reach. The schedule page queries
// .eq("status", "scheduled"), so a completed match is never listed there at all.
// It is also the one view the clock was not wired into, so it omits live.
const REACH = {
  v1: ["completed", "upcoming", "live", "waiting", "pending", "bye"],
  v2: ["completed", "upcoming", "live", "waiting", "pending", "bye"],
  v3: ["completed", "upcoming", "live"],
  v4: ["upcoming", "waiting", "pending"],
};

// How long the previewed match has been going. The point of the switcher is the
// last one: h:mm:ss is seven glyphs and the Swiss slot is a fixed 40px, sized for
// a "2 – 1" score, so this is where the placement is actually load-bearing.
const ELAPSED = {
  fresh: { name: "Just kicked off", tag: "0:07",    secs: 7 },
  mid:   { name: "Mid-series",      tag: "12:34",   secs: 754 },
  long:  { name: "Past an hour",    tag: "1:02:33", secs: 3753 },
};

// The shipped heights and the proposed one. MATCH_H/MH are read by the bracket's
// own layout math, not just the card, so the ported change is more than a number.
const SIZES = {
  tall:    { name: "Proposed",    tag: "+25%",    bracket: 100, hybrid: 100, group: 38, swiss: 35, swissW: 315 },
  current: { name: "Ships today", tag: "CURRENT", bracket: 68,  hybrid: 66,  group: 30, swiss: 28, swissW: 210 },
};

let state = "completed";
let schedState = "confirmed";
let size = "tall";
let zoom = 1;
let elapsedKey = "mid";
// The ISO string a real row would hold, derived from the preset so the clock
// below ticks forward from it exactly as it does in production.
let startedAt = new Date(Date.now() - ELAPSED[elapsedKey].secs * 1000).toISOString();

// Copied verbatim from app/lib/match-live.ts — if the two ever disagree, this
// page is lying about what ships.
function formatElapsed(iso, now) {
  const total = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
}

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

function read() {
  const s = STATES[state];
  const done = state === "completed" || state === "bye";
  const live = state === "live";
  // No running score: isMatchLive requires both scores to still be null, so a
  // match with any score reported has left the live state by definition. The
  // clock is what fills the slot a final score would occupy.
  const showScore = done;
  const hs = +el("homeScore").value || 0;
  const as = +el("awayScore").value || 0;
  return {
    s, done, live, showScore,
    homeName: el("homeName").value || "Team A",
    awayName: el("awayName").value || "Team B",
    hs, as,
    homeWon: done && hs > as,
    awayWon: done && as > hs,
    logos: el("logos").checked,
    // Which slots hold a team at all.
    homeSet: state !== "pending",
    awaySet: state !== "pending" && state !== "waiting" && state !== "bye",
  };
}

function mark(team) {
  return team ? '<div class="dot"></div>' : '<div class="dot empty"></div>';
}
function badge(v) {
  return v.logos
    ? '<img class="logo" alt="" src="data:image/svg+xml;utf8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#575ce8"/></svg>') + '" />'
    : null;
}

function slot(v, side) {
  const isHome = side === "home";
  const set = isHome ? v.homeSet : v.awaySet;
  const won = isHome ? v.homeWon : v.awayWon;
  const score = isHome ? v.hs : v.as;
  const name = isHome ? v.homeName : v.awayName;

  let inner;
  if (set) {
    const cls = won ? "tname won" : v.done ? "tname lost" : "tname";
    inner = (badge(v) || mark(true)) + '<span class="' + cls + '">' + esc(name) + "</span>";
  } else if (state === "bye") {
    inner = mark(false) + '<span class="tname feeder">BYE</span>';
  } else {
    const feeder = isHome ? "Winner of W1-M1" : "Winner of W1-M2";
    inner = mark(false) + '<span class="tname feeder link">' + feeder + "</span>";
  }
  if (v.showScore && set) {
    inner += '<span class="score' + (won ? " won" : "") + '">' + score + "</span>";
  }
  return inner;
}

function render() {
  const v = read();
  const s = v.s;

  // The clock element every placement shares. Its text is rewritten in place by
  // tick() rather than re-rendered, so a typed team name never loses focus.
  const clock = () => '<span class="clock" data-clock>' + formatElapsed(startedAt, Date.now()) + "</span>";
  const dot = () => el("livedot").checked
    ? '<span class="livedot" style="display:inline-block;margin-right:5px;vertical-align:1px"></span>' : "";

  // ── Bracket label row ── id badge + state, and the clock beside them. This row
  // is production's own (bracket-display.tsx, above every MatchBox); the bracket
  // card has no spare vertical space to give the clock a line of its own.
  el("bracketLabel").innerHTML =
    '<span class="idbadge">W1-M1</span>' +
    '<span class="st" style="color:' + s.tagColor + '">' + dot() + s.tag + "</span>" +
    (v.live ? clock() : "");

  // ── Bracket match box ──
  const bc = el("bracketCard");
  bc.style.borderColor = s.card.border;
  bc.style.background = s.card.bg;
  bc.style.boxShadow = s.card.shadow || "none";
  bc.innerHTML =
    '<div class="teamrow' + (v.homeWon ? " won" : "") + '">' + slot(v, "home") + "</div>" +
    '<div class="divider"></div>' +
    '<div class="teamrow' + (v.awayWon ? " won" : "") + '">' + slot(v, "away") + "</div>";

  // ── Hybrid card (its own three-branch palette, not the bracket's five) ──
  const hy = HYBRID[state];
  const hc = el("hybridCard");
  hc.style.borderColor = hy.border;
  hc.style.background = hy.bg;
  hc.style.boxShadow = "none";
  hc.innerHTML =
    '<div class="hybridhead"><span class="badge">GF-1-1</span>' +
    '<span class="st" style="color:' + hy.tag + '">' + dot() + hy.label +
      // Inside the 22px header's 9px tag span, so the clock inherits that size
      // and only resets the tag's letter-spacing.
      (v.live ? clock() : "") +
    "</span></div>" +
    '<div class="teamrow' + (v.homeWon ? " won" : "") + '">' + slot(v, "home") + "</div>" +
    '<div class="teamrow' + (v.awayWon ? " won" : "") + '">' + slot(v, "away") + "</div>";

  // ── Group row ── emerald/red on the result, unlike Swiss below.
  const crest = (cls) => v.logos ? '<img class="' + cls + '" alt="" src="data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#575ce8"/></svg>') + '" />' : "";
  const gl = crest("glogo");
  const hSide = v.done ? (v.homeWon ? "win" : "loss") : "";
  const aSide = v.done ? (v.awayWon ? "win" : "loss") : "";
  const hName = esc(v.homeSet ? v.homeName : "?");
  const aName = esc(v.awaySet ? v.awayName : "?");
  el("groupRow").innerHTML =
    '<span class="gbadge">G1</span>' +
    '<div class="side ' + hSide + '">' + gl + "<span>" + hName + "</span></div>" +
    (v.showScore
      ? '<span class="mid final">' + v.hs + " &ndash; " + v.as + "</span>"
      : v.live
        ? '<span class="mid live">' + clock() + "</span>"
        : '<span class="mid">vs</span>') +
    '<div class="side away ' + aSide + '"><span>' + aName + "</span>" + gl + "</div>";

  // ── Swiss row ── same shape, but the winner goes white and the score sits in a
  // fixed 40px column rather than hugging the names.
  const sl = crest("slogo");
  el("swissRow").innerHTML =
    '<div class="side ' + hSide + '">' + sl + "<span>" + hName + "</span></div>" +
    '<span class="mid' + (v.showScore ? " final" : v.live ? " live" : "") + '">' +
      (v.showScore ? v.hs + " &ndash; " + v.as : v.live ? clock() : "vs") + "</span>" +
    '<div class="side away ' + aSide + '"><span>' + aName + "</span>" + sl + "</div>";

  // ── Schedule row ── The pill comes from the Scheduling control, not the state
  // switcher. Unassigned slots fall back to the literal "TBD" team name.
  const pill = v.live
    ? { t: "Live", fg: "var(--cyan-400)", bg: "rgba(34,211,238,.1)", bd: "rgba(8,145,178,.35)", time: true, timeOk: false }
    : SCHED[schedState];
  el("schedRow").innerHTML =
    '<div class="left"><p class="matchline">' + esc(v.homeSet ? v.homeName : "TBD") +
      '<span class="vs">vs</span>' + esc(v.awaySet ? v.awayName : "TBD") + "</p>" +
      '<p class="round">Grand Final &middot; R1</p></div>' +
    '<div class="right">' +
      (pill.time
        ? '<span class="time' + (pill.timeOk ? " ok" : "") + '">7:30 PM ' +
          new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZoneName: "short" }).formatToParts(new Date())
            .find((p) => p.type === "timeZoneName").value + "</span>"
        : "") +
      '<span class="pill" style="color:' + pill.fg + ";background:" + pill.bg + ";border-color:" + pill.bd + '">' +
        (v.live ? dot() : "") + pill.t +
      "</span>" +
    "</div>";

  // ── Notes + chrome ──
  el("note").innerHTML = s.desc;
  el("foot").innerHTML = s.foot ?? (s.real
    ? "This state ships today, though each view derives it differently: the bracket's " +
      "<code>getMatchState()</code> reads score and slot presence and ignores <code>status</code> outright; " +
      "the hybrid card branches on <code>status === \"completed\"</code> then on both slots being filled; " +
      "group and Swiss rows only ask whether <code>status === \"completed\"</code>. " +
      "<code>matches.status</code> itself is only ever <code>scheduled</code> or <code>completed</code>, and the " +
      "schedule row's pill is a separate axis — whether the play time is agreed."
    : "Nothing in <code>matches</code> records this, so no view can draw it yet.");

  // Not every state can occur in every view. A group or Swiss row always has both
  // teams, so it never reaches waiting/pending/bye, and the schedule page only
  // queries scheduled matches. Views that can't reach the current state say so and
  // dim, rather than passing off a placeholder as something that ships.
  [1, 2, 3, 4].forEach((n) => {
    const ok = REACH["v" + n].includes(state);
    el("na" + n).textContent = ok
      ? (n === 2 ? HYBRID[state].via ?? "" : "")
      : n === 4
        ? (v.live ? "not wired yet" : "never listed here")
        : "not in this view";
    el("v" + n).className = "view" + (ok ? "" : " dim");
  });
  el("elapsedGroup").style.opacity = v.live ? "1" : ".4";

  document.querySelectorAll("#states button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.k === state));
  });
  document.body.classList.toggle("reduce", el("reduce").checked);
  document.body.classList.toggle("tall", size === "tall");
  const sz = SIZES[size];
  el("dim1").innerHTML = "210&times;" + sz.bracket + (size === "tall" ? " &middot; proposed, ships 210&times;68" : "");
  el("dim2").innerHTML = "210&times;" + sz.hybrid + (size === "tall" ? " &middot; proposed, ships 210&times;66" : "");
  el("dim3").innerHTML = "group " + sz.group + "px &middot; swiss " + sz.swissW + "&times;" + sz.swiss +
    (size === "tall" ? " &middot; proposed, ships 30 / 210&times;28" : "");
  // The Swiss row is the only one of the four fitting two teams into a fixed
  // width, so a crest that grows with the row eats the name column: the box
  // inside its border, less 16 padding, less the 40px score and the two 4px
  // gaps, halved — plus the 8px the crest bleeds back when it stretches.
  const crestPx = size === "tall" ? sz.swiss : 14;
  const bleed = size === "tall" ? 8 : 0;
  el("squeeze").innerHTML = " &middot; " + ((sz.swissW - 2 - 16 - 40 - 8) / 2 + bleed - crestPx - 4) +
    "px left for each name" + (size === "tall" ? " (54px today)" : "");
  // A scaled element still occupies its unscaled box, so each holder's height is
  // measured unscaled and reserved at scale — otherwise the next view overlaps it.
  [1, 2, 3, 4].forEach((i) => {
    const h = el("h" + i);
    h.style.transform = "none";
    h.style.height = "auto";
    const natural = h.offsetHeight;
    h.style.transform = "scale(" + zoom + ")";
    h.style.height = natural * zoom + "px";
  });
  fitNote();
}

// Rewrite the clocks in place once a second. A full render() would rebuild the
// inputs' siblings every tick and is unnecessary — only this text changes.
function tick() {
  const txt = formatElapsed(startedAt, Date.now());
  document.querySelectorAll("[data-clock]").forEach((c) => { c.textContent = txt; });
  fitNote();
}

// The Swiss slot is the only placement with a hard width: 40px, chosen for a
// "2 – 1" score. Report the overflow rather than letting the preview hide it,
// since this is the one thing the placement can actually get wrong.
function fitNote() {
  const c = el("swissRow").querySelector("[data-clock]");
  const n = el("clockfit");
  if (!c) { n.innerHTML = ""; return; }
  const w = Math.ceil(c.getBoundingClientRect().width / zoom);
  n.innerHTML = w > 40 ? " &middot; clock wants " + w + "px in a 40px slot" : "";
}

// Build the state switcher, then the legend, which reuses the same swatches the
// real Legend() component renders.
el("states").innerHTML = Object.entries(STATES).map(([k, s]) =>
  '<button data-k="' + k + '" aria-pressed="false">' +
    '<span class="swatch" style="border-color:' + s.card.border + ";background:" + s.card.bg + '"></span>' +
    esc(s.name) + (s.real ? "" : " *") +
    '<span class="tag" style="color:' + s.tagColor + '">' + s.tag + "</span>" +
  "</button>"
).join("");

el("size").innerHTML = Object.entries(SIZES).map(([k, s]) =>
  '<button data-sz="' + k + '" aria-pressed="' + (k === size) + '">' +
    '<span class="swatch" style="border-color:var(--zinc-600);background:var(--zinc-800);height:' +
      Math.round(s.bracket / 7) + 'px"></span>' +
    esc(s.name) +
    '<span class="tag" style="color:var(--zinc-500)">' + esc(s.tag) + "</span>" +
  "</button>"
).join("");

el("elapsed").innerHTML = Object.entries(ELAPSED).map(([k, s]) =>
  '<button data-e="' + k + '" aria-pressed="' + (k === elapsedKey) + '">' +
    '<span class="swatch" style="border-color:rgba(6,182,212,.7);background:rgba(8,51,68,.3)"></span>' +
    esc(s.name) +
    '<span class="tag" style="color:var(--cyan-300);letter-spacing:0;font-family:' +
      'ui-monospace,Menlo,Consolas,monospace">' + esc(s.tag) + "</span>" +
  "</button>"
).join("");

el("sched").innerHTML = Object.entries(SCHED).map(([k, s]) =>
  '<button data-s="' + k + '" aria-pressed="' + (k === schedState) + '">' +
    '<span class="swatch" style="border-color:' + s.bd + ";background:" + s.bg + '"></span>' +
    esc(s.name) +
    '<span class="tag" style="color:' + s.fg + '">' + s.tag + "</span>" +
  "</button>"
).join("");

el("legend").innerHTML = Object.entries(STATES).map(([k, s]) =>
  '<span class="it"><span class="sw" style="border-color:' + s.card.border + ";background:" + s.card.bg + '"></span>' +
  esc(s.name) + (s.real ? "" : " (proposed)") + "</span>"
).join("");

el("zoom").innerHTML = [1, 2, 3].map((z) =>
  '<button data-z="' + z + '" aria-pressed="' + (z === 1) + '">' + z + "&times;</button>"
).join("");

el("states").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  state = b.dataset.k;
  render();
});
el("size").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sz]");
  if (!b) return;
  size = b.dataset.sz;
  document.querySelectorAll("#size button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.sz === size)));
  render();
});
el("elapsed").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-e]");
  if (!b) return;
  elapsedKey = b.dataset.e;
  startedAt = new Date(Date.now() - ELAPSED[elapsedKey].secs * 1000).toISOString();
  document.querySelectorAll("#elapsed button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.e === elapsedKey)));
  // Jumping to a preset while sitting on another state is how you line the three
  // widths up, so switch to live rather than making it a two-click move.
  state = "live";
  render();
});
el("sched").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-s]");
  if (!b) return;
  schedState = b.dataset.s;
  document.querySelectorAll("#sched button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.s === schedState)));
  render();
});
el("zoom").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-z]");
  if (!b) return;
  zoom = +b.dataset.z;
  document.querySelectorAll("#zoom button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.z === zoom)));
  render();
});
["homeName", "awayName", "homeScore", "awayScore", "logos", "reduce", "livedot"].forEach((id) => {
  el(id).addEventListener("input", render);
});

render();
setInterval(tick, 1000);
