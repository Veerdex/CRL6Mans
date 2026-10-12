"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { LeagueStatsButton, LeagueStatsDialog } from "./stats-modal";

const VIDEO_ID = "NBFVztq7OlU";
const IDLE_MS = 3000;  // mouse-still delay before the login card fades out
const MAX_VOLUME = 15; // 0–100 scale; 15 = 0.15×
const RAMP_MS = 3000;  // 0 → MAX_VOLUME, once, the moment audio unlocks
const FADE_MS = 1500;  // login card opacity transition

export function LoginClient({ error }: { error?: string }) {
  const [cardVisible, setCardVisible] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ytReadyRef = useRef(false);
  const unlockedRef = useRef(false);
  const currentVolRef = useRef(0);
  const rafRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "https://www.youtube.com"
    );
  }, []);

  const animateVolumeTo = useCallback((targetVol: number) => {
    cancelAnimationFrame(rafRef.current);
    const fromVol = currentVolRef.current;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / RAMP_MS, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const vol = fromVol + (targetVol - fromVol) * eased;
      currentVolRef.current = vol;
      sendCommand("setVolume", [Math.round(vol)]);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else currentVolRef.current = targetVol;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [sendCommand]);

  // Audio needs two independent unlocks — the API channel and a user gesture —
  // and neither one alone is worth sending a volume command on. setVolume comes
  // before unMute because the player's own volume is whatever YouTube last
  // remembered (usually 100), and unmuting first would burst that before the
  // ramp takes over. Once it runs the volume is set for good: the mouse moves
  // the card, not the sound.
  const applyAudio = useCallback(() => {
    if (!ytReadyRef.current || !unlockedRef.current) return;
    sendCommand("setVolume", [0]);
    sendCommand("unMute");
    currentVolRef.current = 0;
    animateVolumeTo(MAX_VOLUME);
  }, [animateVolumeTo, sendCommand]);

  // Unlock one: open the event channel. enablejsapi=1 is not enough on its own
  // — the iframe sends no messages at all, onReady included, until the parent
  // posts `listening` to it. That handshake is the thing new YT.Player() does
  // for you, so dropping the wrapper without replacing it left the ready flag
  // permanently false and no volume command was ever sent. Retried on an
  // interval because the iframe is in the SSR'd HTML and can finish loading
  // either side of hydration, and the first reply stops it.
  useEffect(() => {
    const openChannel = () =>
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
        "https://www.youtube.com"
      );
    const handshake = setInterval(openChannel, 500);
    openChannel();

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com") return;
      clearInterval(handshake);
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const ready =
          data?.event === "onReady" ||
          data?.event === "initialDelivery" ||
          data?.event === "alreadyInitialized";
        if (ready && !ytReadyRef.current) {
          ytReadyRef.current = true;
          applyAudio();
        }
      } catch { /* ignore non-JSON */ }
    };
    window.addEventListener("message", onMessage);
    return () => {
      clearInterval(handshake);
      window.removeEventListener("message", onMessage);
      cancelAnimationFrame(rafRef.current);
    };
  }, [applyAudio]);

  // Unlock two: a real gesture. Unmuting without user activation is not merely
  // ignored — Chrome treats it as an autoplay violation and **pauses the
  // video**, so ramping on the idle timer alone would freeze the background
  // instead of adding sound to it. mousemove is not activation; a click, tap or
  // keypress is. Until one lands the montage plays silently, which is the
  // browser's call to make, not ours.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      applyAudio();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [applyAudio]);

  // Mouse idle tracking — card visibility only. Volume used to duck to 0 on
  // every mousemove and ramp back up on the idle timer, which meant the sound
  // came and went with the cursor; it now ramps once and stays put.
  //
  // The timer is disarmed while the stats panel is open, and `showCard` keeps
  // the card up regardless. Reading the panel means holding the mouse still,
  // which would otherwise fade the card out underneath it — and the card is what
  // carries the button, so closing would leave nothing to press until the cursor
  // moved again. Closing re-shows the card and re-arms a full idle window.
  useEffect(() => {
    if (statsOpen) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    const onMove = () => {
      setCardVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setCardVisible(false), IDLE_MS);
    };

    window.addEventListener("mousemove", onMove);
    idleTimerRef.current = setTimeout(() => setCardVisible(false), IDLE_MS);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [statsOpen]);

  const showCard = cardVisible || statsOpen;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      {/* YouTube background — plain iframe, no YT.Player wrapper */}
      <div
        style={{ position: "fixed", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <iframe
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&mute=1&loop=1&playlist=${VIDEO_ID}&controls=0&disablekb=1&rel=0&showinfo=0&iv_load_policy=3&enablejsapi=1`}
          allow="autoplay; encrypted-media"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "max(100vw, 177.78vh)",
            height: "max(100vh, 56.25vw)",
            border: "none",
          }}
          title=""
        />
      </div>

      {/* Darkening overlay */}
      <div className="fixed inset-0 bg-black/55 z-[1]" aria-hidden="true" />

      {/* Montage credit */}
      <div className="fixed bottom-4 left-0 right-0 z-[1] flex justify-center pointer-events-none">
        <p className="text-sm text-on-accent bg-black/40 px-3 py-1 rounded-full">
          Montage by Thankful! ツ
        </p>
      </div>

      {/* Login card */}
      <div
        style={{
          opacity: showCard ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          pointerEvents: showCard ? "auto" : "none",
        }}
        className="relative z-[2] w-full max-w-sm p-8 space-y-8 bg-zinc-900/90 backdrop-blur-sm rounded-2xl border border-zinc-800"
      >
        {/* The dashboard's <AppTitle /> colors these two words the other way
            round — orange West, blue 6Mans — so the wordmark is deliberately
            spelled out here rather than shared. */}
        <h1 className="text-3xl font-bold text-white tracking-tight text-center">
          CRL <span style={{ color: "#3736ac" }}>West</span>{" "}
          <span style={{ color: "#e88a24" }}>6Mans</span>
        </h1>

        {error && (
          <p className="text-center text-sm text-red-400">
            {error === "cancelled"
              ? "Login cancelled."
              : error === "invalid_sponsor_link"
              ? "This sponsor invite link is invalid or has been disabled."
              : error === "sponsor_link_full"
              ? "This sponsor invite link has reached its limit. Ask an admin to raise it."
              : "Authentication failed. Please try again."}
          </p>
        )}

        <a
          href="/api/auth/discord"
          className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3c45a5] text-on-accent font-semibold rounded-lg transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
            <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.4a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.6 37.6 0 0 0 25.6.5a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 11 4.9a.2.2 0 0 0-.1.1C1.6 18.7-1 32.2.3 45.5a.2.2 0 0 0 .1.1 58.8 58.8 0 0 0 17.7 8.9.2.2 0 0 0 .3-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0c11.5 5.2 24 5.2 35.3 0a.2.2 0 0 1 .2 0l1.1.8c.1.1.1.3 0 .4a36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3c1 2 2.3 4 3.6 5.9a.2.2 0 0 0 .3.1 58.6 58.6 0 0 0 17.7-8.9.2.2 0 0 0 .1-.1c1.5-15.6-2.5-29-10.6-41a.2.2 0 0 0-.1-.2zM23.7 37.6c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 4-2.8 7.1-6.4 7.1zm23.7 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 4-2.8 7.1-6.4 7.1z" />
          </svg>
          Login with Discord
        </a>

        <LeagueStatsButton onClick={() => setStatsOpen(true)} />

        <p className="text-center text-xs text-zinc-500">
          By logging in, you agree to our terms of service.
        </p>
      </div>

      {/* A sibling of the card, never a child: the card's backdrop-blur makes it
          the containing block for a fixed descendant, which would size this to
          max-w-sm, and the idle fade would take an open panel down with it. */}
      <LeagueStatsDialog
        open={statsOpen}
        onClose={() => {
          setStatsOpen(false);
          setCardVisible(true);
        }}
      />
    </div>
  );
}
