// "← Back" that returns to the screen you actually came from (President 2026-11-22): Dashboard →
// Missing documents → a student → Back lands on Missing documents again, not on the plain list.
// Opened directly (a notification, a bookmark, a new tab) there is no previous screen, so it falls
// back to the section list it names.
import { Link, useNavigate } from "react-router-dom";

export default function BackLink({ to, label, className = "text-sm text-royal hover:underline", arrow = "←" }:
  { to: string; label: string; className?: string; arrow?: string }) {
  const nav = useNavigate();
  // react-router numbers the entries it created in this tab; idx > 0 means there is one to go back to
  const hasPrevious = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <Link to={to} className={className}
      onClick={(e) => { if (hasPrevious && !e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(-1); } }}>
      {arrow} {hasPrevious ? "Back" : label}
    </Link>
  );
}
