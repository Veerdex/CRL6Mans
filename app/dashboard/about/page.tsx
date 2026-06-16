import { APP_NAME } from "@/app/lib/constants";

export default function AboutPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-4">About {APP_NAME}</h1>
      <p className="text-zinc-400 leading-relaxed">
        {APP_NAME} is a competitive Rocket League pickup queue for college players.
        Registered players are drafted into teams each season and compete in scrimmages
        to build skills and rank up.
      </p>
    </div>
  );
}
