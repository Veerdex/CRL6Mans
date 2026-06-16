"use client";

const VIDEO_ID = "7gDosXgDNUM";

// Full-screen YouTube background — fixed, pointer-events disabled so it never
// intercepts clicks. Uses the cover trick: whichever dimension would be
// undersized at 16:9 is stretched to fill the viewport instead.
export function VideoBackground() {
  return (
    <div
      style={{ position: "fixed", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <iframe
        src={`https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&mute=1&loop=1&playlist=${VIDEO_ID}&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3`}
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
  );
}
