import { useState, type FormEvent } from 'react';
import { Activity, Loader2, AlertCircle, Building2, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
const PRESET_COLORS = [
  '#0ea5e9', '#2563eb', '#0d9488', '#059669', '#65a30d',
  '#d97706', '#dc2626', '#db2777', '#475569',
];

type Props = {
  onCreated: (clinic: Clinic) => void;
  onSignOut?: () => void;
};
export function CreateClinicForm({ onCreated, onSignOut }: Props) {
  const { reloadProfile } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0ea5e9');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function deriveSlug(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanName = name.trim();
    const cleanSlug = deriveSlug(slug) || deriveSlug(cleanName);
    if (!cleanName || !cleanSlug) return;
    setLoading(true);
    try {
      const { data, error: insertErr } = await supabase
        .from('clinics')
        .insert({
          name: cleanName,
          slug: cleanSlug,
          primary_color: primaryColor,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      onCreated(data as Clinic);
      reloadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hospital');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          <div className="brand-gradient px-7 py-8 text-white">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-4">
              <Building2 className="w-6 h-6" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Create your hospital</h1>
            <p className="text-white/80 text-sm mt-1">
              Set up your hospital to start managing departments and queues.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-7 py-7 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Hospital name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || deriveSlug(slug) === deriveSlug(name)) {
                    setSlug(deriveSlug(e.target.value));
                  }
                }}
                placeholder="City General Hospital"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                URL slug
              </label>
              <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-sky-500/40 focus-within:border-sky-500">
                <span className="pl-3 pr-1 text-sm text-slate-400 bg-slate-50 py-2.5">/queue/</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="flex-1 px-2 py-2.5 text-sm focus:outline-none"
                  placeholder="city-general"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Used in public queue links.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Primary color
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-12 h-12 rounded-lg cursor-pointer border border-slate-300"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPrimaryColor(c)}
                      className="w-7 h-7 rounded-full ring-2 ring-offset-2 transition hover:scale-110"
                      style={{
                        backgroundColor: c,
                        '--tw-ring-color': c === primaryColor ? c : 'transparent',
                      } as React.CSSProperties}
                      aria-label={`Select ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div className="rounded-xl overflow-hidden ring-1 ring-slate-200">
              <div
                className="px-5 py-4 text-white"
                style={{ backgroundColor: primaryColor }}
              >
                <p className="text-xs uppercase tracking-wide text-white/80">Live preview</p>
                <p className="text-lg font-bold mt-1">{name || 'Your Hospital Name'}</p>
              </div>
              <div className="p-4 bg-white flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Activity className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 text-sm">Now Serving</p>
                  <p className="text-xs text-slate-500">Token updates in real time</p>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full brand-bg rounded-lg py-2.5 font-semibold text-sm shadow-sm hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
              Create hospital
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
