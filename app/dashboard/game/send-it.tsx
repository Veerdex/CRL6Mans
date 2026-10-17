"use client";

import { useEffect, useRef } from "react";

// The game is a document, not a component. It is built out of game-proto/ by
// `npm run game:build` into public/send-it/, and framed here.
//
// Framed rather than ported because it owns its document: it looks its elements up by id
// at module scope, hangs listeners on window, and runs its own requestAnimationFrame loop
// that never stops. A module is cached for the life of the tab, so importing it into a
// client component would start the game on the first visit and leave a dead canvas and a
// set of leaked listeners on the second. Unmounting the frame takes all of it with it.
//
// It also wants a viewport: its buttons are position: fixed and it reads the safe-area
// insets. Inside the frame those mean the frame, which is what they should mean here.
const GAME_URL = "/send-it/index.html";

// The day's seed rides in the query string because that is the one channel a framed
// document reads before its first frame. The game treats an out-of-range or missing seed
// as absent and falls back to its own date seed, so a stale frame still plays.
export default function SendIt({ seed }: { seed: number }) {
  const frame = useRef<HTMLIFrameElement>(null);

  // Keys go to the focused document, so without this the arrows and space scroll the
  // dashboard behind the game instead of driving. Refocused on every press into the frame
  // because clicking anything else on the page takes it back.
  useEffect(() => {
    const focus = () => frame.current?.focus();
    focus();
    window.addEventListener("pointerdown", focus);
    return () => window.removeEventListener("pointerdown", focus);
  }, []);

  return (
    // The marker the portrait guard in globals.css looks for. It sits on the game rather
    // than on the route so the lock lifts for exactly as long as the game is mounted, and
    // comes back on its own when the player navigates away — no effect, no cleanup.
    <div className="mx-auto w-full max-w-5xl" data-landscape-ok>
      <iframe
        ref={frame}
        src={`${GAME_URL}?seed=${seed}`}
        title="Send It"
        // Without this the frame reports document.fullscreenEnabled as false and the game
        // removes its own full-screen button, which is the correct thing for it to do and
        // the wrong thing to let happen here. Fullscreening the frame gives the game the
        // whole display; its own corner controls come with it, since it goes fullscreen on
        // its document rather than on the canvas.
        allow="fullscreen"
        // The old boolean alongside the permission policy: WebKit and Firefox still gate
        // on this one, and Chrome reports the frame as fullscreen-capable either way.
        allowFullScreen
        // Tall enough to leave the hill some sky, and capped against the viewport so the
        // whole game is reachable without scrolling the dashboard under it. These are the
        // portrait numbers: held sideways on a phone the frame is pinned to the viewport
        // instead, by the rule keyed on data-landscape-ok.
        className="block w-full h-[min(72vh,640px)] min-h-[420px] rounded-xl border border-white/10 bg-zinc-950"
      />
    </div>
  );
}
