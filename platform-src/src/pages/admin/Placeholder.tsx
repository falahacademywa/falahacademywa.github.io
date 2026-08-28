export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-navy">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="text-gray-500">This module is scheduled for {phase} of the implementation plan.</p>
        <p className="mt-1 text-sm text-gray-400">The navigation is in place so the portal structure matches the PRD from day one.</p>
      </div>
    </div>
  );
}
