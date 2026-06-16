import type { MetadataRoute } from "next";
import { APP_NAME } from "@/app/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Competitive Rocket League pickup queue for CRL West",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#3736ac",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
