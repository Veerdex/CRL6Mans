// Replaces the literal {PROMO} token in a sponsor's promo description with their actual code.
// Kept dependency-free (no supabaseAdmin import) so client components can safely import it.
export function formatPromoDescription(
  description: string | null | undefined,
  code: string | null | undefined
): string | null {
  if (!description || !code) return null;
  return description.replace(/\{PROMO\}/g, code);
}
