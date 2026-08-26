import { supabaseAdmin } from "@/app/lib/supabase";
import { RulesEditorShell, RulesEditButton, RulesMarkdownBody } from "./rules-editable";
import { DEFAULT_RULES_MARKDOWN } from "./rules-default";
import { filterRulesMarkdown, type RulesContext } from "./rules-filter";

export async function getRulesMarkdown(): Promise<string> {
  const { data } = await supabaseAdmin.from("league_settings").select("rules_markdown").single();
  return (data?.rules_markdown as string | null) ?? DEFAULT_RULES_MARKDOWN;
}

export async function getSeasonMinMmr(): Promise<{ minMmr2v2: number | null; minMmr3v3: number | null }> {
  const { data } = await supabaseAdmin.from("league_settings").select("min_mmr_2v2, min_mmr_3v3").single();
  return {
    minMmr2v2: (data?.min_mmr_2v2 as number | null) ?? null,
    minMmr3v3: (data?.min_mmr_3v3 as number | null) ?? null,
  };
}

export async function RulesContent({
  canEdit,
  context,
}: {
  canEdit: boolean;
  context: RulesContext;
}) {
  const markdown = await getRulesMarkdown();
  const displayMarkdown = filterRulesMarkdown(markdown, context);
  return (
    <RulesEditorShell key={markdown} canEdit={canEdit} markdown={markdown} displayMarkdown={displayMarkdown}>
      <RulesEditButton />
      <RulesMarkdownBody />
    </RulesEditorShell>
  );
}
