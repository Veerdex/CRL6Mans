"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { submitScore } from "./actions";

const W = 380;
const H = 520;
const GROUND_H = 44;
const PLAY_H = H - GROUND_H;
const BIRD_X = 75;
const BIRD_R = 13;
const GRAVITY = 0.48;
const FLAP_V = -8.5;
const PIPE_W = 52;
const PIPE_GAP = 148;
const PIPE_SPEED = 2.4;
const SPAWN_MS = 1550;

type Status = "idle" | "running" | "dead";

interface Pipe {
  x: number;
  topH: number;
  scored: boolean;
}

interface LeaderboardRow {
  username: string;
  score: number;
}

const STARS: [number, number][] = [
  [30, 60], [120, 30], [200, 80], [290, 20],
  [350, 55], [80, 150], [330, 140], [160, 110],
  [60, 200], [310, 90],
];

export default function FlappyBird({
  username,
  initialLeaderboard,
}: {
  username: string;
  initialLeaderboard: LeaderboardRow[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All mutable game state in refs — avoids stale closures in the rAF loop
  const statusRef = useRef<Status>("idle");
  const birdYRef = useRef(PLAY_H / 2);
  const birdVyRef = useRef(0);
  const pipesRef = useRef<Pipe[]>([]);
  const scoreRef = useRef(0);
  const nextPipeRef = useRef(0);
  const prevTRef = useRef(0);
  const rafRef = useRef(0);
  const tickRef = useRef<FrameRequestCallback>(() => {});

  const [status, setStatus] = useState<Status>("idle");
  const [uiScore, setUiScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>(initialLeaderboard);

  function randomTopH() {
    return Math.random() * (PLAY_H - PIPE_GAP - 80) + 40;
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    // Sky
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, PLAY_H);

    // Stars
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (const [sx, sy] of STARS) ctx.fillRect(sx, sy, 1.5, 1.5);

    // Pipes
    for (const p of pipesRef.current) {
      const botY = p.topH + PIPE_GAP;
      // Top pipe body
      ctx.fillStyle = "#1e3a5f";
      ctx.fillRect(p.x, 0, PIPE_W, p.topH);
      // Top pipe cap
      ctx.fillStyle = "#2d5a8e";
      ctx.fillRect(p.x - 4, p.topH - 14, PIPE_W + 8, 14);
      // Bottom pipe cap
      ctx.fillRect(p.x - 4, botY, PIPE_W + 8, 14);
      // Bottom pipe body
      ctx.fillStyle = "#1e3a5f";
      ctx.fillRect(p.x, botY + 14, PIPE_W, PLAY_H - botY - 14);
    }

    // Ground
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, PLAY_H, W, GROUND_H);
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, PLAY_H, W, 2);

    // Bird
    const by = birdYRef.current;
    ctx.beginPath();
    ctx.arc(BIRD_X, by, BIRD_R, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    // Wing
    ctx.beginPath();
    ctx.ellipse(BIRD_X - 3, by + 4, 7, 4, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b";
    ctx.fill();
    // Eye white
    ctx.beginPath();
    ctx.arc(BIRD_X + 5, by - 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    // Pupil
    ctx.beginPath();
    ctx.arc(BIRD_X + 6, by - 4, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();

    // Score while playing
    if (statusRef.current === "running") {
      ctx.textAlign = "center";
      ctx.font = "bold 34px monospace";
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillText(String(scoreRef.current), W / 2 + 1, 51);
      ctx.fillStyle = "white";
      ctx.fillText(String(scoreRef.current), W / 2, 50);
    }
  }, []);

  // Register the rAF tick — runs once since draw is stable ([] deps)
  useEffect(() => {
    tickRef.current = (t: DOMHighResTimeStamp) => {
      if (statusRef.current !== "running") return;

      const dt = prevTRef.current
        ? Math.min((t - prevTRef.current) / (1000 / 60), 3)
        : 1;
      prevTRef.current = t;

      // Physics
      birdVyRef.current += GRAVITY * dt;
      birdYRef.current += birdVyRef.current * dt;

      // Spawn pipes
      if (t >= nextPipeRef.current) {
        pipesRef.current.push({ x: W + 10, topH: randomTopH(), scored: false });
        nextPipeRef.current = t + SPAWN_MS;
      }

      // Move & cull off-screen pipes
      for (const p of pipesRef.current) p.x -= PIPE_SPEED * dt;
      pipesRef.current = pipesRef.current.filter(p => p.x > -PIPE_W - 20);

      // Scoring
      for (const p of pipesRef.current) {
        if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.scored = true;
          scoreRef.current++;
          setUiScore(scoreRef.current);
        }
      }

      // Collision — slight pixel forgiveness so near-misses don't feel unfair
      const hitGround = birdYRef.current + BIRD_R >= PLAY_H;
      const hitCeiling = birdYRef.current - BIRD_R <= 0;
      const hitPipe = pipesRef.current.some(
        p =>
          BIRD_X + BIRD_R - 3 > p.x &&
          BIRD_X - BIRD_R + 3 < p.x + PIPE_W &&
          (birdYRef.current - BIRD_R + 3 < p.topH ||
            birdYRef.current + BIRD_R - 3 > p.topH + PIPE_GAP)
      );

      if (hitGround || hitCeiling || hitPipe) {
        statusRef.current = "dead";
        setHighScore(prev => Math.max(prev, scoreRef.current));
        setStatus("dead");
        setUiScore(scoreRef.current);
        draw();
        return;
      }

      draw();
      rafRef.current = requestAnimationFrame(tickRef.current);
    };
  }, [draw]);

  const flap = useCallback(() => {
    if (statusRef.current === "idle") {
      statusRef.current = "running";
      birdVyRef.current = FLAP_V;
      nextPipeRef.current = performance.now() + SPAWN_MS;
      prevTRef.current = 0;
      scoreRef.current = 0;
      setStatus("running");
      setUiScore(0);
      setSubmitted(false);
      rafRef.current = requestAnimationFrame(tickRef.current);
    } else if (statusRef.current === "running") {
      birdVyRef.current = FLAP_V;
    }
  }, []);

  const restart = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    statusRef.current = "idle";
    birdYRef.current = PLAY_H / 2;
    birdVyRef.current = 0;
    pipesRef.current = [];
    scoreRef.current = 0;
    prevTRef.current = 0;
    setStatus("idle");
    setUiScore(0);
    setSubmitted(false);
    draw();
  }, [draw]);

  const handleSubmit = useCallback(async () => {
    const result = await submitScore(scoreRef.current);
    if (!result.error) {
      setSubmitted(true);
      if (result.leaderboard) setLeaderboard(result.leaderboard);
    }
  }, []);

  useEffect(() => {
    draw();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, flap]);

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Game canvas */}
      <div className="relative shrink-0" style={{ width: W, height: H }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onClick={flap}
          onTouchStart={e => { e.preventDefault(); flap(); }}
          className="rounded-xl cursor-pointer select-none block"
          style={{ touchAction: "none" }}
        />

        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/40 pointer-events-none">
            <p className="text-white text-3xl font-bold mb-2">Flappy Bird</p>
            <p className="text-zinc-300 text-sm">Click or press Space to start</p>
          </div>
        )}

        {status === "dead" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/60 gap-2">
            <p className="text-white text-2xl font-bold">Game Over</p>
            <p className="text-white text-5xl font-mono font-bold mt-1">{uiScore}</p>
            {highScore > 0 && (
              <p className="text-zinc-400 text-sm">Best: {highScore}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={restart}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Play Again
              </button>
              {uiScore > 0 && !submitted && (
                <button
                  onClick={handleSubmit}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Submit Score
                </button>
              )}
              {submitted && (
                <p className="text-emerald-400 text-sm self-center">Submitted!</p>
              )}
            </div>
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
                        i === 0
                          ? "text-yellow-400"
                          : i === 1
                          ? "text-zinc-300"
                          : i === 2
                          ? "text-amber-700"
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
