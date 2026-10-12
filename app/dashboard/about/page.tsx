import { APP_NAME } from "@/app/lib/constants";

export default function AboutPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-4">About {APP_NAME}</h1>
      <p className="text-zinc-400 leading-relaxed">
        {APP_NAME} runs drafted Rocket League seasons for college players. Registered
        players enter the draft pool, are placed on a team, and compete through a full
        tournament season of scheduled matches, standings and playoffs.
      </p>
      <p className="mt-4 text-sm text-zinc-500 leading-relaxed">
        Not affiliated with or endorsed by Psyonix or the official Collegiate Rocket League.
      </p>
    </div>
  );
}
