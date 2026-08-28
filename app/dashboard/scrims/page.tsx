import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

export default function ScrimsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Scrims</h1>
        <SponsoredByLine tabKey="scrims" />
      </div>
    </div>
  );
}
