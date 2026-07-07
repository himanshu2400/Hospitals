import { useState, type FormEvent } from 'react';
import { Activity, ArrowRight, LogIn, Clock, Shield, Radio, QrCode, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import { QrScannerModal } from '../components/QrScannerModal';

export function HomePage() {
  const { session } = useAuth();
  const { navigate } = useRouter();
  const [showScanner, setShowScanner] = useState(false);
  const [pasteLink, setPasteLink] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  function handleScannedUrl(url: string) {
    setShowScanner(false);
    navigateToQueueUrl(url);
  }

  function navigateToQueueUrl(url: string) {
    const match = url.match(/#\/queue\/([^/]+)\/([^/?#]+)/);
    if (match) {
      navigate(`/queue/${decodeURIComponent(match[1])}/${match[2]}`);
    } else {
      setPasteError('That doesn\'t look like a valid queue link.');
    }
  }

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    setPasteError(null);
    const trimmed = pasteLink.trim();
    if (!trimmed) return;
    navigateToQueueUrl(trimmed);
  }

  return (
    <div className="min-h-screen bg-slate-50 page-enter">
      {/* Hero */}
      <header className="brand-gradient text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <Activity className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-lg tracking-tight">QueueFlow</span>
          </div>
          <div className="flex items-center gap-2">
            {session ? (
              <button
                onClick={() => navigate('/dashboard')}
                className="bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-1.5"
              >
                Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-1.5"
              >
                <LogIn className="w-4 h-4" />
                Hospital/clinic sign in
              </button>
            )}
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Real-time hospital queue management
          </h1>
          <p className="mt-4 text-lg text-white/85 max-w-2xl mx-auto">
            Patients see who's being served and their estimated wait — live.
            Staff advance the queue with one tap. No more crowded waiting rooms.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            {session ? (
              <button
                onClick={() => navigate('/dashboard')}
                className="bg-white text-slate-900 rounded-lg px-6 py-3 font-semibold text-sm hover:bg-slate-100 transition flex items-center gap-2"
              >
                Open dashboard <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="bg-white text-slate-900 rounded-lg px-6 py-3 font-semibold text-sm hover:bg-slate-100 transition flex items-center gap-2"
              >
                Sign in <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Patient access: scan QR or paste link */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 -mt-12 pb-10">
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-8">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Find your queue</h2>
          <p className="text-sm text-slate-500 mb-5">
            Scan the QR code at your hospital's reception desk, or paste the link you received via text or WhatsApp.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Scan QR code */}
            <div className="flex-1">
              <button
                onClick={() => setShowScanner(true)}
                className="w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50/50 transition py-8 px-4 text-center"
              >
                <div className="w-12 h-12 rounded-xl brand-bg flex items-center justify-center">
                  <QrCode className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Scan QR code</p>
                  <p className="text-xs text-slate-500 mt-0.5">Open your camera and scan</p>
                </div>
              </button>
            </div>

            {/* Paste link */}
            <div className="flex-1">
              <form onSubmit={handlePasteSubmit} className="h-full flex flex-col justify-center gap-2">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <LinkIcon className="w-4 h-4" />
                  Paste link
                </label>
                <input
                  type="text"
                  value={pasteLink}
                  onChange={(e) => setPasteLink(e.target.value)}
                  placeholder="https://…#/queue/clinic/doctor"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
                />
                {pasteError && (
                  <p className="text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {pasteError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!pasteLink.trim()}
                  className="brand-bg rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  Go to queue
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<Radio className="w-5 h-5" />}
            title="Live updates"
            desc="Token numbers and wait times update instantly — no manual refresh."
          />
          <Feature
            icon={<Clock className="w-5 h-5" />}
            title="Smart wait estimates"
            desc="Calculated from each doctor's last 5 completed consultations."
          />
          <Feature
            icon={<Shield className="w-5 h-5" />}
            title="Department-scoped access"
            desc="Staff only see the departments they're assigned to. Owners see everything."
          />
        </div>
      </section>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        QueueFlow · Real-time queue management
      </footer>

      {showScanner && (
        <QrScannerModal onScan={handleScannedUrl} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5">
      <div className="w-10 h-10 rounded-xl brand-bg flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1">{desc}</p>
    </div>
  );
}
