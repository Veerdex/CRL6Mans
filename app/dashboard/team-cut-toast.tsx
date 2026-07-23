"use client";

import { useEffect, useRef } from "react";

export function TeamCutToast({ message }: { message: string | null }) {
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || !message) return;
    shown.current = true;

    const toast = document.createElement("div");
    toast.style.cssText = [
      "position:fixed", "bottom:80px", "left:50%", "transform:translateX(-50%)",
      "z-index:9999", "background:#1c1c2e", "border:1px solid #ef4444",
      "border-radius:12px", "padding:14px 20px", "color:#fff",
      "font-size:14px", "font-weight:600", "text-align:center",
      "box-shadow:0 8px 32px rgba(0,0,0,0.5)", "max-width:340px", "width:calc(100% - 32px)",
      "transition:opacity 0.4s ease",
    ].join(";");
    toast.innerHTML = message;
    document.body.appendChild(toast);

    const hide = () => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    };
    const timer = setTimeout(hide, 6000);
    toast.addEventListener("click", () => { clearTimeout(timer); hide(); });
  }, [message]);

  return null;
}
