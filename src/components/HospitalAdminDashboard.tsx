import { useEffect, useState } from 'react';
import {
  Loader2, LogOut, Settings, Calendar, Users, AlertCircle, Plus,
  Building2, UserPlus, Trash2, Mail, Check, X, BarChart3, LayoutGrid, Camera,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useRouter } from '../lib/router';
import type { Clinic, Department, DepartmentStaff } from '../lib/types';
import { useDepartmentDoctors } from '../lib/useDepartmentDoctors';
import { useClinicTheme } from '../lib/theme';
import { callNextPatient, endConsultation, startSession, closeQueue } from '../lib/queueActions';
import { uploadImage } from '../lib/storage';
import { BrandHeader } from './BrandHeader';
import { DoctorCard } from './DoctorCard';
import { TodayReport } from './TodayReport';

type Props = {
  clinic: Clinic;
  departments: Department[];
  onSignOut: () => void;
};

export function HospitalAdminDashboard({ clinic, departments: initialDepartments, onSignOut }: Props) {
  const { navigate } = useRouter();
  const [departments, setDepartments] = useState<Department[]>(initialDepartments);
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'console' | 'report'>('console');

  // Department creation
  const [newDeptName, setNewDeptName] = useState('');
  const [addingDept, setAddingDept] = useState(false);

  // Staff invite
  const [invitingDeptId, setInvitingDeptId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Staff list per department
  const [staffByDept, setStaffByDept] = useState<Record<string, DepartmentStaff[]>>({});

  // Doctor add per department
  const [addingDocDeptId, setAddingDocDeptId] = useState<string | null>(null);
  const [newDocName, setNewDocName] = useState('');
  const [newDocSpecialty, setNewDocSpecialty] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);

  const departmentIds = departments.map((d) => d.id);
  const { rows, loading } = useDepartmentDoctors(departmentIds, clinic, true);
  useClinicTheme(clinic);

  // Realtime: reload departments + staff when departments table changes
  useEffect(() => {
    const channel = supabase
      .channel('admin-departments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, async () => {
        const { data } = await supabase
          .from('departments')
          .select('*')
          .eq('clinic_id', clinic.id)
          .order('name');
        setDepartments(data ?? []);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_staff' }, () => {
        loadStaff();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinic.id]);

  async function loadStaff() {
    if (departmentIds.length === 0) return;
    const { data } = await supabase
      .from('department_staff')
      .select('*')
      .in('department_id', departmentIds);
    const map: Record<string, DepartmentStaff[]> = {};
    (data ?? []).forEach((s) => {
      const arr = map[s.department_id] ?? [];
      arr.push(s);
      map[s.department_id] = arr;
    });
    setStaffByDept(map);
  }

  useEffect(() => {
    loadStaff();
  }, [departmentIds.join(',')]);

  async function handleAddDepartment(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = newDeptName.trim();
    if (!cleanName || addingDept) return;
    setAddingDept(true);
    setError(null);
    try {
      const { data, error: insertErr } = await supabase
        .from('departments')
        .insert({ clinic_id: clinic.id, name: cleanName })
        .select()
        .single();
      if (insertErr) throw insertErr;
      setDepartments((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDeptName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add department');
    } finally {
      setAddingDept(false);
    }
  }

  async function handleDeleteDepartment(dept: Department) {
    if (!confirm(`Delete department "${dept.name}"? This removes its doctors, queue sessions, and staff assignments.`)) return;
    const { error: delErr } = await supabase.from('departments').delete().eq('id', dept.id);
    if (delErr) { setError(delErr.message); return; }
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
  }

  async function handleInviteStaff(e: React.FormEvent, dept: Department) {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      // Look up the user by email in auth.users via the profiles edge function.
      // Since we can't query auth.users directly from the client, we use a
      // different approach: insert a department_staff row with the user_id
      // resolved via a Postgres function.
      const { data: existingUser, error: lookupErr } = await supabase
        .rpc('find_user_by_email', { p_email: cleanEmail });
      if (lookupErr) throw lookupErr;
      if (!existingUser || existingUser.length === 0) {
        setInviteError('No account found with that email. Ask them to sign in first, then invite again.');
        return;
      }
      const userId = existingUser[0].id;
      const { error: insertErr } = await supabase
        .from('department_staff')
        .insert({ department_id: dept.id, user_id: userId, role: 'receptionist' });
      if (insertErr) {
        if (insertErr.code === '23505') {
          setInviteError('That person is already assigned to this department.');
        } else {
          throw insertErr;
        }
        return;
      }
      setInviteSuccess(`Invited ${cleanEmail} to ${dept.name}.`);
      setInviteEmail('');
      setInvitingDeptId(null);
      loadStaff();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite staff member');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveStaff(staff: DepartmentStaff, deptName: string) {
    if (!confirm(`Remove this staff member from ${deptName}?`)) return;
    const { error: delErr } = await supabase.from('department_staff').delete().eq('id', staff.id);
    if (delErr) { setError(delErr.message); return; }
    loadStaff();
  }

  async function handleAddDoctor(e: React.FormEvent, dept: Department) {
    e.preventDefault();
    const cleanName = newDocName.trim();
    const cleanSpecialty = newDocSpecialty.trim();
    if (!cleanName || !cleanSpecialty || addingDoc) return;
    setAddingDoc(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase
        .from('doctors')
        .insert({
          department_id: dept.id,
          clinic_id: dept.clinic_id,
          name: cleanName,
          specialty: cleanSpecialty,
        });
      if (insertErr) throw insertErr;
      setNewDocName('');
      setNewDocSpecialty('');
      setAddingDocDeptId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add doctor');
    } finally {
      setAddingDoc(false);
    }
  }

  async function handleDeleteDoctor(doctorId: string) {
    if (!confirm('Remove this doctor? This also deletes their queue sessions and tokens.')) return;
    const { error: delErr } = await supabase.from('doctors').delete().eq('id', doctorId);
    if (delErr) { setError(delErr.message); return; }
  }

  async function handleUploadPhoto(doctorId: string, file: File) {
    setUploadingPhotoId(doctorId);
    setError(null);
    try {
      const url = await uploadImage('photos', file, doctorId);
      const { error: updateErr } = await supabase
        .from('doctors')
        .update({ photo_url: url })
        .eq('id', doctorId);
      if (updateErr) throw updateErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploadingPhotoId(null);
    }
  }

  async function handleCallNext(row: Parameters<typeof DoctorCard>[0]['row']) {
    if (!row.session || busyDoctorId) return;
    setBusyDoctorId(row.id);
    try {
      await callNextPatient(row);
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

  async function handleEndConsultation(row: Parameters<typeof DoctorCard>[0]['row']) {
    if (!row.session || busyDoctorId) return;
    setBusyDoctorId(row.id);
    try {
      await endConsultation(row);
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
    <div className="min-h-screen bg-slate-50 page-enter">
      <BrandHeader
        clinic={clinic}
        subtitle="Hospital Admin"
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
            <h1 className="text-2xl font-bold text-slate-900">Hospital Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              <button
                onClick={() => setView('console')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  view === 'console' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                Console
              </button>
              <button
                onClick={() => setView('report')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  view === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Today's report
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Building2 className="w-4 h-4" />
              {departments.length} {departments.length === 1 ? 'department' : 'departments'}
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Create department */}
        <form onSubmit={handleAddDepartment} className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Add a department
            </label>
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="e.g. Cardiology"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
            />
          </div>
          <button
            type="submit"
            disabled={addingDept || !newDeptName.trim()}
            className="brand-bg rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {addingDept ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add department
          </button>
        </form>

        {loading ? (
          <div className="space-y-8">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-4">
                <div className="w-40 h-6 rounded skeleton" />
                <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 space-y-3">
                  <div className="w-32 h-5 rounded skeleton" />
                  <div className="h-8 rounded-lg skeleton" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[0, 1].map((j) => (
                    <div key={j} className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
                      <div className="p-5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl skeleton" />
                          <div className="space-y-2 flex-1">
                            <div className="w-32 h-4 rounded skeleton" />
                            <div className="w-24 h-3 rounded skeleton" />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="h-14 rounded-lg skeleton" />
                          <div className="h-14 rounded-lg skeleton" />
                          <div className="h-14 rounded-lg skeleton" />
                        </div>
                      </div>
                      <div className="px-5 pb-5 space-y-2">
                        <div className="h-10 rounded-xl skeleton" />
                        <div className="h-8 rounded-lg skeleton" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : departments.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="font-semibold text-slate-900">No departments yet</h2>
            <p className="text-sm text-slate-500 mt-1">
              Create your first department above to start adding doctors and managing queues.
            </p>
          </div>
        ) : view === 'report' ? (
          <div className="space-y-6">
            <TodayReport rows={rows} title="Today's report — all departments" />
            {departments.map((dept) => {
              const deptRows = rows.filter((r) => r.department_id === dept.id);
              if (deptRows.length === 0) return null;
              return (
                <TodayReport
                  key={dept.id}
                  rows={deptRows}
                  title={`${dept.name} — report`}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-8">
            {departments.map((dept) => {
              const deptRows = rows.filter((r) => r.department_id === dept.id);
              const deptStaff = staffByDept[dept.id] ?? [];
              return (
                <div key={dept.id} className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{dept.name}</h2>
                      <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                        {deptRows.length} {deptRows.length === 1 ? 'doctor' : 'doctors'} · {deptStaff.length} {deptStaff.length === 1 ? 'staff' : 'staff'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteDepartment(dept)}
                      className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition"
                      aria-label={`Delete ${dept.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Staff invitations for this department */}
                  <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                        <UserPlus className="w-4 h-4" />
                        Department staff
                      </h3>
                      <button
                        onClick={() => { setInvitingDeptId(invitingDeptId === dept.id ? null : dept.id); setInviteError(null); setInviteSuccess(null); }}
                        className="text-sm font-medium brand-text hover:underline"
                      >
                        {invitingDeptId === dept.id ? 'Cancel' : 'Invite staff'}
                      </button>
                    </div>

                    {invitingDeptId === dept.id && (
                      <form onSubmit={(e) => handleInviteStaff(e, dept)} className="mb-3 fade-in">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="relative flex-1">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                              type="email"
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              placeholder="staff@hospital.com"
                              className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition"
                              required
                              autoFocus
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={inviting || !inviteEmail.trim()}
                            className="brand-bg rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                          >
                            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                            Send invite
                          </button>
                        </div>
                        {inviteError && (
                          <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {inviteError}
                          </p>
                        )}
                        {inviteSuccess && (
                          <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5" />
                            {inviteSuccess}
                          </p>
                        )}
                      </form>
                    )}

                    {deptStaff.length === 0 ? (
                      <p className="text-sm text-slate-500 py-2">
                        No staff assigned yet. Invite someone by email — they'll appear here once they sign in.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {deptStaff.map((s) => (
                          <li key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full brand-bg flex items-center justify-center">
                                <Users className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-sm text-slate-700">{s.role}</span>
                            </div>
                            <button
                              onClick={() => handleRemoveStaff(s, dept.name)}
                              className="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition"
                              aria-label="Remove staff member"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Doctors in this department */}
                  <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        Doctors
                      </h3>
                      <button
                        onClick={() => { setAddingDocDeptId(addingDocDeptId === dept.id ? null : dept.id); setNewDocName(''); setNewDocSpecialty(''); }}
                        className="text-sm font-medium brand-text hover:underline"
                      >
                        {addingDocDeptId === dept.id ? 'Cancel' : 'Add doctor'}
                      </button>
                    </div>

                    {addingDocDeptId === dept.id && (
                      <form onSubmit={(e) => handleAddDoctor(e, dept)} className="mb-3 fade-in">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={newDocName}
                            onChange={(e) => setNewDocName(e.target.value)}
                            placeholder="Doctor name"
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500"
                            required
                            autoFocus
                          />
                          <input
                            type="text"
                            value={newDocSpecialty}
                            onChange={(e) => setNewDocSpecialty(e.target.value)}
                            placeholder="Specialty"
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500"
                            required
                          />
                          <button
                            type="submit"
                            disabled={addingDoc || !newDocName.trim() || !newDocSpecialty.trim()}
                            className="brand-bg rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                          >
                            {addingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Add
                          </button>
                        </div>
                      </form>
                    )}

                    {deptRows.length === 0 ? (
                      <p className="text-sm text-slate-500 py-2">
                        No doctors in this department yet.
                      </p>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {deptRows.map((row) => (
                          <div key={row.id} className="relative">
                            <DoctorCard
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
                            <button
                              onClick={() => handleDeleteDoctor(row.id)}
                              className="absolute top-3 right-12 text-slate-300 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition"
                              aria-label={`Remove ${row.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <label
                              className="absolute top-3 right-20 text-slate-300 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                              aria-label={`Upload photo for ${row.name}`}
                            >
                              {uploadingPhotoId === row.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Camera className="w-3.5 h-3.5" />
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                disabled={uploadingPhotoId !== null}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadPhoto(row.id, file);
                                  e.currentTarget.value = '';
                                }}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
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
