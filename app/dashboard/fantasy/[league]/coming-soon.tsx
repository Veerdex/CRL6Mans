export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto bg-zinc-800 border border-zinc-700 rounded-xl p-6 text-center space-y-1">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <p className="text-sm text-zinc-400">{children}</p>
    </div>
  );
}
