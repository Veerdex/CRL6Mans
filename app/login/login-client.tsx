"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { APP_NAME } from "@/app/lib/constants";

const VIDEO_ID = "7gDosXgDNUM";
const IDLE_MS = 3000;
const MAX_VOLUME = 25; // 0–100 scale; 25 = 0.25×
const FADE_MS = 1500;

export function LoginClient({ error }: { error?: string }) {
  const [cardVisible, setCardVisible] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ytReadyRef = useRef(false);
  const currentVolRef = useRef(0);
  const targetVolRef = useRef(0);
  const rafRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "https://www.youtube.com"
    );
  }, []);

  const animateVolumeTo = useCallback((targetVol: number) => {
    targetVolRef.current = targetVol;
    cancelAnimationFrame(rafRef.current);
    if (!ytReadyRef.current) return;
    const fromVol = currentVolRef.current;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / FADE_MS, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const vol = fromVol + (targetVol - fromVol) * eased;
      currentVolRef.current = vol;
      sendCommand("setVolume", [Math.round(vol)]);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else currentVolRef.current = targetVol;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [sendCommand]);

  // Listen for YouTube's onReady postMessage — fired automatically when
  // enablejsapi=1 is in the embed URL. Using this as the ready signal
  // avoids calling new YT.Player() which always reinitializes the player.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com") return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.event === "onReady" && !ytReadyRef.current) {
          ytReadyRef.current = true;
          sendCommand("unMute");
          sendCommand("setVolume", [0]);
          animateVolumeTo(targetVolRef.current);
        }
      } catch { /* ignore non-JSON */ }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      cancelAnimationFrame(rafRef.current);
    };
  }, [animateVolumeTo, sendCommand]);

  // Mouse idle tracking
  useEffect(() => {
    const onMove = () => {
      setCardVisible(true);
      animateVolumeTo(0);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setCardVisible(false);
        animateVolumeTo(MAX_VOLUME);
      }, IDLE_MS);
    };

    window.addEventListener("mousemove", onMove);
    idleTimerRef.current = setTimeout(() => {
      setCardVisible(false);
      animateVolumeTo(MAX_VOLUME);
    }, IDLE_MS);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [animateVolumeTo]);

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
          opacity: cardVisible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          pointerEvents: cardVisible ? "auto" : "none",
        }}
        className="relative z-[2] w-full max-w-sm p-8 space-y-8 bg-zinc-900/90 backdrop-blur-sm rounded-2xl border border-zinc-800"
      >
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white tracking-tight">{APP_NAME}</h1>
          <p className="text-zinc-400 text-sm">Competitive Rocket League pickup queue</p>
        </div>

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

        <p className="text-center text-xs text-zinc-500">
          By logging in, you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
