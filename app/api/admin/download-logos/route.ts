import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import JSZip from "jszip";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg":  ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
  "image/gif":  ".gif",
  "image/svg+xml": ".svg",
};

function extFromUrl(url: string): string {
  const clean = url.split("?")[0];
  const match = clean.match(/\.([a-z]{2,4})$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}

export async function GET() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("name, logo_url")
    .not("logo_url", "is", null)
    .order("name");

  if (!teams?.length) {
    return new Response("No team logos found.", { status: 404 });
  }

  const zip = new JSZip();
  const folder = zip.folder("team-logos")!;

  await Promise.all(
    teams.map(async (team) => {
      if (!team.logo_url) return;
      try {
        const res = await fetch(team.logo_url, { cache: "no-store" });
        if (!res.ok) return;

        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        const ext = EXT_BY_CONTENT_TYPE[contentType] ?? extFromUrl(team.logo_url);
        const safeName = team.name.replace(/[^a-z0-9\-]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

        folder.file(`${safeName}${ext}`, await res.arrayBuffer());
      } catch { /* skip logos that fail to fetch */ }
    }),
  );

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

  return new Response(zipBuffer, {
    headers: {
      "Content-Type":        "application/zip",
      "Content-Disposition": `attachment; filename="team-logos.zip"`,
    },
  });
}
