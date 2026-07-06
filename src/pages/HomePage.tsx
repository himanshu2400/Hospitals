import { Activity, ArrowRight, LogIn, Clock, Shield, Radio } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';

export function HomePage() {
  const { session } = useAuth();
  const { navigate } = useRouter();

  return (
    <div className="min-h-screen bg-slate-50">
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

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 -mt-12 pb-10">
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
