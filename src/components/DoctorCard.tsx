import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  UserRound, Clock, CheckCircle2, PhoneCall, Users, Plus, UserPlus,
  Loader2, AlertCircle, Link as LinkIcon, Check, QrCode, X,
} from 'lucide-react';
import type { Clinic, Doctor, QueueSession, Token } from '../lib/types';
import { averageConsultDurationMinutes, formatWaitTime } from '../lib/waitTime';
import { checkInPatient } from '../lib/checkIn';

export type DoctorRow = Doctor & {
  session: QueueSession | null;
  tokens: Token[];
  clinic: Clinic;
};

type Props = {
  row: DoctorRow;
  busy: boolean;
  canManage: boolean;
  onCallNext: () => void;
  onStartSession: () => void;
  onCopyLink: () => void;
  copied: boolean;
};

export function DoctorCard({
  row, busy, canManage, onCallNext, onStartSession, onCopyLink, copied,
}: Props) {
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
  const [showQr, setShowQr] = useState(false);

  const queueUrl = `${window.location.origin}${window.location.pathname}#/queue/${row.clinic.slug}/${row.id}`;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || adding || !session) return;
    setAdding(true);
    setAddError(null);
    try {
      await checkInPatient(session.id, addName);
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
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setShowQr(true)}
              title="Show QR code"
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
            >
              <QrCode className="w-4 h-4" />
            </button>
            <button
              onClick={onCopyLink}
              title="Copy public queue link"
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <LinkIcon className="w-4 h-4" />}
            </button>
          </div>
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
          <div className="w-full rounded-xl py-3 text-sm text-center text-slate-500 bg-slate-100 flex items-center justify-center gap-1.5">
            <Users className="w-4 h-4" />
            View only — ask an admin to manage the queue
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

      {showQr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 fade-in"
          onClick={() => setShowQr(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 p-6 max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                Queue QR code
              </h3>
              <button
                onClick={() => setShowQr(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center mb-4">
              <div className="bg-white p-4 rounded-xl ring-1 ring-slate-200">
                <QRCodeSVG
                  value={queueUrl}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>
            </div>
            <p className="text-sm text-slate-600 text-center mb-1">
              {row.name}
            </p>
            <p className="text-xs text-slate-400 text-center break-all mb-4">
              {queueUrl}
            </p>
            <button
              onClick={() => { navigator.clipboard?.writeText(queueUrl); onCopyLink(); }}
              className="w-full brand-bg rounded-lg py-2.5 text-sm font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
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
