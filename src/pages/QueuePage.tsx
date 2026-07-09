import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Clock, Hash, Search, UserRound, CheckCircle2,
  Stethoscope, AlertCircle, Hourglass, Lock, Bell, BellOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Clinic, Doctor, QueueSession, Token } from '../lib/types';
import { useClinicTheme } from '../lib/theme';
import { averageConsultDurationMinutes, estimateWaitMinutes, formatWaitTime } from '../lib/waitTime';
import { BrandHeader } from '../components/BrandHeader';
import { pushSupported, pushConfigured, subscribeToPush } from '../lib/push';
import { notifyInPage } from '../lib/notify';

type Props = { clinicSlug: string; doctorId: string };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; clinic: Clinic; doctor: Doctor; session: QueueSession | null };

type PushState = 'idle' | 'prompting' | 'subscribed' | 'denied' | 'unsupported';

export function QueuePage({ clinicSlug, doctorId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [myTokenInput, setMyTokenInput] = useState('');
  const [submittedToken, setSubmittedToken] = useState<number | null>(null);
  const prevCurrentToken = useRef<number | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [pushState, setPushState] = useState<PushState>('idle');
  const [showSuccess, setShowSuccess] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());

  // Load clinic + doctor + today's session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: 'loading' });
      const { data: clinic, error: clinicErr } = await supabase
        .from('clinics')
        .select('*')
        .eq('slug', clinicSlug)
        .maybeSingle();
      if (clinicErr || !clinic) {
        if (!cancelled) setState({ kind: 'error', message: 'Clinic not found.' });
        return;
      }
      const { data: doctor, error: doctorErr } = await supabase
        .from('doctors')
        .select('*')
        .eq('id', doctorId)
        .maybeSingle();
      if (doctorErr || !doctor) {
        if (!cancelled) setState({ kind: 'error', message: 'Doctor not found.' });
        return;
      }
      const { data: session } = await supabase
        .from('queue_sessions')
        .select('*')
        .eq('doctor_id', doctor.id)
        .eq('session_date', new Date().toISOString().slice(0, 10))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setState({ kind: 'ok', clinic, doctor, session: session ?? null });
        if (session) prevCurrentToken.current = session.current_token;
      }
    })();
    return () => { cancelled = true; };
  }, [clinicSlug, doctorId]);

  const clinic = state.kind === 'ok' ? state.clinic : null;
  useClinicTheme(clinic);

  // Load tokens for the session + realtime
  useEffect(() => {
    if (state.kind !== 'ok' || !state.session) {
      setTokens([]);
      return;
    }
    let cancelled = false;
    const sessionId = state.session.id;

    (async () => {
      const { data } = await supabase
        .from('tokens')
        .select('id, queue_session_id, token_number, status, checked_in_at, consult_started_at, consult_ended_at')
        .eq('queue_session_id', sessionId)
        .order('token_number', { ascending: true });
      if (!cancelled) setTokens(data ?? []);
    })();

    const channel = supabase
      .channel(`queue-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queue_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const updated = payload.new as QueueSession;
          if (updated.current_token !== prevCurrentToken.current) {
            prevCurrentToken.current = updated.current_token;
            setPulseKey((k) => k + 1);
          }
          setState((prev) =>
            prev.kind === 'ok' ? { ...prev, session: updated } : prev,
          );
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tokens', filter: `queue_session_id=eq.${sessionId}` },
        async () => {
          const { data } = await supabase
            .from('tokens')
            .select('id, queue_session_id, token_number, status, checked_in_at, consult_started_at, consult_ended_at')
            .eq('queue_session_id', sessionId)
            .order('token_number', { ascending: true });
          if (!cancelled) setTokens(data ?? []);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [state.kind, state.kind === 'ok' ? state.session?.id : null]);

  // In-page notification fallback: when current_token changes and the
  // patient has searched their token, show a toast + chime if they're
  // within 2 or it's their turn. This works even without push permission.
  const currentToken = state.kind === 'ok' && state.session ? state.session.current_token : 0;
  useEffect(() => {
    if (submittedToken == null) return;
    const diff = submittedToken - currentToken;
    const key = `${submittedToken}-${currentToken}`;
    if (notifiedRef.current.has(key)) return;

    if (diff === 0) {
      notifiedRef.current.add(key);
      notifyInPage("It's your turn!", `Token #${submittedToken} — please proceed to the consultation room.`, 'turn');
    } else if (diff > 0 && diff <= 2) {
      notifiedRef.current.add(key);
      notifyInPage('Your turn is coming soon', `Token #${submittedToken} — about ${diff} ${diff === 1 ? 'patient' : 'patients'} ahead of you.`, 'info');
    }
  }, [submittedToken, currentToken]);

  // Detect if the patient already denied notification permission.
  useEffect(() => {
    if (!pushSupported) { setPushState('unsupported'); return; }
    if (Notification.permission === 'denied') setPushState('denied');
  }, []);

  const avgDuration = useMemo(() => averageConsultDurationMinutes(tokens), [tokens]);

  const myToken = submittedToken;
  const waitMinutes = myToken != null ? estimateWaitMinutes(myToken, currentToken, avgDuration) : null;
  const myTokenRow = useMemo(
    () => (myToken != null ? tokens.find((t) => t.token_number === myToken) : null),
    [myToken, tokens],
  );

  // Show success burst when my token transitions to completed.
  const wasCompleted = useRef(false);
  useEffect(() => {
    if (myTokenRow?.status === 'completed' && !wasCompleted.current) {
      wasCompleted.current = true;
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    }
  }, [myTokenRow?.status]);

  function handleCheckToken(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(myTokenInput, 10);
    if (Number.isNaN(n) || n < 1) return;
    setSubmittedToken(n);
    notifiedRef.current.clear();
    wasCompleted.current = false;
    // Prompt for push after the patient searches their token.
    if (pushState === 'idle' && pushConfigured) {
      setPushState('prompting');
    }
  }

  async function handleEnablePush() {
    if (!myTokenRow) return;
    const ok = await subscribeToPush(myTokenRow.id);
    setPushState(ok ? 'subscribed' : 'denied');
  }

  function handleSkipPush() {
    setPushState(Notification.permission === 'denied' ? 'denied' : 'idle');
  }

  if (state.kind === 'loading') {
    return <QueuePageSkeleton />;
  }

  if (state.kind === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 page-enter">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-900">{state.message}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Please check the link or contact your clinic.
          </p>
        </div>
      </div>
    );
  }

  const { doctor, session } = state;
  const waitingTokens = tokens.filter((t) => t.status === 'waiting');
  const inConsult = tokens.find((t) => t.status === 'in_consult');

  return (
    <div className="min-h-screen bg-slate-50 page-enter">
      <BrandHeader
        clinic={clinic}
        subtitle={`${doctor.name} · ${doctor.specialty}`}
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Now Serving */}
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          <div className="brand-gradient px-6 py-8 sm:px-8 sm:py-10 text-white">
            <div className="flex items-center gap-2 text-white/80 text-sm font-medium uppercase tracking-wide">
              <Stethoscope className="w-4 h-4" />
              Now Serving
            </div>
            <div className="mt-3 flex items-end gap-4">
              <div
                key={pulseKey}
                className="token-slide text-7xl sm:text-8xl font-bold tabular-nums leading-none"
              >
                {currentToken || '—'}
              </div>
              <div className="pb-2 flex items-center gap-3">
                {doctor.photo_url && (
                  <img
                    src={doctor.photo_url}
                    alt={doctor.name}
                    className="w-12 h-12 rounded-full object-cover ring-2 ring-white/30"
                  />
                )}
                <div>
                  <p className="text-white/90 font-medium">{doctor.name}</p>
                  <p className="text-white/70 text-sm">{doctor.specialty}</p>
                </div>
              </div>
            </div>
            {inConsult && (
              <p className="mt-4 text-white/80 text-sm flex items-center gap-1.5">
                <UserRound className="w-4 h-4" />
                Currently in consultation: <span className="font-medium text-white">{inConsult.patient_name}</span>
              </p>
            )}
            {session && session.status === 'closed' && (
              <p className="mt-4 text-white/80 text-sm flex items-center gap-1.5">
                <Lock className="w-4 h-4" />
                Queue closed for today. Please check back tomorrow.
              </p>
            )}
            {!session && (
              <p className="mt-4 text-white/80 text-sm">
                No active queue session today. Please check back later.
              </p>
            )}
          </div>
        </section>

        {/* Wait time estimator */}
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Clock className="w-5 h-5 brand-text" />
            Estimate your wait time
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Enter your token number to see an estimated wait based on this doctor's
            recent consultation pace.
          </p>

          <form onSubmit={handleCheckToken} className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                min={1}
                value={myTokenInput}
                onChange={(e) => setMyTokenInput(e.target.value)}
                placeholder="Your token number"
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
              />
            </div>
            <button
              type="submit"
              className="btn-press brand-bg rounded-lg px-5 py-2.5 font-semibold text-sm hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" />
              Check wait
            </button>
          </form>

          {myToken != null && (
            <div className="mt-5 fade-in">
              {myTokenRow && (myTokenRow.status === 'completed' || myTokenRow.status === 'skipped') ? (
                <div className={`flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 ${showSuccess ? 'success-burst' : ''}`}>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-emerald-900">Your consultation is complete</p>
                    <p className="text-sm text-emerald-700">Token #{myToken} has already been served.</p>
                  </div>
                </div>
              ) : myToken < currentToken ? (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-900">Your token has passed</p>
                    <p className="text-sm text-amber-700">
                      Token #{myToken} was already called. Please see the front desk.
                    </p>
                  </div>
                </div>
              ) : myToken === currentToken ? (
                <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
                  <Hourglass className="w-5 h-5 brand-text" />
                  <div>
                    <p className="font-semibold text-slate-900">You're being served now!</p>
                    <p className="text-sm text-slate-600">Please proceed to the consultation room.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm text-slate-500">Token #{myToken}</p>
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">
                        {formatWaitTime(waitMinutes ?? 0)}
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <p>Currently serving: <span className="font-semibold text-slate-700">#{currentToken || 0}</span></p>
                      <p>
                        {myToken - currentToken} {myToken - currentToken === 1 ? 'patient' : 'patients'} ahead of you
                      </p>
                      <p className="text-xs mt-1">
                        Avg consult: {avgDuration != null ? `${avgDuration.toFixed(1)} min` : 'est. 10 min'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Push notification prompt */}
              {pushState === 'prompting' && myTokenRow && myTokenRow.status !== 'completed' && (
                <div className="mt-3 bg-sky-50 border border-sky-200 rounded-xl p-4 fade-in">
                  <div className="flex items-start gap-3">
                    <Bell className="w-5 h-5 brand-text mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900 text-sm">Get notified when it's your turn</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        We'll alert you when you're 2 tokens away and again when it's your turn — even if you leave this page.
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={handleEnablePush}
                          className="btn-press brand-bg rounded-lg px-3 py-1.5 text-sm font-semibold hover:opacity-90 transition flex items-center gap-1.5"
                        >
                          <Bell className="w-3.5 h-3.5" />
                          Enable notifications
                        </button>
                        <button
                          onClick={handleSkipPush}
                          className="btn-press text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition"
                        >
                          Not now
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {pushState === 'subscribed' && (
                <p className="mt-3 text-xs text-emerald-600 flex items-center gap-1.5 fade-in">
                  <Bell className="w-3.5 h-3.5" />
                  Notifications on — we'll alert you when it's your turn.
                </p>
              )}

              {pushState === 'denied' && (
                <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 fade-in">
                  <BellOff className="w-3.5 h-3.5" />
                  Notifications are blocked. Keep this tab open and you'll still see an in-page alert and hear a chime when it's your turn.
                </p>
              )}

              {pushState === 'unsupported' && pushConfigured === false && pushSupported && (
                <p className="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5" />
                  Push notifications aren't configured on this server. Keep this tab open for in-page alerts.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Upcoming queue list */}
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Upcoming queue</h2>
          {waitingTokens.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No patients waiting. The queue is clear.
            </p>
          ) : (
            <ol className="space-y-2">
              {waitingTokens.map((t) => {
                const isMine = myToken === t.token_number;
                const est = estimateWaitMinutes(t.token_number, currentToken, avgDuration);
                return (
                  <li
                    key={t.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 transition ${
                      isMine
                        ? 'brand-ring bg-sky-50 ring-2'
                        : 'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold tabular-nums ${
                        isMine ? 'brand-bg' : 'bg-white ring-1 ring-slate-200 text-slate-700'
                      }`}>
                        {t.token_number}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{t.patient_name}</p>
                        <p className="text-xs text-slate-500">
                          Checked in {new Date(t.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {isMine && (
                        <span className="text-xs font-semibold brand-text uppercase tracking-wide">You</span>
                      )}
                      <p className="text-sm text-slate-600 tabular-nums">{formatWaitTime(est)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <footer className="text-center text-xs text-slate-400 pt-2 pb-6">
          Updates live · Powered by QueueFlow
        </footer>
      </main>
    </div>
  );
}

function QueuePageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 h-16 flex items-center px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl skeleton" />
          <div className="space-y-1.5">
            <div className="w-32 h-4 rounded skeleton" />
            <div className="w-24 h-3 rounded skeleton" />
          </div>
        </div>
      </div>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200">
          <div className="h-40 skeleton" />
        </div>
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 sm:p-8 space-y-4">
          <div className="w-48 h-6 rounded skeleton" />
          <div className="w-full h-11 rounded-lg skeleton" />
          <div className="w-full h-24 rounded-xl skeleton" />
        </div>
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 sm:p-8 space-y-3">
          <div className="w-32 h-6 rounded skeleton" />
          <div className="w-full h-14 rounded-xl skeleton" />
          <div className="w-full h-14 rounded-xl skeleton" />
        </div>
      </main>
    </div>
  );
}
