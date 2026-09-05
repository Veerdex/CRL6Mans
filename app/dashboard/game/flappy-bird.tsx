"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { submitScore, type Leaderboard, type LeaderboardRow } from "./actions";
import { PlayerName } from "@/app/dashboard/player-name";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

// ─── Constants ────────────────────────────────────────────────────────────────
const W = 380;
const H = 520;
const GROUND_H = 44;
const PLAY_H = H - GROUND_H;
const BIRD_X = 75;
const SCALE = 1.5; // CSS display scale — internal coords stay the same
const BIRD_R = 13;
const DEG = Math.PI / 180;

const GRAVITY = 0.38;
const PIPE_W = 52;
const SPAWN_MS = 1600;
const GROUND_TILE = 60;

const WING_CYCLE = [0, 1, 2, 1] as const; // up · mid · down · mid

// Play Again button in canvas coords
const BTN = { x: W / 2 - 58, y: PLAY_H / 2 + 38, w: 116, h: 38 };

// ─── Difficulty (only speed scales; caps at 2.5× base by score 100) ──────────
// score   0 → speed 2.4
// score 100 → speed 6.0  (2.5×)
function pipeSpeed(score: number)     { return Math.min(5.5, 2.4 + score * 0.031) }
function pipeGap(score: number)       { return Math.max(145 * 3/4, 145 - score * (29 / 80)) }
function spawnInterval(score: number) { return Math.max(900, 1600 / (1 + 0.00778 * score)) }
function flapVelocity(_score: number) { return -7.2 }

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = "idle" | "running" | "dead";
interface Pipe     { x: number; topH: number; scored: boolean; gap: number; speed: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Popup    { x: number; y: number; life: number }
interface Cloud    { x: number; y: number; s: number }

// ─── Module-level helpers ────────────────────────────────────────────────────
function randomTopH(gap: number) {
  return Math.random() * (PLAY_H - gap - 80) + 40;
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  ctx.beginPath();
  ctx.arc(x,            y,            20 * s, 0, Math.PI * 2);
  ctx.arc(x + 22 * s,  y - 7 * s,   15 * s, 0, Math.PI * 2);
  ctx.arc(x + 40 * s,  y,            17 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  rotation: number,
  wing: 0 | 1 | 2,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const wAngles: Record<0 | 1 | 2, number> = { 0: -0.55, 1: 0, 2: 0.55 };
  ctx.save();
  ctx.rotate(wAngles[wing]);
  ctx.beginPath();
  ctx.ellipse(-4, 3, 8, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#f59e0b";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbf24";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(1, 3, 7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(5, -4, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(6, -4, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(BIRD_R - 1, -1);
  ctx.lineTo(BIRD_R + 6,  1);
  ctx.lineTo(BIRD_R - 1,  3);
  ctx.fillStyle = "#f97316";
  ctx.fill();

  ctx.restore();
}

// ─── Audio (Web Audio API, synthesized — no files) ───────────────────────────
let _ac: AudioContext | null = null;
function getAC(): AudioContext {
  if (!_ac) _ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (_ac.state === "suspended") _ac.resume();
  return _ac;
}

function playFlap() {
  const c = getAC(), t = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.07);
  g.gain.setValueAtTime(0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.start(t); osc.stop(t + 0.07);
}

function playHitPipe() {
  const c = getAC(), t = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = "square";
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(100, t + 0.2);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.start(t); osc.stop(t + 0.2);
}

function playHitGround() {
  const c = getAC(), t = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.start(t); osc.stop(t + 0.25);
}

function playScorePoint() {
  const c = getAC(), t = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.start(t); osc.stop(t + 0.12);
}

function playArpeggio(freqs: number[], step: number, dur: number, vol: number) {
  const c = getAC();
  freqs.forEach((freq, i) => {
    const t = c.currentTime + i * step;
    const osc = c.createOscillator(), g = c.createGain();
    osc.connect(g); g.connect(c.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur);
  });
}

function playScore10() {
  // Quick E5 A5 C6 ascending chime
  playArpeggio([659, 880, 1047], 0.07, 0.18, 0.16);
}

function playScore100() {
  // C5 E5 G5 C6 — ascending major arpeggio
  playArpeggio([523, 659, 784, 1047], 0.11, 0.28, 0.22);
}

function playScore1000() {
  // C5→G6 fanfare with final chord
  playArpeggio([523, 659, 784, 988, 1175, 1568], 0.09, 0.42, 0.25);
  const c = getAC(), t = c.currentTime + 5 * 0.09;
  [1960, 2350].forEach(freq => {
    const osc = c.createOscillator(), g = c.createGain();
    osc.connect(g); g.connect(c.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.start(t); osc.stop(t + 0.55);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FlappyBird({
  viewerDiscordId,
  initialLeaderboard,
}: {
  viewerDiscordId: string;
  initialLeaderboard: Leaderboard;
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef      = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  // true = using native Fullscreen API (desktop/Android), false = CSS fake fullscreen (iOS)
  const [nativeFS, setNativeFS] = useState(false);
  const [displayScale, setDisplayScale] = useState(SCALE);

  function computeFSScale() {
    const scaleX = (window.innerWidth  * 0.85) / W;
    const scaleY = (window.innerHeight * 0.85) / H;
    return Math.min(scaleX, scaleY);
  }

  function computeFitScale() {
    const avail = rootRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    return Math.min(SCALE, avail / W);
  }

  useEffect(() => {
    function onFSChange() {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      setNativeFS(fs);
      setDisplayScale(fs ? computeFSScale() : computeFitScale());
    }
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  useEffect(() => {
    function onResize() {
      setDisplayScale(prev => {
        if (document.fullscreenElement) return computeFSScale();
        return computeFitScale();
      });
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function toggleFullscreen() {
    if (!containerRef.current) return;

    if (document.fullscreenEnabled) {
      // Native API available (desktop, Android Chrome)
      if (document.fullscreenElement) document.exitFullscreen();
      else containerRef.current.requestFullscreen();
      return;
    }

    // CSS fake fullscreen for iOS Safari (no Fullscreen API)
    const next = !isFullscreen;
    setIsFullscreen(next);
    setNativeFS(false);
    setDisplayScale(next ? computeFSScale() : computeFitScale());
  }

  // All game state in refs — rAF loop never sees stale values
  const statusRef   = useRef<Status>("idle");
  const birdYRef    = useRef(PLAY_H / 2);
  const birdVyRef   = useRef(0);
  const birdRotRef  = useRef(0);
  const wingRef     = useRef(0);
  const pipesRef    = useRef<Pipe[]>([]);
  const scoreRef    = useRef(0);
  const nextPipeRef = useRef(0);
  const prevTRef    = useRef(0);
  const frameRef    = useRef(0);
  const rafRef      = useRef(0);
  const tickRef     = useRef<FrameRequestCallback>(() => {});
  const groundXRef  = useRef(0);
  const cloudsRef   = useRef<Cloud[]>([
    { x: 55,  y: 75,  s: 1   },
    { x: 200, y: 45,  s: 0.7 },
    { x: 310, y: 105, s: 1.2 },
  ]);
  const particlesRef  = useRef<Particle[]>([]);
  const popupsRef     = useRef<Popup[]>([]);
  const flashRef      = useRef(0);
  const submittingRef = useRef(false);
  const highScoreRef  = useRef(0);  // session best — drawn on canvas
  const newBestRef    = useRef(false);

  // Only the leaderboard needs React state (DOM table)
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(initialLeaderboard);

  const flap = useCallback(() => {
    const s = statusRef.current;
    if (s === "idle") {
      statusRef.current   = "running";
      scoreRef.current    = 0;
      newBestRef.current  = false;
      birdVyRef.current   = flapVelocity(0);
      nextPipeRef.current = performance.now() + SPAWN_MS;
      prevTRef.current    = 0;
      playFlap();
    } else if (s === "running") {
      birdVyRef.current = flapVelocity(scoreRef.current);
      playFlap();
    }
  }, []);

  const restart = useCallback(() => {
    statusRef.current     = "idle";
    birdYRef.current      = PLAY_H / 2;
    birdVyRef.current     = 0;
    birdRotRef.current    = 0;
    pipesRef.current      = [];
    scoreRef.current      = 0;
    particlesRef.current  = [];
    popupsRef.current     = [];
    flashRef.current      = 0;
    prevTRef.current      = 0;
    submittingRef.current = false;
    newBestRef.current    = false;
    // highScoreRef keeps session best across games
  }, []);

  // ── Single unified rAF loop — runs from mount until unmount ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function drawFrame() {
      const s = statusRef.current;

      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, PLAY_H);
      sky.addColorStop(0, "#06111f");
      sky.addColorStop(1, "#0e2040");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, PLAY_H);

      // Stars
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      for (const [sx, sy] of [
        [28,58],[118,28],[198,78],[288,18],[348,52],
        [78,148],[328,138],[158,108],[58,198],[308,88],
        [238,168],[44,278],[368,218],[130,240],[260,60],
      ] as [number,number][]) ctx.fillRect(sx, sy, 1.5, 1.5);

      // Clouds (parallax)
      for (const c of cloudsRef.current) drawCloud(ctx, c.x, c.y, c.s);

      // Pipes
      for (const p of pipesRef.current) {
        const botY = p.topH + p.gap;

        ctx.fillStyle = "#17355a";
        ctx.fillRect(p.x, 0,         PIPE_W, p.topH);
        ctx.fillRect(p.x, botY + 16, PIPE_W, PLAY_H - botY - 16);

        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fillRect(p.x + 7, 0,         7, p.topH);
        ctx.fillRect(p.x + 7, botY + 16, 7, PLAY_H - botY - 16);

        ctx.fillStyle = "#2b5590";
        ctx.fillRect(p.x - 5, p.topH - 16, PIPE_W + 10, 16);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(p.x + PIPE_W + 5 - 4, p.topH - 16, 4, 16);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(p.x - 5, p.topH - 16, 4, 16);

        ctx.fillStyle = "#2b5590";
        ctx.fillRect(p.x - 5, botY, PIPE_W + 10, 16);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(p.x + PIPE_W + 5 - 4, botY, 4, 16);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(p.x - 5, botY, 4, 16);
      }

      // Ground
      ctx.fillStyle = "#0c1c30";
      ctx.fillRect(0, PLAY_H, W, GROUND_H);
      ctx.fillStyle = "#1a3a5c";
      ctx.fillRect(0, PLAY_H, W, 3);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      const gx = ((groundXRef.current % GROUND_TILE) + GROUND_TILE) % GROUND_TILE;
      for (let tx = gx - GROUND_TILE; tx < W; tx += GROUND_TILE) {
        ctx.fillRect(tx, PLAY_H + 8, 2, GROUND_H - 10);
      }

      // Particles
      ctx.save();
      for (const par of particlesRef.current) {
        ctx.globalAlpha = Math.max(0, par.life);
        ctx.fillStyle = par.color;
        ctx.fillRect(par.x - 3, par.y - 3, 6, 6);
      }
      ctx.restore();

      // Score popups
      ctx.save();
      ctx.font = "bold 15px monospace";
      ctx.textAlign = "center";
      for (const pop of popupsRef.current) {
        ctx.globalAlpha = Math.max(0, pop.life);
        ctx.fillStyle = "#fbbf24";
        ctx.fillText("+1", pop.x, pop.y);
      }
      ctx.restore();

      // Bird
      const wing = WING_CYCLE[wingRef.current % 4];
      drawBird(ctx, BIRD_X, birdYRef.current, birdRotRef.current, wing);

      // In-game score
      if (s === "running") {
        ctx.textAlign = "center";
        ctx.font = "bold 34px monospace";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillText(String(scoreRef.current), W / 2 + 1, 51);
        ctx.fillStyle = "white";
        ctx.fillText(String(scoreRef.current), W / 2, 50);
      }

      // Death flash (drawn before overlays so it fades to reveal them)
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flashRef.current.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Idle overlay ─────────────────────────────────────────
      if (s === "idle") {
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        ctx.fillRect(0, 0, W, H);

        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 10;
        ctx.font = "bold 32px sans-serif";
        ctx.fillStyle = "white";
        ctx.fillText("Flappy Bird", W / 2, PLAY_H / 2 - 16);
        ctx.shadowBlur = 0;

        ctx.font = "14px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillText("Click or press Space to start", W / 2, PLAY_H / 2 + 16);
      }

      // ── Dead overlay ─────────────────────────────────────────
      if (s === "dead") {
        ctx.fillStyle = "rgba(0,0,0,0.58)";
        ctx.fillRect(0, 0, W, H);

        ctx.textAlign = "center";
        ctx.font = "bold 26px sans-serif";
        ctx.fillStyle = "white";
        ctx.fillText("Game Over", W / 2, PLAY_H / 2 - 70);

        ctx.font = "bold 56px monospace";
        ctx.fillText(String(scoreRef.current), W / 2, PLAY_H / 2 - 8);

        ctx.font = "13px sans-serif";
        if (newBestRef.current) {
          ctx.fillStyle = "#fbbf24";
          ctx.fillText("New personal best!", W / 2, PLAY_H / 2 + 28);
        } else if (highScoreRef.current > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.fillText(`Best: ${highScoreRef.current}`, W / 2, PLAY_H / 2 + 28);
        }

        // Play Again button
        ctx.fillStyle = "#4f46e5";
        drawRoundedRect(ctx, BTN.x, BTN.y, BTN.w, BTN.h, 8);
        ctx.fill();
        ctx.font = "bold 14px sans-serif";
        ctx.fillStyle = "white";
        ctx.fillText("Play Again", W / 2, BTN.y + BTN.h / 2 + 5);
      }
    }

    function spawnParticles(x: number, y: number) {
      const colors = ["#fbbf24", "#f97316", "#ef4444", "#fde68a", "#fb923c"];
      for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
        const speed = 1.5 + Math.random() * 3.5;
        particlesRef.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          life: 1,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }

    tickRef.current = (t: DOMHighResTimeStamp) => {
      const s = statusRef.current;
      const dt = prevTRef.current
        ? Math.min((t - prevTRef.current) / (1000 / 60), 3)
        : 1;
      prevTRef.current = t;
      frameRef.current++;
      const f = frameRef.current;

      // ── Idle ──────────────────────────────────────────────
      if (s === "idle") {
        birdYRef.current   = PLAY_H / 2 + Math.sin(f * 0.05) * 8;
        birdRotRef.current = 0;
        if (f % 20 === 0) wingRef.current = (wingRef.current + 1) % 4;
        for (const c of cloudsRef.current) {
          c.x -= 0.3 * dt;
          if (c.x < -80) c.x = W + 60;
        }
      }

      // ── Running ───────────────────────────────────────────
      if (s === "running") {
        birdVyRef.current += GRAVITY * dt;
        birdYRef.current  += birdVyRef.current * dt;

        const vy = birdVyRef.current;
        const targetRot = vy <= 0
          ? -20 * DEG
          : Math.min(70 * DEG, vy * 9 * DEG);
        const lerpSpeed = vy <= 0 ? 0.2 : 0.08;
        birdRotRef.current += (targetRot - birdRotRef.current) * lerpSpeed;

        if (f % 4 === 0) wingRef.current = (wingRef.current + 1) % 4;

        const curSpeed   = pipeSpeed(scoreRef.current);
        const curGap     = pipeGap(scoreRef.current);
        const curSpawnMs = spawnInterval(scoreRef.current);

        groundXRef.current -= curSpeed * dt;
        for (const c of cloudsRef.current) {
          c.x -= 0.3 * dt;
          if (c.x < -80) c.x = W + 60;
        }

        if (t >= nextPipeRef.current) {
          pipesRef.current.push({
            x: W + 10,
            topH: randomTopH(curGap),
            scored: false,
            gap: curGap,
            speed: curSpeed,
          });
          nextPipeRef.current = t + curSpawnMs;
        }

        for (const p of pipesRef.current) p.x -= p.speed * dt;
        pipesRef.current = pipesRef.current.filter(p => p.x > -PIPE_W - 20);

        for (const p of pipesRef.current) {
          if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) {
            p.scored = true;
            scoreRef.current++;
            if (scoreRef.current % 1000 === 0) playScore1000();
            else if (scoreRef.current % 100 === 0) playScore100();
            else if (scoreRef.current % 10 === 0) playScore10();
            else playScorePoint();
            popupsRef.current.push({ x: BIRD_X + 28, y: birdYRef.current - 22, life: 1 });
          }
        }

        const F = 3;
        const bL = BIRD_X - BIRD_R + F, bR = BIRD_X + BIRD_R - F;
        const bT = birdYRef.current - BIRD_R + F, bB = birdYRef.current + BIRD_R - F;
        const hitCeiling = birdYRef.current - BIRD_R <= 0;
        const hitGround  = birdYRef.current + BIRD_R >= PLAY_H;
        const hitPipe = pipesRef.current.some(p => {
          if (bR < p.x || bL > p.x + PIPE_W) return false;
          return bT < p.topH || bB > p.topH + p.gap;
        });

        if (hitCeiling || hitGround || hitPipe) {
          if (hitGround) playHitGround(); else playHitPipe();
          statusRef.current  = "dead";
          flashRef.current   = 0.75;
          birdRotRef.current = 70 * DEG;
          wingRef.current    = 2;
          spawnParticles(BIRD_X, birdYRef.current);
          const finalScore = scoreRef.current;
          highScoreRef.current = Math.max(highScoreRef.current, finalScore);

          if (finalScore > 0 && !submittingRef.current) {
            submittingRef.current = true;
            submitScore(finalScore).then(result => {
              submittingRef.current = false;
              if (!result.error) {
                if (result.newBest) newBestRef.current = true;
                if (result.leaderboard) setLeaderboard(result.leaderboard);
              }
            });
          }
        }
      }

      // ── Dead ──────────────────────────────────────────────
      if (s === "dead") {
        if (flashRef.current > 0)
          flashRef.current = Math.max(0, flashRef.current - 0.05 * dt);
        if (birdYRef.current + BIRD_R < PLAY_H) {
          birdVyRef.current += GRAVITY * dt;
          birdYRef.current   = Math.min(
            birdYRef.current + birdVyRef.current * dt,
            PLAY_H - BIRD_R,
          );
        }
      }

      // ── Always: update particles + popups ─────────────────
      for (const p of particlesRef.current) {
        p.x   += p.vx * dt;
        p.y   += p.vy * dt;
        p.vy  += 0.22 * dt;
        p.life -= 0.032 * dt;
      }
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      for (const p of popupsRef.current) {
        p.y    -= 0.8 * dt;
        p.life -= 0.028 * dt;
      }
      popupsRef.current = popupsRef.current.filter(p => p.life > 0);

      drawFrame();
      rafRef.current = requestAnimationFrame(tickRef.current);
    };

    rafRef.current = requestAnimationFrame(tickRef.current);

    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      if (statusRef.current === "dead") {
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top) * scaleY;
        if (cx >= BTN.x && cx <= BTN.x + BTN.w && cy >= BTN.y && cy <= BTN.y + BTN.h) {
          restart();
        }
        return;
      }
      flap();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); flap(); }
    };
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-8 w-full mx-auto" style={{ maxWidth: W * SCALE }}>
      {/* Fullscreen wrapper — centers canvas over black when fullscreen */}
      <div
        ref={containerRef}
        className="relative"
        style={isFullscreen ? {
          ...(nativeFS
            ? { width: "100vw", height: "100vh" }
            : { position: "fixed", inset: 0, zIndex: 9999 }),
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: "black",
        } : {}}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="rounded-xl cursor-pointer select-none block"
          style={{ width: W * displayScale, height: "auto", aspectRatio: `${W}/${H}`, maxWidth: "100%", touchAction: "none" }}
        />
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg bg-black/40 hover:bg-black/60 border border-[#fff]/10 text-[#fff]/60 hover:text-[#fff]/90 transition-colors"
        >
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          )}
        </button>
      </div>

      {/* Leaderboard */}
      <div>
        <h2 className="text-white font-semibold text-lg mb-3">Top Scores</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {leaderboard.top.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">
              No scores yet — be the first!
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {leaderboard.top.map(row => (
                  <ScoreRow key={row.discord_id} row={row} viewerDiscordId={viewerDiscordId} />
                ))}
                {leaderboard.self && (
                  <ScoreRow row={leaderboard.self} viewerDiscordId={viewerDiscordId} detached />
                )}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-zinc-600 mt-3">Only your personal best is saved.</p>
      </div>
    </div>
  );
}

// The viewer's own row is rendered detached below the top 10 when they didn't
// make the cut, so a saved score is always visible somewhere on the board.
// Matched on Discord ID, not username: game_scores.username is a snapshot from
// whenever the score was set, so a player who has since renamed would stop
// seeing their own row highlighted.
function ScoreRow({ row, viewerDiscordId, detached = false }: { row: LeaderboardRow; viewerDiscordId: string; detached?: boolean }) {
  return (
    <tr
      className={`border-b border-zinc-800 last:border-0 ${row.discord_id === viewerDiscordId ? "bg-indigo-950/30" : ""} ${
        detached ? "border-t-2 border-t-zinc-700" : ""
      }`}
    >
      <td
        className={`py-3 pl-4 w-10 font-mono text-xs ${
          row.rank === 1 ? "text-yellow-400"
          : row.rank === 2 ? "text-zinc-300"
          : row.rank === 3 ? "text-amber-700"
          : "text-zinc-600"
        }`}
      >
        #{row.rank}
      </td>
      <td className="py-3 text-zinc-200 font-medium">
        <span className="flex items-center gap-2 min-w-0">
          <PlayerAvatar
            discordId={row.discord_id}
            avatar={row.avatar}
            username={row.username}
            className="w-7 h-7"
          />
          <PlayerName
            displayName={row.display_name ?? null}
            username={row.username}
            discordId={row.discord_id}
          />
        </span>
      </td>
      <td className="py-3 pr-4 text-right text-white font-mono font-bold">
        {row.score}
      </td>
    </tr>
  );
}
