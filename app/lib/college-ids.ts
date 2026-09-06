import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";

export const COLLEGE_ID_BUCKET = "college-ids";

// The stored value is a full public URL (.../object/public/college-ids/<name>),
// so the object name has to be recovered from it. Splitting on the bucket
// segment rather than "/" keeps a name containing a slash intact, and the
// query string has to go because a signed URL would carry a token.
export function collegeIdObjectName(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/${COLLEGE_ID_BUCKET}/`;
  const at = url.lastIndexOf(marker);
  if (at === -1) return null;
  const name = url.slice(at + marker.length).split("?")[0];
  return name ? decodeURIComponent(name) : null;
}

// Enrollment proof exists only to get a registration reviewed, so it is deleted
// once the decision lands. The decision is already committed by the time this
// runs — a failure here strands one file, which is a cleanup problem, not a
// reason to tell the admin their approval failed.
export async function deleteCollegeIdImage(url: string | null | undefined): Promise<void> {
  const name = collegeIdObjectName(url);
  if (!name) return;
  const { error } = await supabaseAdmin.storage.from(COLLEGE_ID_BUCKET).remove([name]);
  if (error) console.error("college-ids delete error:", error.message);
}
