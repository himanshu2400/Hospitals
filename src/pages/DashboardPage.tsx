import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Loader2, LogOut, Settings, UserRound, Clock, CheckCircle2,
  PhoneCall, Users, Calendar, AlertCircle, Link as LinkIcon, Check, Plus, UserPlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import type { Clinic, Doctor, QueueSession, Token } from '../lib/types';
import { useClinicTheme } from '../lib/theme';
import { averageConsultDurationMinutes, formatWaitTime } from '../lib/waitTime';
import { checkInPatient } from '../lib/checkIn';
import { BrandHeader } from '../components/BrandHeader';

type DoctorRow = Doctor & { session: QueueSession | null; tokens: Token[]; clinic: Clinic };

export function DashboardPage() {
  const { session: authSession, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [rows, setRows] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Hard auth gate: while auth is resolving, render nothing. Once resolved,
  // if there's no session, redirect to login. The dashboard never renders
  // for an unauthenticated user — not even a flash of the UI.
  useEffect(() => {
    if (!authLoading && !authSession) {
      navigate('/login');
    }
  }, [authLoading, authSession, navigate]);

  // Load all clinics + doctors + today's sessions + tokens.
  useEffect(() => {
    if (!authSession) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const uid = authSession!.user.id;
      const { data: clinicList, error: clinicErr } = await supabase
        .from('clinics')
        .select('*')
        .or(`owner_id.eq.${uid},owner_id.is.null`)
        .order('name');
      if (clinicErr) { if (!cancelled) setError(clinicErr.message); return; }
      if (cancelled) return;
      setClinics(clinicList ?? []);

      const ownedClinicIds = (clinicList ?? []).map((c) => c.id);
      if (ownedClinicIds.length === 0) {
        if (!cancelled) { setRows([]); setLoading(false); }
        return;
      }

      const { data: doctorList, error: doctorErr } = await supabase
        .from('doctors')
        .select('*')
        .in('clinic_id', ownedClinicIds)
        .order('name');
      if (doctorErr) { if (!cancelled) setError(doctorErr.message); return; }
      if (cancelled) return;

      const today = new Date().toISOString().slice(0, 10);
      const { data: sessionList } = await supabase
        .from('queue_sessions')
        .select('*')
        .in('doctor_id', doctorList.map((d) => d.id))
        .eq('session_date', today);

      const sessionByDoctor = new Map<string, QueueSession>();
      (sessionList ?? []).forEach((s) => sessionByDoctor.set(s.doctor_id, s));

      const sessionIds = (sessionList ?? []).map((s) => s.id);
      let tokenList: Token[] = [];
      if (sessionIds.length > 0) {
        const { data: tokens } = await supabase
          .from('tokens')
          .select('*')
          .in('queue_session_id', sessionIds)
          .order('token_number', { ascending: true });
        tokenList = tokens ?? [];
      }

      const clinicById = new Map((clinicList ?? []).map((c) => [c.id, c]));
      const tokensBySession = new Map<string, Token[]>();
      for (const t of tokenList) {
        const arr = tokensBySession.get(t.queue_session_id) ?? [];
        arr.push(t);
        tokensBySession.set(t.queue_session_id, arr);
      }

      const built: DoctorRow[] = (doctorList ?? []).map((d) => ({
        ...d,
        session: sessionByDoctor.get(d.id) ?? null,
        tokens: tokensBySession.get(sessionByDoctor.get(d.id)?.id ?? '') ?? [],
        clinic: clinicById.get(d.clinic_id)!,
      }));

      if (!cancelled) {
        setRows(built);
        setLoading(false);
      }
    }

    load();

    // Realtime subscriptions
    const channel = supabase
      .channel('dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queue_sessions' },
        () => { if (!cancelled) load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tokens' },
        () => { if (!cancelled) load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clinics' },
        () => { if (!cancelled) load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'doctors' },
        () => { if (!cancelled) load(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [authSession]);

  const activeClinic = clinics[0] ?? null;
  useClinicTheme(activeClinic);

  const groupedByClinic = useMemo(() => {
    const map = new Map<string, { clinic: Clinic; doctors: DoctorRow[] }>();
    for (const r of rows) {
      if (!r.clinic) continue;
      const entry = map.get(r.clinic.id) ?? { clinic: r.clinic, doctors: [] };
      entry.doctors.push(r);
      map.set(r.clinic.id, entry);
    }
    return Array.from(map.values());
  }, [rows]);

  async function handleCallNext(doctor: DoctorRow) {
    if (!doctor.session || busyDoctorId) return;
    setBusyDoctorId(doctor.id);
    const now = new Date().toISOString();
    const sessionId = doctor.session.id;
    const currentToken = doctor.session.current_token;

    try {
      // 1. End the current consultation (the token == current_token), if any.
      if (currentToken > 0) {
        const { error: endErr } = await supabase
          .from('tokens')
          .update({
            status: 'completed',
            consult_ended_at: now,
          })
          .eq('queue_session_id', sessionId)
          .eq('token_number', currentToken)
          .eq('status', 'in_consult');
        if (endErr) throw endErr;
      }

      // 2. Find the next waiting token (smallest token_number > current_token).
      const next = doctor.tokens
        .filter((t) => t.status === 'waiting' && t.token_number > currentToken)
        .sort((a, b) => a.token_number - b.token_number)[0];

      if (!next) {
        // No more patients — just advance the token and mark session waiting.
        const { error: sessErr } = await supabase
          .from('queue_sessions')
          .update({ current_token: currentToken + 1, status: 'waiting' })
          .eq('id', sessionId);
        if (sessErr) throw sessErr;
        return;
      }

      // 3. Start the next patient's consultation.
      const { error: startErr } = await supabase
        .from('tokens')
        .update({
          status: 'in_consult',
          consult_started_at: now,
        })
        .eq('id', next.id);

      // 4. Advance the session's current_token to the next patient's number.
      const { error: sessErr } = await supabase
        .from('queue_sessions')
        .update({ current_token: next.token_number, status: 'active' })
        .eq('id', sessionId);

      if (startErr) throw startErr;
      if (sessErr) throw sessErr;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to call next patient';
      setError(msg);
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  async function handleStartSession(doctor: DoctorRow) {
    if (doctor.session || busyDoctorId) return;
    setBusyDoctorId(doctor.id);
    try {
      const { error: insErr } = await supabase
        .from('queue_sessions')
        .insert({
          doctor_id: doctor.id,
          session_date: new Date().toISOString().slice(0, 10),
          current_token: 0,
          status: 'waiting',
        });
      if (insErr) throw insErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleAddPatient(doctor: DoctorRow, name: string) {
    if (!doctor.session) {
      setError('Start today\'s session before adding patients.');
      throw new Error('No active session');
    }
    await checkInPatient(doctor.session.id, name);
    // Realtime subscription will refresh the token list.
  }

  async function handleClaimClinic(clinic: Clinic) {
    setError(null);
    const { error: updErr } = await supabase
      .from('clinics')
      .update({ owner_id: authSession!.user.id })
      .eq('id', clinic.id)
      .is('owner_id', 'null');
    if (updErr) {
      setError(updErr.message);
    }
    // Realtime will trigger a reload.
  }

  function copyQueueLink(row: DoctorRow) {
    const url = `${window.location.origin}${window.location.pathname}#/queue/${row.clinic.slug}/${row.id}`;
    navigator.clipboard?.writeText(url);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  // While auth is loading OR there's no session, render a loading screen only.
  // The dashboard UI is never mounted for an unauthenticated user.
  if (authLoading || !authSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <BrandHeader
        clinic={activeClinic}
        subtitle="Staff Dashboard"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Branding</span>
            </button>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        }
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Today's Queue</h1>
            <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Users className="w-4 h-4" />
            {rows.length} {rows.length === 1 ? 'doctor' : 'doctors'}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : groupedByClinic.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
            <Activity className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="font-semibold text-slate-900">No clinics yet</h2>
            <p className="text-sm text-slate-500 mt-1">
              Set up your clinic branding to get started.
            </p>
            <button
              onClick={() => navigate('/settings')}
              className="mt-4 brand-bg rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
            >
              Configure clinic
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedByClinic.map(({ clinic, doctors }) => (
              <div key={clinic.id}>
                <div className="flex items-center gap-2 mb-3">
                  {clinic.logo_url ? (
                    <img src={clinic.logo_url} alt="" className="w-6 h-6 rounded-md object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-md brand-bg flex items-center justify-center">
                      <Activity className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <h2 className="font-semibold text-slate-900">{clinic.name}</h2>
                  {clinic.owner_id === null && (
                    <button
                      onClick={() => handleClaimClinic(clinic)}
                      className="text-xs font-semibold brand-text border border-current rounded-full px-2.5 py-0.5 hover:bg-sky-50 transition"
                    >
                      Claim this clinic
                    </button>
                  )}
                </div>
                {clinic.owner_id === null && (
                  <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    This demo clinic has no owner yet. Claim it to manage its queue.
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {doctors.map((row) => (
                    <DoctorCard
                      key={row.id}
                      row={row}
                      busy={busyDoctorId === row.id}
                      canManage={clinic.owner_id === authSession!.user.id}
                      onCallNext={() => handleCallNext(row)}
                      onStartSession={() => handleStartSession(row)}
                      onAddPatient={(name) => handleAddPatient(row, name)}
                      onCopyLink={() => copyQueueLink(row)}
                      copied={copiedId === row.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function DoctorCard({
  row, busy, canManage, onCallNext, onStartSession, onAddPatient, onCopyLink, copied,
}: {
  row: DoctorRow;
  busy: boolean;
  canManage: boolean;
  onCallNext: () => void;
  onStartSession: () => void;
  onAddPatient: (name: string) => Promise<void>;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const session = row.session;
  const currentToken = session?.current_token ?? 0;
  const inConsult = row.tokens.find((t) => t.status === 'in_consult');
  const waiting = row.tokens.filter((t) => t.status === 'waiting' && t.token_number > currentToken);
  const completed = row.tokens.filter((t) => t.status === 'completed');
  const avg = averageConsultDurationMinutes(row.tokens);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAddPatient(addName);
      setAddName('');
      setShowAdd(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add patient');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl brand-bg flex items-center justify-center shrink-0">
              <UserRound className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate">{row.name}</h3>
              <p className="text-sm text-slate-500 truncate">{row.specialty}</p>
            </div>
          </div>
          <button
            onClick={onCopyLink}
            title="Copy public queue link"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition shrink-0"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <LinkIcon className="w-4 h-4" />}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Now serving" value={currentToken || '—'} />
          <Stat label="Waiting" value={waiting.length} />
          <Stat label="Done" value={completed.length} />
        </div>

        {inConsult && (
          <div className="mt-3 flex items-center gap-2 text-sm bg-sky-50 text-sky-900 rounded-lg px-3 py-2">
            <UserRound className="w-4 h-4" />
            <span>In consult: <span className="font-medium">{inConsult.patient_name}</span></span>
          </div>
        )}

        {avg != null && (
          <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Avg consult: {avg.toFixed(1)} min · Est. next wait: {formatWaitTime(Math.round(avg))}
          </p>
        )}

        {!session && (
          <div className="mt-3">
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4" />
              No queue session started today.
            </p>
            {canManage && (
              <button
                onClick={onStartSession}
                disabled={busy}
                className="w-full text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg py-2 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Start today's session
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        {session && canManage && (
          <>
            <button
              onClick={onCallNext}
              disabled={busy || waiting.length === 0}
              className="w-full brand-bg rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : waiting.length === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Queue complete
                </>
              ) : (
                <>
                  <PhoneCall className="w-4 h-4" />
                  Call next patient
                </>
              )}
            </button>

            {showAdd ? (
              <form onSubmit={handleAdd} className="mt-2 fade-in">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Patient name"
                    autoFocus
                    maxLength={100}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={adding || !addName.trim()}
                    className="brand-bg rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAdd(false); setAddName(''); setAddError(null); }}
                    className="text-sm text-slate-500 hover:text-slate-700 px-2 py-2 rounded-lg hover:bg-slate-100 transition"
                  >
                    Cancel
                  </button>
                </div>
                {addError && (
                  <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {addError}
                  </p>
                )}
              </form>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                disabled={busy}
                className="w-full mt-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg py-2 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <UserPlus className="w-4 h-4" />
                Add walk-in patient
              </button>
            )}
          </>
        )}
        {session && !canManage && (
          <div className="w-full rounded-xl py-3 text-sm text-center text-slate-500 bg-slate-100">
            Claim the clinic to manage this queue
          </div>
        )}
        {!session && canManage && (
          <p className="text-center text-xs text-slate-500">
            Start a session to begin calling patients
          </p>
        )}
        {waiting.length > 0 && session && (
          <p className="text-center text-xs text-slate-500 mt-2">
            Next: Token #{waiting[0].token_number} · {waiting[0].patient_name}
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-lg py-2.5">
      <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
