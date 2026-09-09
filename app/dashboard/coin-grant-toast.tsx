"use client";

import { useEffect, useRef } from "react";

const SLIDE_MS = 450;
const DWELL_MS = 3000;

export function CoinGrantToast({
  startAmount,
  weeklyAmount,
  registerAmount,
}: {
  startAmount: number;
  weeklyAmount: number;
  registerAmount: number;
}) {
  const total = startAmount + weeklyAmount + registerAmount;
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || total <= 0) return;
    shown.current = true;

    const lines: string[] = [];
    if (registerAmount > 0) lines.push(`✅ Registration bonus: +${registerAmount.toLocaleString()} Westside Wages`);
    if (startAmount > 0) lines.push(`🎉 Season start bonus: +${startAmount.toLocaleString()} Westside Wages`);
    if (weeklyAmount > 0) lines.push(`📅 Weekly grant: +${weeklyAmount.toLocaleString()} Westside Wages`);

    const toast = document.createElement("div");
    toast.style.cssText = [
      "position:fixed", "bottom:80px", "left:50%",
      "z-index:9999", "background:#1c1c2e", "border:1px solid #f59e0b",
      "border-radius:12px", "padding:14px 20px", "color:#fff",
      "font-size:14px", "font-weight:600", "text-align:center",
      "box-shadow:0 8px 32px rgba(0,0,0,0.5)", "max-width:340px", "width:calc(100% - 32px)",
      // Starts below the viewport edge and slides up into place; the same
      // transition runs in reverse on the way out.
      "transform:translate(-50%, calc(100% + 80px))", "opacity:0",
      `transition:transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${SLIDE_MS}ms ease`,
    ].join(";");
    toast.innerHTML = lines.join("<br/>");
    document.body.appendChild(toast);

    // Two frames, not one: the first commits the off-screen start state, the
    // second changes it — a single frame can get coalesced and skip the animation.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        toast.style.transform = "translate(-50%, 0)";
        toast.style.opacity = "1";
      });
    });

    const hide = () => {
      toast.style.transform = "translate(-50%, calc(100% + 80px))";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), SLIDE_MS);
    };
    const timer = setTimeout(hide, SLIDE_MS + DWELL_MS);
    toast.addEventListener("click", () => { clearTimeout(timer); hide(); });

    return () => { cancelAnimationFrame(raf); };
  }, [total, startAmount, weeklyAmount, registerAmount]);

  return null;
}
