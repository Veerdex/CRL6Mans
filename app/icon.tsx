import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  const logoData = readFileSync(join(process.cwd(), "public", "crl-logo.png"));
  const logoSrc = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        background: "#3736ac",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "24px",
        padding: "24px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>,
    { ...size }
  );
}
