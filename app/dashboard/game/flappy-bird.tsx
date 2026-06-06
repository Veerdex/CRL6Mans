"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { submitScore } from "./actions";

// ─── Constants ────────────────────────────────────────────────────────────────
const W = 380;
const H = 520;
const GROUND_H = 44;
const PLAY_H = H - GROUND_H;
const BIRD_X = 75;
const BIRD_R = 13;
const DEG = Math.PI / 180;

const GRAVITY = 0.38;
const FLAP_V = -7.2;
const PIPE_W = 52;
const PIPE_GAP = 145;
const PIPE_SPEED = 2.4;
const SPAWN_MS = 1600;
const GROUND_TILE = 60;

const WING_CYCLE = [0, 1, 2, 1] as const; // up · mid · down · mid

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = "idle" | "running" | "dead";
interface Pipe     { x: number; topH: number; scored: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Popup    { x: number; y: number; life: number }
interface Cloud    { x: number; y: number; s: number }

// ─── Module-level helpers (no component state) ────────────────────────────────
function randomTopH() {
  return Math.random() * (PLAY_H - PIPE_GAP - 80) + 40;
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  ctx.beginPath();
  ctx.arc(x,            y,            20 * s, 0, Math.PI * 2);
  ctx.arc(x + 22 * s,  y - 7 * s,   15 * s, 0, Math.PI * 2);
  ctx.arc(x + 40 * s,  y,            17 * s, 0, Math.PI * 2);
  ctx.fill();
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

  // Wing (behind body); angle changes per frame-state
  const wAngles: Record<0 | 1 | 2, number> = { 0: -0.55, 1: 0, 2: 0.55 };
  ctx.save();
  ctx.rotate(wAngles[wing]);
  ctx.beginPath();
  ctx.ellipse(-4, 3, 8, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#f59e0b";
  ctx.fill();
  ctx.restore();

  // Body
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbf24";
  ctx.fill();

  // Belly highlight
  ctx.beginPath();
  ctx.arc(1, 3, 7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();

  // Eye white
  ctx.beginPath();
  ctx.arc(5, -4, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();
  // Pupil
  ctx.beginPath();
  ctx.arc(6, -4, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();

  // Beak
  ctx.beginPath();
  ctx.moveTo(BIRD_R - 1, -1);
  ctx.lineTo(BIRD_R + 6,  1);
  ctx.lineTo(BIRD_R - 1,  3);
  ctx.fillStyle = "#f97316";
  ctx.fill();

  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
interface LeaderboardRow { username: string; score: number }

export default function FlappyBird({
  username,
  initialLeaderboard,
}: {
  username: string;
  initialLeaderboard: LeaderboardRow[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Game state — all in refs so the rAF loop never sees stale values
  const statusRef   = useRef<Status>("idle");
  const birdYRef    = useRef(PLAY_H / 2);
  const birdVyRef   = useRef(0);
  const birdRotRef  = useRef(0);
  const wingRef     = useRef(0);          // index into WING_CYCLE
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
  const submittingRef = useRef(false); // prevents double-submit on rapid deaths

  // React state — only for overlay rendering
  const [status,    setStatus]    = useState<Status>("idle");
  const [uiScore,   setUiScore]   = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [newBest,   setNewBest]   = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>(initialLeaderboard);

  const flap = useCallback(() => {
    const s = statusRef.current;
    if (s === "idle") {
      statusRef.current   = "running";
      birdVyRef.current   = FLAP_V;
      nextPipeRef.current = performance.now() + SPAWN_MS;
      prevTRef.current    = 0;
      scoreRef.current    = 0;
      setStatus("running");
      setUiScore(0);
      setNewBest(false);
    } else if (s === "running") {
      birdVyRef.current = FLAP_V;
    }
  }, []);

  const restart = useCallback(() => {
    statusRef.current    = "idle";
    birdYRef.current     = PLAY_H / 2;
    birdVyRef.current    = 0;
    birdRotRef.current   = 0;
    pipesRef.current     = [];
    scoreRef.current     = 0;
    particlesRef.current = [];
    popupsRef.current    = [];
    flashRef.current     = 0;
    prevTRef.current     = 0;
    submittingRef.current = false;
    setStatus("idle");
    setUiScore(0);
    setNewBest(false);
  }, []);

  // ── Single unified rAF loop — runs from mount until unmount ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function drawFrame() {
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
        const botY = p.topH + PIPE_GAP;

        // Body
        ctx.fillStyle = "#17355a";
        ctx.fillRect(p.x, 0,        PIPE_W, p.topH);
        ctx.fillRect(p.x, botY + 16, PIPE_W, PLAY_H - botY - 16);

        // Highlight strip on body
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fillRect(p.x + 7, 0,        7, p.topH);
        ctx.fillRect(p.x + 7, botY + 16, 7, PLAY_H - botY - 16);

        // Cap top
        ctx.fillStyle = "#2b5590";
        ctx.fillRect(p.x - 5, p.topH - 16, PIPE_W + 10, 16);
        // Cap top: left shadow / right highlight
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(p.x + PIPE_W + 5 - 4, p.topH - 16, 4, 16);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(p.x - 5, p.topH - 16, 4, 16);

        // Cap bottom
        ctx.fillStyle = "#2b5590";
        ctx.fillRect(p.x - 5, botY, PIPE_W + 10, 16);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(p.x + PIPE_W + 5 - 4, botY, 4, 16);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(p.x - 5, botY, 4, 16);
      }

      // Ground base
      ctx.fillStyle = "#0c1c30";
      ctx.fillRect(0, PLAY_H, W, GROUND_H);
      // Ground top edge highlight
      ctx.fillStyle = "#1a3a5c";
      ctx.fillRect(0, PLAY_H, W, 3);
      // Ground scrolling vertical lines
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

      // Score popups (+1 floating text)
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
      if (statusRef.current === "running") {
        ctx.textAlign = "center";
        ctx.font = "bold 34px monospace";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillText(String(scoreRef.current), W / 2 + 1, 51);
        ctx.fillStyle = "white";
        ctx.fillText(String(scoreRef.current), W / 2, 50);
      }

      // Death flash
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flashRef.current.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
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
        // slow cloud drift even on start screen
        for (const c of cloudsRef.current) {
          c.x -= 0.3 * dt;
          if (c.x < -80) c.x = W + 60;
        }
      }

      // ── Running ───────────────────────────────────────────
      if (s === "running") {
        // Physics
        birdVyRef.current += GRAVITY * dt;
        birdYRef.current  += birdVyRef.current * dt;

        // Rotation: smooth lerp toward target angle
        const vy = birdVyRef.current;
        const targetRot = vy <= 0
          ? -20 * DEG
          : Math.min(70 * DEG, vy * 9 * DEG);
        const lerpSpeed = vy <= 0 ? 0.2 : 0.08;
        birdRotRef.current += (targetRot - birdRotRef.current) * lerpSpeed;

        // Wing: cycle every 4 frames while playing
        if (f % 4 === 0) wingRef.current = (wingRef.current + 1) % 4;

        // Ground + cloud scroll
        groundXRef.current -= PIPE_SPEED * dt;
        for (const c of cloudsRef.current) {
          c.x -= 0.3 * dt;
          if (c.x < -80) c.x = W + 60;
        }

        // Pipe spawn
        if (t >= nextPipeRef.current) {
          pipesRef.current.push({ x: W + 10, topH: randomTopH(), scored: false });
          nextPipeRef.current = t + SPAWN_MS;
        }

        // Move & cull
        for (const p of pipesRef.current) p.x -= PIPE_SPEED * dt;
        pipesRef.current = pipesRef.current.filter(p => p.x > -PIPE_W - 20);

        // Score
        for (const p of pipesRef.current) {
          if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) {
            p.scored = true;
            scoreRef.current++;
            setUiScore(scoreRef.current);
            popupsRef.current.push({ x: BIRD_X + 28, y: birdYRef.current - 22, life: 1 });
          }
        }

        // AABB collision (3px forgiveness so near-misses don't feel cheap)
        const F = 3;
        const bL = BIRD_X - BIRD_R + F, bR = BIRD_X + BIRD_R - F;
        const bT = birdYRef.current - BIRD_R + F, bB = birdYRef.current + BIRD_R - F;
        const hitCeiling = birdYRef.current - BIRD_R <= 0;
        const hitGround  = birdYRef.current + BIRD_R >= PLAY_H;
        const hitPipe = pipesRef.current.some(p => {
          if (bR < p.x || bL > p.x + PIPE_W) return false;
          return bT < p.topH || bB > p.topH + PIPE_GAP;
        });

        if (hitCeiling || hitGround || hitPipe) {
          statusRef.current  = "dead";
          flashRef.current   = 0.75;
          birdRotRef.current = 70 * DEG;
          wingRef.current    = 2; // freeze on down-flap
          spawnParticles(BIRD_X, birdYRef.current);
          const finalScore = scoreRef.current;
          setHighScore(prev => Math.max(prev, finalScore));
          setStatus("dead");
          setUiScore(finalScore);
          setNewBest(false);

          // Auto-submit: fire-and-forget; server only saves if it's a new best
          if (finalScore > 0 && !submittingRef.current) {
            submittingRef.current = true;
            submitScore(finalScore).then(result => {
              submittingRef.current = false;
              if (!result.error) {
                if (result.newBest) setNewBest(true);
                if (result.leaderboard) setLeaderboard(result.leaderboard);
              }
            });
          }
        }
      }

      // ── Dead ──────────────────────────────────────────────
      if (s === "dead") {
        // Flash fade
        if (flashRef.current > 0)
          flashRef.current = Math.max(0, flashRef.current - 0.05 * dt);
        // Bird keeps falling until it hits the ground
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

    // Start loop immediately so idle hover animation is visible on load
    rafRef.current = requestAnimationFrame(tickRef.current);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); flap(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Canvas */}
      <div className="relative shrink-0" style={{ width: W, height: H }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={e => { e.preventDefault(); flap(); }}
          className="rounded-xl cursor-pointer select-none block"
          style={{ touchAction: "none" }}
        />

        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/35 pointer-events-none">
            <p className="text-white text-3xl font-bold mb-2 drop-shadow-lg">Flappy Bird</p>
            <p className="text-zinc-300 text-sm">Click or press Space to start</p>
          </div>
        )}

        {status === "dead" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/55 gap-2">
            <p className="text-white text-2xl font-bold">Game Over</p>
            <p className="text-white text-5xl font-mono font-bold mt-1">{uiScore}</p>
            {newBest
              ? <p className="text-yellow-400 text-sm font-semibold">New personal best!</p>
              : highScore > 0 && <p className="text-zinc-500 text-sm">Best: {highScore}</p>
            }
            <button
              onClick={restart}
              className="px-5 py-2 mt-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Play Again
            </button>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="flex-1 min-w-0">
        <h2 className="text-white font-semibold text-lg mb-3">Top Scores</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {leaderboard.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">
              No scores yet — be the first!
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {leaderboard.map((row, i) => (
                  <tr
                    key={row.username + String(i)}
                    className={`border-b border-zinc-800 last:border-0 ${
                      row.username === username ? "bg-indigo-950/30" : ""
                    }`}
                  >
                    <td
                      className={`py-3 pl-4 w-10 font-mono text-xs ${
                        i === 0 ? "text-yellow-400"
                        : i === 1 ? "text-zinc-300"
                        : i === 2 ? "text-amber-700"
                        : "text-zinc-600"
                      }`}
                    >
                      #{i + 1}
                    </td>
                    <td className="py-3 text-zinc-200 font-medium">{row.username}</td>
                    <td className="py-3 pr-4 text-right text-white font-mono font-bold">
                      {row.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-zinc-600 mt-3">Only your personal best is saved.</p>
      </div>
    </div>
  );
}
