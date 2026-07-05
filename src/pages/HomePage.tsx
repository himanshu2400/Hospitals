import { useEffect, useState } from 'react';
import { Activity, ArrowRight, LogIn, Stethoscope, Clock, Shield, Radio } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import type { Clinic, Doctor } from '../lib/types';

export function HomePage() {
  const { session } = useAuth();
  const { navigate } = useRouter();
  const [clinics, setClinics] = useState<(Clinic & { doctors: Doctor[] })[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clinics')
        .select('*, doctors(*)')
        .order('name');
      setClinics(data ?? []);
    })();
  }, []);

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
                Staff Sign In
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
                onClick={() => navigate('/signup')}
                className="bg-white text-slate-900 rounded-lg px-6 py-3 font-semibold text-sm hover:bg-slate-100 transition flex items-center gap-2"
              >
                Get started <ArrowRight className="w-4 h-4" />
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
            title="Staff-only controls"
            desc="Only authenticated staff can advance the queue or change branding."
          />
        </div>
      </section>

      {/* Public queue directory */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Stethoscope className="w-5 h-5" />
          Active clinics
        </h2>
        {clinics.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white rounded-xl ring-1 ring-slate-200 p-6 text-center">
            No clinics available yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {clinics.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
                <div className="flex items-center gap-3 mb-3">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                      style={{ backgroundColor: c.primary_color }}
                    >
                      <Activity className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-slate-900">{c.name}</h3>
                    <p className="text-xs text-slate-500">{c.doctors.length} doctors</p>
                  </div>
                </div>
                {c.doctors.length === 0 ? (
                  <p className="text-sm text-slate-400">No doctors listed.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {c.doctors.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => navigate(`/queue/${c.slug}/${d.id}`)}
                          className="w-full text-left flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50 transition group"
                        >
                          <span>
                            <span className="font-medium text-slate-800">{d.name}</span>
                            <span className="text-slate-400"> · {d.specialty}</span>
                          </span>
                          <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
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
