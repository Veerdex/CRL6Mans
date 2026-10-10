// Every style below is lifted from the real components so this previews what
// ships, not a lookalike. STATE_STYLES / STATE_LABELS mirror bracket-display.tsx;
// "live" is the one entry with no counterpart in the codebase.
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
    name: "Active", tag: "LIVE", real: false,
    card: { border: "rgba(8,145,178,.75)", bg: "rgba(8,51,68,.35)", shadow: "0 0 0 1px rgba(34,211,238,.15)" },
    tagColor: "var(--cyan-400)",
    desc: "<strong>Proposed — does not exist yet.</strong> No table column or render path distinguishes a match being played from one not yet started.",
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

// hybrid-display.tsx's statusStyle has only three branches — completed, hasTeams,
// else — so it does not share bracket-display.tsx's five. Several bracket states
// collapse into one treatment here, and pending is zinc there, not red.
const HYBRID = {
  completed: { border: "rgba(5,150,105,.7)",  bg: "rgba(2,44,34,.3)",   tag: "var(--emerald-400)", label: "FINAL" },
  upcoming:  { border: "rgba(99,102,241,.6)", bg: "rgba(30,27,75,.25)", tag: "var(--indigo-400)",  label: "UPCOMING" },
  live:      { border: "rgba(8,145,178,.75)", bg: "rgba(8,51,68,.35)",  tag: "var(--cyan-400)",    label: "LIVE" },
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
const REACH = {
  v1: ["completed", "upcoming", "waiting", "pending", "bye"],
  v2: ["completed", "upcoming", "waiting", "pending", "bye"],
  v3: ["completed", "upcoming"],
  v4: ["upcoming", "waiting", "pending"],
};

// The shipped heights and the proposed one. MATCH_H/MH are read by the bracket's
// own layout math, not just the card, so the ported change is more than a number.
const SIZES = {
  tall:    { name: "210×100", tag: "PROPOSED", bracket: 100, hybrid: 100 },
  current: { name: "Ships today",  tag: "68 / 66",  bracket: 68,  hybrid: 66 },
};

let state = "completed";
let schedState = "confirmed";
let size = "tall";
let zoom = 1;

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

function read() {
  const s = STATES[state];
  const done = state === "completed" || state === "bye";
  const live = state === "live";
  // A live match shows a running score; the bracket only ever shows a final one.
  const showScore = done || live;
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
    '<span class="st" style="color:' + hy.tag + '">' +
      (v.live ? '<span class="livedot" style="display:inline-block;margin-right:5px"></span>' : "") +
      hy.label +
    "</span></div>" +
    '<div class="teamrow' + (v.homeWon ? " won" : "") + '">' + slot(v, "home") + "</div>" +
    '<div class="teamrow' + (v.awayWon ? " won" : "") + '">' + slot(v, "away") + "</div>";

  // ── Group / Swiss row ──
  const gl = v.logos ? '<img class="glogo" alt="" src="data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#575ce8"/></svg>') + '" />' : "";
  const hSide = v.done ? (v.homeWon ? "win" : "loss") : "";
  const aSide = v.done ? (v.awayWon ? "win" : "loss") : "";
  el("groupRow").innerHTML =
    '<span class="gbadge">G1</span>' +
    '<div class="side ' + hSide + '">' + gl + "<span>" + esc(v.homeSet ? v.homeName : "?") + "</span></div>" +
    (v.showScore
      ? '<span class="mid final">' + v.hs + " &ndash; " + v.as + "</span>"
      : '<span class="mid">vs</span>') +
    '<div class="side away ' + aSide + '"><span>' + esc(v.awaySet ? v.awayName : "?") + "</span>" + gl + "</div>";

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
        (v.live ? '<span class="livedot" style="display:inline-block;margin-right:5px;vertical-align:1px"></span>' : "") +
        pill.t +
      "</span>" +
    "</div>";

  // ── Notes + chrome ──
  el("note").innerHTML = s.desc;
  el("foot").innerHTML = s.real
    ? "This state ships today, though each view derives it differently: the bracket's " +
      "<code>getMatchState()</code> reads score and slot presence and ignores <code>status</code> outright; " +
      "the hybrid card branches on <code>status === \"completed\"</code> then on both slots being filled; " +
      "group and Swiss rows only ask whether <code>status === \"completed\"</code>. " +
      "<code>matches.status</code> itself is only ever <code>scheduled</code> or <code>completed</code>, and the " +
      "schedule row's pill is a separate axis — whether the play time is agreed."
    : "Nothing in <code>matches</code> records that a series is underway, so no view can draw this yet. " +
      "Showing it would need a new column (a <code>started_at</code>, or <code>status = 'active'</code>) plus a writer — " +
      "the Discord <code>/score</code> flow is the natural place.";

  // Not every state can occur in every view. A group or Swiss row always has both
  // teams, so it never reaches waiting/pending/bye, and the schedule page only
  // queries scheduled matches. Views that can't reach the current state say so and
  // dim, rather than passing off a placeholder as something that ships.
  [1, 2, 3, 4].forEach((n) => {
    const ok = REACH["v" + n].includes(state);
    el("na" + n).textContent = v.live
      ? "proposed"
      : ok
        ? (n === 2 ? HYBRID[state].via ?? "" : "")
        : n === 4 ? "never listed here" : "not in this view";
    el("v" + n).className = "view" + (ok || v.live ? "" : " dim");
  });

  document.querySelectorAll("#states button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.k === state));
  });
  document.body.classList.toggle("reduce", el("reduce").checked);
  document.body.classList.toggle("tall", size === "tall");
  const sz = SIZES[size];
  el("dim1").innerHTML = "210&times;" + sz.bracket + (size === "tall" ? " &middot; proposed, ships 210&times;68" : "");
  el("dim2").innerHTML = "210&times;" + sz.hybrid + (size === "tall" ? " &middot; proposed, ships 210&times;66" : "");
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
["homeName", "awayName", "homeScore", "awayScore", "logos", "reduce"].forEach((id) => {
  el(id).addEventListener("input", render);
});

render();
