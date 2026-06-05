export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm p-8 space-y-8 bg-zinc-900 rounded-2xl border border-zinc-800">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white tracking-tight">CRL 6Mans</h1>
          <p className="text-zinc-400 text-sm">Competitive Rocket League pickup queue</p>
        </div>

        {error && (
          <p className="text-center text-sm text-red-400">
            {error === "cancelled"
              ? "Login cancelled."
              : "Authentication failed. Please try again."}
          </p>
        )}

        <a
          href="/api/auth/discord"
          className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3c45a5] text-white font-semibold rounded-lg transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
            <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.4a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.6 37.6 0 0 0 25.6.5a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 11 4.9a.2.2 0 0 0-.1.1C1.6 18.7-1 32.2.3 45.5a.2.2 0 0 0 .1.1 58.8 58.8 0 0 0 17.7 8.9.2.2 0 0 0 .3-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0c11.5 5.2 24 5.2 35.3 0a.2.2 0 0 1 .2 0l1.1.8c.1.1.1.3 0 .4a36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3c1 2 2.3 4 3.6 5.9a.2.2 0 0 0 .3.1 58.6 58.6 0 0 0 17.7-8.9.2.2 0 0 0 .1-.1c1.5-15.6-2.5-29-10.6-41a.2.2 0 0 0-.1-.2zM23.7 37.6c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 4-2.8 7.1-6.4 7.1zm23.7 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 4-2.8 7.1-6.4 7.1z" />
          </svg>
          Login with Discord
        </a>

        <p className="text-center text-xs text-zinc-500">
          By logging in, you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
