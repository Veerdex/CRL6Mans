import { getPatreonUrl } from "@/app/lib/patreon-public";
import { APP_NAME } from "@/app/lib/constants";

const REASONS = [
  "Tournament prize pools that make competing worth it",
  "Server hosting, bot infrastructure, and site costs",
  "Equipment and tools that keep matches running smoothly",
];

export default async function SupportPage() {
  const patreonUrl = await getPatreonUrl();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-10 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Support {APP_NAME}</h1>
          <p className="text-zinc-400">
            {`${APP_NAME} is run by the community, for the community. If you'd like to help keep it going, you can become a Patron — every tier helps.`}
          </p>
        </div>

        <ul className="text-left space-y-3 mx-auto max-w-md">
          {REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-zinc-300">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-indigo-400">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{reason}</span>
            </li>
          ))}
        </ul>

        {patreonUrl ? (
          <a
            href={patreonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Become a Patron
          </a>
        ) : (
          <p className="text-sm text-zinc-500">Patron sign-ups are coming soon — check back shortly.</p>
        )}
      </div>
    </div>
  );
}
