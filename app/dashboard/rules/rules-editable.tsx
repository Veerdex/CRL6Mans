"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { updateRulesMarkdown } from "./rules-actions";

type EditCtx = {
  canEdit: boolean;
  editing: boolean;
  draft: string;
  displayMarkdown: string;
  error: string | null;
  pending: boolean;
  setDraft: (value: string) => void;
  startEditing: () => void;
  handleSave: () => void;
  handleCancel: () => void;
};
const RulesEditContext = createContext<EditCtx | null>(null);

export function RulesEditorShell({
  canEdit,
  markdown,
  displayMarkdown,
  children,
}: {
  canEdit: boolean;
  markdown: string;
  displayMarkdown: string;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateRulesMarkdown(draft);
      if (res.error) setError(res.error);
      else setEditing(false);
    });
  };

  const handleCancel = () => {
    setDraft(markdown);
    setError(null);
    setEditing(false);
  };

  return (
    <RulesEditContext.Provider
      value={{
        canEdit,
        editing,
        draft,
        displayMarkdown,
        error,
        pending,
        setDraft,
        startEditing: () => setEditing(true),
        handleSave,
        handleCancel,
      }}
    >
      {children}
    </RulesEditContext.Provider>
  );
}

export function RulesEditButton() {
  const ctx = useContext(RulesEditContext);
  if (!ctx?.canEdit) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      {ctx.error && <p className="text-xs text-red-400 mr-auto">{ctx.error}</p>}
      {ctx.editing ? (
        <>
          <button
            onClick={ctx.handleCancel}
            disabled={ctx.pending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={ctx.handleSave}
            disabled={ctx.pending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {ctx.pending ? "Saving…" : "Save Changes"}
          </button>
        </>
      ) : (
        <button
          onClick={ctx.startEditing}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          Edit Rules
        </button>
      )}
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-white mt-8 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold text-white mt-8 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="font-semibold text-white mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p className="leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside space-y-1 text-zinc-400 mb-3">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 text-zinc-300 mb-3">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="text-white">{children}</strong>,
  code: ({ children }) => <code className="bg-zinc-800 px-1 rounded">{children}</code>,
  hr: () => <hr className="border-zinc-800 my-6" />,
  table: ({ children }) => <table className="w-full text-sm border-collapse mb-3">{children}</table>,
  tr: ({ children }) => <tr className="border-b border-zinc-800">{children}</tr>,
  th: ({ children }) => <th className="py-2 pr-4 text-left font-medium text-zinc-400">{children}</th>,
  td: ({ children }) => <td className="py-2 text-zinc-300">{children}</td>,
  blockquote: ({ children }) => (
    <div className="bg-red-950/40 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300 mb-3 [&>p]:mb-0">
      {children}
    </div>
  ),
};

export function RulesMarkdownBody() {
  const ctx = useContext(RulesEditContext);

  if (ctx?.editing) {
    return (
      <>
        <p className="text-xs text-zinc-500 mb-2">
          Keep the <code className="bg-zinc-800 px-1 rounded">{"{{MMR_NOTE}}"}</code> token in Section 2 —
          it&apos;s replaced with the season&apos;s or tournament&apos;s actual MMR requirement (or a &quot;no minimum&quot; note) when the rules are shown.
        </p>
        <textarea
          value={ctx.draft}
          onChange={(e) => ctx.setDraft(e.target.value)}
          rows={40}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 leading-relaxed font-mono resize-y focus:outline-none focus:border-indigo-500"
        />
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {ctx?.displayMarkdown ?? ""}
    </ReactMarkdown>
  );
}
