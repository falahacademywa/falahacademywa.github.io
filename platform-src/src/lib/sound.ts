// A short two-note chime when a notification arrives while the portal is open (President
// 2026-11-22: "for all: parents, teachers, admin, me"). Drawn with the Web Audio API, so there is
// no sound file to load. Browsers only let a page make sound after the person has touched it, so
// the audio engine is started on the first tap or key press and the chime is silent before that.
// When the portal is closed the phone's own notification sound plays instead (lib/push.ts).
type AC = typeof AudioContext;
let ctx: AudioContext | null = null;

function unlock() {
  try {
    const Ctor: AC | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio on this device: stay silent */ }
}
if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock, { passive: true });
}

export function chime() {
  try {
    if (!ctx || ctx.state !== "running" || document.visibilityState !== "visible") return;
    const t0 = ctx.currentTime;
    for (const [freq, at] of [[880, 0], [1174.66, 0.16]] as const) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.45);
    }
  } catch { /* never let a sound problem break the page */ }
}
