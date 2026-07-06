import { useState } from 'react';
import { Loader2, LogOut, Calendar, Users, AlertCircle } from 'lucide-react';
import type { Clinic, Department } from '../lib/types';
import { useDepartmentDoctors } from '../lib/useDepartmentDoctors';
import { useClinicTheme } from '../lib/theme';
import { callNextPatient, endConsultation, startSession, closeQueue } from '../lib/queueActions';
import { BrandHeader } from './BrandHeader';
import { DoctorCard } from './DoctorCard';

type Props = {
  clinic: Clinic;
  departments: Department[];
  onSignOut: () => void;
};

export function DepartmentConsole({ clinic, departments, onSignOut }: Props) {
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const departmentIds = departments.map((d) => d.id);
  const { rows, loading } = useDepartmentDoctors(departmentIds, clinic, true);
  useClinicTheme(clinic);

  async function handleCallNext(doctor: Parameters<typeof DoctorCard>[0]['row']) {
    if (!doctor.session || busyDoctorId) return;
    setBusyDoctorId(doctor.id);
    try {
      await callNextPatient(doctor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to call next patient');
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleStartSession(doctorId: string) {
    if (busyDoctorId) return;
    setBusyDoctorId(doctorId);
    try {
      await startSession(doctorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleEndConsultation(doctor: Parameters<typeof DoctorCard>[0]['row']) {
    if (!doctor.session || busyDoctorId) return;
    setBusyDoctorId(doctor.id);
    try {
      await endConsultation(doctor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end consultation');
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleCloseQueue(sessionId: string, doctorId: string) {
    if (busyDoctorId) return;
    setBusyDoctorId(doctorId);
    try {
      await closeQueue(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close queue');
    } finally {
      setBusyDoctorId(null);
    }
  }

  function copyQueueLink(row: Parameters<typeof DoctorCard>[0]['row']) {
    const url = `${window.location.origin}${window.location.pathname}#/queue/${row.clinic.slug}/${row.id}`;
    navigator.clipboard?.writeText(url);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <BrandHeader
        clinic={clinic}
        subtitle={departments.map((d) => d.name).join(', ')}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
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
            <h1 className="text-2xl font-bold text-slate-900">Your department console</h1>
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
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="font-semibold text-slate-900">No doctors in your department yet</h2>
            <p className="text-sm text-slate-500 mt-1">
              An admin needs to add doctors to your department before you can manage the queue.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {departments.map((dept) => {
              const deptRows = rows.filter((r) => r.department_id === dept.id);
              if (deptRows.length === 0) return null;
              return (
                <div key={dept.id}>
                  <h2 className="font-semibold text-slate-900 mb-3">{dept.name}</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {deptRows.map((row) => (
                      <DoctorCard
                        key={row.id}
                        row={row}
                        busy={busyDoctorId === row.id}
                        canManage={true}
                        onCallNext={() => handleCallNext(row)}
                        onEndConsultation={() => handleEndConsultation(row)}
                        onStartSession={() => handleStartSession(row.id)}
                        onCloseQueue={() => handleCloseQueue(row.session!.id, row.id)}
                        onCopyLink={() => copyQueueLink(row)}
                        copied={copiedId === row.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
