// GENERATED — do not hand-edit. Produced by the DE7 simulator, which plays a
// 7-team Double Elimination tournament to completion through the real routing
// helpers in app/lib/bracket.ts (generateDEMatchInserts, wbLoserTarget,
// lbWinnerTarget) and the real server-side advancement from bracket-server.ts
// (WB R1 bye advancement, LB ghosting) and discord-bot.ts (advanceBracketWinner,
// resolveDeByeMatches). The rows below are therefore the rows production would
// hold, not a hand-authored clean finish — which is why LB R1 M1 arrives as a
// bye: its home feeder is the WB R1 bye, so no loser ever reaches it.
window.DE7 = {
 "size": 8,
 "numWB": 3,
 "numLB": 4,
 "numR1WB": 4,
 "numR1LB": 2,
 "seedOrder": [
  1,
  8,
  4,
  5,
  2,
  7,
  3,
  6
 ],
 "teams": {
  "t1": {
   "id": "t1",
   "name": "Neon Vipers",
   "seed": 1,
   "logo_url": "#575ce8"
  },
  "t2": {
   "id": "t2",
   "name": "Aerial Dynasty",
   "seed": 2,
   "logo_url": "#e88a24"
  },
  "t3": {
   "id": "t3",
   "name": "Boost Cartel",
   "seed": 3,
   "logo_url": null
  },
  "t4": {
   "id": "t4",
   "name": "Midnight Whiplash",
   "seed": 4,
   "logo_url": "#0e9f6e"
  },
  "t5": {
   "id": "t5",
   "name": "Zero Gravity",
   "seed": 5,
   "logo_url": null
  },
  "t6": {
   "id": "t6",
   "name": "Cobalt Surge",
   "seed": 6,
   "logo_url": "#c026d3"
  },
  "t7": {
   "id": "t7",
   "name": "Flip Reset FC",
   "seed": 7,
   "logo_url": null
  }
 },
 "labels": {
  "wb": {
   "1-1": "W-A",
   "1-2": "W-B",
   "1-3": "W-C",
   "1-4": "W-D",
   "2-1": "W-E",
   "2-2": "W-F",
   "3-1": "W-G"
  },
  "lb": {
   "1-1": "L-A",
   "1-2": "L-B",
   "2-1": "L-C",
   "2-2": "L-D",
   "3-1": "L-E",
   "4-1": "L-F"
  }
 },
 "roundNames": {
  "wb": {
   "1": "Quarterfinals",
   "2": "Semifinals",
   "3": "Final"
  }
 },
 "finishes": {
  "sweep": [
   {
    "id": "m1",
    "stage": "de_winners",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": null,
    "home_score": 1,
    "away_score": 0
   },
   {
    "id": "m2",
    "stage": "de_winners",
    "round": 1,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t4",
    "away_team_id": "t5",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m3",
    "stage": "de_winners",
    "round": 1,
    "match_number": 3,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t7",
    "home_score": 2,
    "away_score": 0
   },
   {
    "id": "m4",
    "stage": "de_winners",
    "round": 1,
    "match_number": 4,
    "status": "completed",
    "home_team_id": "t3",
    "away_team_id": "t6",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m5",
    "stage": "de_winners",
    "round": 2,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t5",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m6",
    "stage": "de_winners",
    "round": 2,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t3",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m7",
    "stage": "de_winners",
    "round": 3,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t3",
    "home_score": 3,
    "away_score": 2
   },
   {
    "id": "m8",
    "stage": "de_losers",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": null,
    "away_team_id": "t4",
    "home_score": 0,
    "away_score": 1
   },
   {
    "id": "m9",
    "stage": "de_losers",
    "round": 1,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t7",
    "away_team_id": "t6",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m10",
    "stage": "de_losers",
    "round": 2,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t4",
    "away_team_id": "t5",
    "home_score": 0,
    "away_score": 2
   },
   {
    "id": "m11",
    "stage": "de_losers",
    "round": 2,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t7",
    "away_team_id": "t2",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m12",
    "stage": "de_losers",
    "round": 3,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t5",
    "away_team_id": "t2",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m13",
    "stage": "de_losers",
    "round": 4,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t3",
    "home_score": 3,
    "away_score": 2
   },
   {
    "id": "m14",
    "stage": "de_grand_final",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t2",
    "home_score": 3,
    "away_score": 1
   },
   {
    "id": "m15",
    "stage": "de_grand_final",
    "round": 1,
    "match_number": 2,
    "status": "pending",
    "home_team_id": null,
    "away_team_id": null,
    "home_score": null,
    "away_score": null
   }
  ],
  "reset": [
   {
    "id": "m1",
    "stage": "de_winners",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": null,
    "home_score": 1,
    "away_score": 0
   },
   {
    "id": "m2",
    "stage": "de_winners",
    "round": 1,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t4",
    "away_team_id": "t5",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m3",
    "stage": "de_winners",
    "round": 1,
    "match_number": 3,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t7",
    "home_score": 2,
    "away_score": 0
   },
   {
    "id": "m4",
    "stage": "de_winners",
    "round": 1,
    "match_number": 4,
    "status": "completed",
    "home_team_id": "t3",
    "away_team_id": "t6",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m5",
    "stage": "de_winners",
    "round": 2,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t5",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m6",
    "stage": "de_winners",
    "round": 2,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t3",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m7",
    "stage": "de_winners",
    "round": 3,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t3",
    "home_score": 3,
    "away_score": 2
   },
   {
    "id": "m8",
    "stage": "de_losers",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": null,
    "away_team_id": "t4",
    "home_score": 0,
    "away_score": 1
   },
   {
    "id": "m9",
    "stage": "de_losers",
    "round": 1,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t7",
    "away_team_id": "t6",
    "home_score": 2,
    "away_score": 1
   },
   {
    "id": "m10",
    "stage": "de_losers",
    "round": 2,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t4",
    "away_team_id": "t5",
    "home_score": 0,
    "away_score": 2
   },
   {
    "id": "m11",
    "stage": "de_losers",
    "round": 2,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t7",
    "away_team_id": "t2",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m12",
    "stage": "de_losers",
    "round": 3,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t5",
    "away_team_id": "t2",
    "home_score": 1,
    "away_score": 2
   },
   {
    "id": "m13",
    "stage": "de_losers",
    "round": 4,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t2",
    "away_team_id": "t3",
    "home_score": 3,
    "away_score": 2
   },
   {
    "id": "m14",
    "stage": "de_grand_final",
    "round": 1,
    "match_number": 1,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t2",
    "home_score": 2,
    "away_score": 3
   },
   {
    "id": "m15",
    "stage": "de_grand_final",
    "round": 1,
    "match_number": 2,
    "status": "completed",
    "home_team_id": "t1",
    "away_team_id": "t2",
    "home_score": 1,
    "away_score": 3
   }
  ]
 }
};
