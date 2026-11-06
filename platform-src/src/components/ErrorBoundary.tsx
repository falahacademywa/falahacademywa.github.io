// Safety net (2026-11-05): if a page crashes while rendering, show a short message with a Reload
// button instead of a blank screen. The error goes to the browser console for diagnosis.
// App.tsx passes the route as resetKey, so moving to another page clears the message.
import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[portal] page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-silver p-6">
        <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow-sm">
          <img src="../images/logo.jpg" alt="" className="mx-auto mb-3 h-12 w-12 rounded-full object-cover" />
          <h1 className="font-display text-lg font-semibold text-navy">This page did not load</h1>
          <p className="mt-2 text-sm text-gray-600">Please tap Reload. If it happens again, tell the office what you were doing.</p>
          <p className="mt-2 break-words text-[11px] text-gray-400">{this.state.error.message}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">Reload</button>
        </div>
      </div>
    );
  }
}
