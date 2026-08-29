import { APP_NAME } from "@/app/lib/constants";
import { HelpFaq } from "./help-faq";

export default function HelpPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-1">Help</h1>
      <p className="text-zinc-400 text-sm mb-8">
        Answers to common questions about {APP_NAME}. Click a question to expand it.
      </p>

      <HelpFaq />

      <div className="mt-8 pt-6 border-t border-zinc-800 text-sm text-zinc-400">
        <p>
          Still stuck? Reach out to league staff in Discord — they can help with anything not
          covered here.
        </p>
      </div>
    </div>
  );
}
