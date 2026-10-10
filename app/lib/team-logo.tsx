// The crest a team falls back to before it uploads one: its team number on a
// colour picked from the number. Both come from the digits in `teams.name`
// ("Team 7") — there is no stored colour or number column — so every surface
// that renders a team has to agree on the derivation or the same team shows up
// in two different colours. Leaf module: no server imports, so the season
// displays can render it from the server wrappers and the archive viewer alike.

export const TEAM_GRADIENTS = [
  "from-indigo-600 to-indigo-800", "from-rose-600 to-rose-800",
  "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800",
  "from-cyan-600 to-cyan-800", "from-purple-600 to-purple-800",
  "from-orange-600 to-orange-800", "from-teal-600 to-teal-800",
];

export function teamNumber(name: string): string {
  return name.replace(/\D+/g, "");
}

export function teamGradient(name: string): string {
  const num = parseInt(teamNumber(name));
  return TEAM_GRADIENTS[(num - 1) % TEAM_GRADIENTS.length] ?? TEAM_GRADIENTS[0];
}

// `className` carries the box: size, radius and text size. The default is the
// teams tab's tile, so that page renders byte-identically to before.
export function DefaultLogo({
  name,
  className = "w-12 h-12 rounded-lg text-lg",
}: {
  name: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-gradient-to-br ${teamGradient(name)} flex items-center justify-center text-white font-bold shrink-0 ${className}`}
    >
      {teamNumber(name)}
    </div>
  );
}
