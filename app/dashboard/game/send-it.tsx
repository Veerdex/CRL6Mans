"use client";

import { useEffect, useRef, useState } from "react";

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
  const [expanded, setExpanded] = useState(false);

  // Keys go to the focused document, so without this the arrows and space scroll the
  // dashboard behind the game instead of driving. Refocused on every press into the frame
  // because clicking anything else on the page takes it back.
  useEffect(() => {
    const focus = () => frame.current?.focus();
    focus();
    window.addEventListener("pointerdown", focus);
    return () => window.removeEventListener("pointerdown", focus);
  }, []);

  // Full screen for the half of the world that has no element fullscreen — every iPhone,
  // where the API exists on <video> and nowhere else, so the frame's `allow` has nothing to
  // grant. What the game can be given there is this frame: the attribute below pins it to
  // the viewport (the rule is in globals.css, beside the one that does the same for a phone
  // held sideways) and the sidebar, the mobile nav and the page heading are painted over
  // rather than unmounted, so coming back out is the same press again.
  //
  // The state is held here rather than in the game so there is one copy of it, and answered
  // back on every change and on every frame load. The load half is not spare: the game
  // replaces its own location when the daily seed rolls over, which hands the frame a new
  // document that would otherwise draw the "expand" icon over an already-expanded frame.
  useEffect(() => {
    const el = frame.current;
    const answer = () =>
      el?.contentWindow?.postMessage({ sendIt: "expand-state", expanded }, window.location.origin);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== el?.contentWindow || e.origin !== window.location.origin) return;
      const msg = e.data as { sendIt?: unknown; on?: unknown } | null;
      if (msg?.sendIt !== "expand-request") return;
      setExpanded(msg.on === true);
    };
    window.addEventListener("message", onMessage);
    el?.addEventListener("load", answer);
    answer();
    return () => {
      window.removeEventListener("message", onMessage);
      el?.removeEventListener("load", answer);
    };
  }, [expanded]);

  return (
    // The marker the portrait guard in globals.css looks for. It sits on the game rather
    // than on the route so the lock lifts for exactly as long as the game is mounted, and
    // comes back on its own when the player navigates away — no effect, no cleanup.
    <div
      className="mx-auto w-full max-w-5xl"
      data-landscape-ok
      // Set from the game's own button, read only by globals.css. An attribute rather than a
      // class because the rules it drives sit next to the landscape pin and are keyed the
      // same way, and because `main:has()` upstream of here needs something to look for.
      data-expanded={expanded ? "" : undefined}
    >
      <iframe
        ref={frame}
        src={`${GAME_URL}?seed=${seed}`}
        title="Send It"
        // Without this the frame reports document.fullscreenEnabled as false, and the game
        // falls back to asking this component to expand the frame — which is the right
        // answer on a phone, where there is no element fullscreen to permit, and a poor one
        // everywhere the browser can give it the actual display. Fullscreening the frame
        // takes the game's own corner controls with it, since it goes fullscreen on its
        // document rather than on the canvas.
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
