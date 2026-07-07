import { useMemo } from 'react';
import { BarChart3, Clock, Users, TrendingUp, TrendingDown } from 'lucide-react';
import type { DoctorRow } from './DoctorCard';
import { formatWaitTime } from '../lib/waitTime';

type Props = {
  rows: DoctorRow[];
  title?: string;
};

type PatientRow = {
  id: string;
  name: string;
  age: number | null;
  doctorName: string;
  checkedInAt: string;
  durationMin: number | null;
  status: string;
};

export function TodayReport({ rows, title = "Today's report" }: Props) {
  const { patients, stats } = useMemo(() => {
    const all: PatientRow[] = [];
    for (const row of rows) {
      for (const t of row.tokens) {
        const duration =
          t.consult_started_at && t.consult_ended_at
            ? (new Date(t.consult_ended_at).getTime() - new Date(t.consult_started_at).getTime()) / 60000
            : null;
        all.push({
          id: t.id,
          name: t.patient_name,
          age: t.age,
          doctorName: row.name,
          checkedInAt: t.checked_in_at,
          durationMin: duration,
          status: t.status,
        });
      }
    }
    all.sort((a, b) => new Date(a.checkedInAt).getTime() - new Date(b.checkedInAt).getTime());

    const seen = all.filter((p) => p.status === 'completed' || p.status === 'in_consult');
    const completedDurations = all
      .filter((p) => p.durationMin != null)
      .map((p) => p.durationMin!);

    const totalPatients = seen.length;
    const avg = completedDurations.length > 0
      ? completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length
      : null;
    const longest = completedDurations.length > 0 ? Math.max(...completedDurations) : null;
    const shortest = completedDurations.length > 0 ? Math.min(...completedDurations) : null;

    return {
      patients: all,
      stats: { totalPatients, avg, longest, shortest },
    };
  }, [rows]);

  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 brand-text" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="Patients seen"
            value={String(stats.totalPatients)}
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label="Avg duration"
            value={stats.avg != null ? formatWaitTime(stats.avg) : '—'}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Longest"
            value={stats.longest != null ? formatWaitTime(stats.longest) : '—'}
          />
          <StatCard
            icon={<TrendingDown className="w-4 h-4" />}
            label="Shortest"
            value={stats.shortest != null ? formatWaitTime(stats.shortest) : '—'}
          />
        </div>

        {/* Patient table */}
        {patients.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No patients today yet.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-100">
                  <th className="py-2.5 pr-3 font-medium">#</th>
                  <th className="py-2.5 pr-3 font-medium">Name</th>
                  <th className="py-2.5 pr-3 font-medium">Age</th>
                  <th className="py-2.5 pr-3 font-medium">Doctor</th>
                  <th className="py-2.5 pr-3 font-medium">Checked in</th>
                  <th className="py-2.5 pr-3 font-medium text-right">Duration</th>
                  <th className="py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {patients.map((p, i) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-2.5 pr-3 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">{p.name}</td>
                    <td className="py-2.5 pr-3 text-slate-600 tabular-nums">
                      {p.age != null ? `${p.age}` : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600">{p.doctorName}</td>
                    <td className="py-2.5 pr-3 text-slate-500 tabular-nums">
                      {new Date(p.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">
                      {p.durationMin != null ? formatWaitTime(p.durationMin) : '—'}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    waiting: 'bg-amber-50 text-amber-700',
    in_consult: 'bg-sky-50 text-sky-700',
    completed: 'bg-emerald-50 text-emerald-700',
    skipped: 'bg-slate-100 text-slate-500',
  };
  const labels: Record<string, string> = {
    waiting: 'Waiting',
    in_consult: 'In consult',
    completed: 'Done',
    skipped: 'Skipped',
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {labels[status] ?? status}
    </span>
  );
}
