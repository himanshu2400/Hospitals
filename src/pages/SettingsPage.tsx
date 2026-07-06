import { useEffect, useState } from 'react';
import {
  ArrowLeft, Loader2, LogOut, Save, Check, AlertCircle, Activity,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import { useClinicTheme } from '../lib/theme';
import { BrandHeader } from '../components/BrandHeader';

const PRESET_COLORS = [
  '#0ea5e9', '#2563eb', '#0d9488', '#059669', '#65a30d',
  '#d97706', '#dc2626', '#db2777', '#475569',
];

export function SettingsPage() {
  const { session: authSession, loading: authLoading, clinic: authClinic, profileLoading } = useAuth();
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0ea5e9');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !authSession) navigate('/login');
  }, [authLoading, authSession, navigate]);

  // Only clinic owners can access branding settings.
  useEffect(() => {
    if (!authSession || profileLoading) return;
    if (!authClinic || authClinic.owner_id !== authSession.user.id) {
      navigate('/dashboard');
    }
  }, [authSession, authClinic, profileLoading, navigate]);

  useEffect(() => {
    if (authClinic) {
      setName(authClinic.name);
      setSlug(authClinic.slug);
      setLogoUrl(authClinic.logo_url ?? '');
      setPrimaryColor(authClinic.primary_color);
    }
  }, [authClinic]);

  useClinicTheme(authClinic);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!authClinic) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const { error: updateErr } = await supabase
        .from('clinics')
        .update({
          name: name.trim(),
          slug: cleanSlug || authClinic.slug,
          logo_url: logoUrl.trim() || null,
          primary_color: primaryColor,
        })
        .eq('id', authClinic.id);
      if (updateErr) throw updateErr;
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  if (authLoading || !authSession || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!authClinic) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <BrandHeader
        clinic={authClinic}
        subtitle="Branding Settings"
        right={
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        }
      />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </button>

        <form onSubmit={handleSave} className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 sm:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-slate-900">Hospital branding</h2>
          <p className="text-sm text-slate-500 -mt-3">
            These settings apply across the public queue page and staff dashboard.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Display name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
              required
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
                placeholder="my-hospital"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Public queue URLs look like <code className="text-slate-700">/queue/{slug || 'my-hospital'}/&lt;doctor-id&gt;</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Logo URL
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
            />
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo preview"
                className="mt-2 w-14 h-14 rounded-xl object-cover ring-1 ring-slate-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
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
            <div className="brand-gradient px-5 py-4 text-white">
              <p className="text-xs uppercase tracking-wide text-white/80">Live preview</p>
              <p className="text-lg font-bold mt-1">{name || 'Your Hospital Name'}</p>
            </div>
            <div className="p-4 bg-white flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg brand-bg flex items-center justify-center">
                  <Activity className="w-5 h-5" />
                </div>
              )}
              <div className="flex-1">
                <p className="font-semibold text-slate-900 text-sm">Now Serving</p>
                <p className="text-xs text-slate-500">Token updates in real time</p>
              </div>
              <span className="brand-bg text-xs font-semibold px-3 py-1.5 rounded-lg">
                Sample
              </span>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="brand-bg rounded-lg px-5 py-2.5 font-semibold text-sm hover:opacity-90 transition disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </button>
            {saved && (
              <span className="text-sm text-emerald-600 flex items-center gap-1.5 fade-in">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
