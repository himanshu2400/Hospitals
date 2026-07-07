/**
 * In-page notification fallback for when web push permission is denied
 * or unsupported. Shows a toast and plays a short sound while the tab
 * stays open.
 */

let toastContainer: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
  const el = document.createElement('div');
  el.id = 'queueflow-toasts';
  el.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;max-width:calc(100vw - 2rem);';
  document.body.appendChild(el);
  toastContainer = el;
  return el;
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Two-note ascending chime (C5 → E5) — short and pleasant.
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Audio not available — silent.
  }
}

export function showToast(title: string, body: string, kind: 'info' | 'turn' = 'info') {
  const container = getContainer();
  const toast = document.createElement('div');
  const bg = kind === 'turn' ? '#0ea5e9' : '#1e293b';
  toast.style.cssText = `pointer-events:auto;background:${bg};color:white;padding:0.75rem 1rem;border-radius:0.75rem;box-shadow:0 10px 25px -5px rgba(0,0,0,0.2);font-family:Inter,system-ui,sans-serif;max-width:22rem;animation:toastIn 0.3s ease-out;`;
  toast.innerHTML = `<p style="font-weight:600;font-size:0.875rem;margin:0">${title}</p><p style="font-size:0.8125rem;opacity:0.9;margin:0.25rem 0 0">${body}</p>`;
  container.appendChild(toast);
  playChime();
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(1rem)';
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

/**
 * In-page notification: shows a toast and plays a chime. Used as the
 * fallback when web push is denied/unsupported, and also as an
 * immediate in-tab signal even when push is enabled (so the patient
 * gets instant feedback if they're looking at the page).
 */
export function notifyInPage(title: string, body: string, kind: 'info' | 'turn' = 'info') {
  showToast(title, body, kind);
}
