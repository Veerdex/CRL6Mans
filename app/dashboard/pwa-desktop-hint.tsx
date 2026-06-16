"use client";

import { useEffect, useState } from "react";

export function PwaDesktopHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const isPwa = window.matchMedia("(display-mode: standalone)").matches;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    setShow(isPwa && !isTouch);
  }, []);
  if (!show) return null;
  return (
    <div className="flex justify-center pb-1">
      <p className="text-lg text-yellow-500 text-center whitespace-nowrap">Ctrl+R to refresh</p>
    </div>
  );
}
