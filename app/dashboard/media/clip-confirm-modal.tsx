"use client";

export function ClipConfirmModal({
  open,
  title,
  description,
  onConfirm,
  onClose,
  isPending,
}: {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="text-sm text-zinc-400">{description}</p>
        <div className="flex flex-col gap-2 mt-1">
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {isPending ? "Removing…" : "Yes, remove it"}
          </button>
          <button
            onClick={onClose}
            disabled={isPending}
            className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
