import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { getNotificationFeed, NOTIFICATION_TTL_DAYS } from "@/app/lib/notifications";
import { LocalTime } from "@/app/dashboard/local-time";
import { MarkReadOnView } from "./mark-read-on-view";

const AUDIENCE_LABEL: Record<string, string> = {
  admins: "Staff",
  draft: "Draft",
  team: "Your team",
};

export default async function NotificationsPage() {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");

  const feed = await getNotificationFeed(session.userId);

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-1">Notifications</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Everything the league has sent you in the last {NOTIFICATION_TTL_DAYS} days.
      </p>

      {/* Marks read after the feed above has been rendered, so the unread styling
          is still visible on the render that clears it. */}
      <MarkReadOnView hasUnread={feed.some((n) => n.unread)} />

      {feed.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">No notifications yet.</p>
          <p className="text-sm text-zinc-600 mt-1">
            Draft picks, match check-ins and season updates will show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {feed.map((n) => {
            const label = AUDIENCE_LABEL[n.audience];
            const body = (
              <>
                <div className="flex items-start gap-2">
                  {n.unread && (
                    <span
                      aria-label="Unread"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-semibold ${n.unread ? "text-white" : "text-zinc-300"}`}>
                        {n.title}
                      </span>
                      {label && (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          {label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-400">{n.body}</p>
                    <LocalTime iso={n.createdAt} className="mt-1 block text-xs text-zinc-600" />
                  </div>
                </div>
              </>
            );

            return (
              <li
                key={n.id}
                className={`rounded-xl border p-4 ${
                  n.unread ? "border-zinc-700 bg-zinc-900" : "border-zinc-800 bg-zinc-900/50"
                }`}
              >
                {n.url ? (
                  <Link href={n.url} className="block hover:opacity-80">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
