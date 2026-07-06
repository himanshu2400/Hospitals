import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Clinic, Doctor, QueueSession, Token } from './types';
import type { DoctorRow } from '../components/DoctorCard';

type LoadResult = {
  rows: DoctorRow[];
  loading: boolean;
  error: string | null;
};

/**
 * Load all doctors (with today's session + tokens) for the given department ids,
 * scoped to the given clinic for branding. Subscribes to realtime updates on
 * doctors, queue_sessions, tokens, departments, and department_staff.
 */
export function useDepartmentDoctors(
  departmentIds: string[],
  clinic: Clinic | null,
  enabled: boolean,
): LoadResult {
  const [rows, setRows] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || departmentIds.length === 0 || !clinic) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: doctorList, error: doctorErr } = await supabase
        .from('doctors')
        .select('*')
        .in('department_id', departmentIds)
        .order('name');
      if (doctorErr) { if (!cancelled) setError(doctorErr.message); return; }
      if (cancelled) return;

      const today = new Date().toISOString().slice(0, 10);
      const { data: sessionList } = await supabase
        .from('queue_sessions')
        .select('*')
        .in('doctor_id', (doctorList ?? []).map((d) => d.id))
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

      const tokensBySession = new Map<string, Token[]>();
      for (const t of tokenList) {
        const arr = tokensBySession.get(t.queue_session_id) ?? [];
        arr.push(t);
        tokensBySession.set(t.queue_session_id, arr);
      }

      const built: DoctorRow[] = (doctorList ?? []).map((d: Doctor) => ({
        ...d,
        session: sessionByDoctor.get(d.id) ?? null,
        tokens: tokensBySession.get(sessionByDoctor.get(d.id)?.id ?? '') ?? [],
        clinic: clinic!,
      }));

      if (!cancelled) {
        setRows(built);
        setLoading(false);
      }
    }

    load();

    const channel = supabase
      .channel(`dept-doctors-${departmentIds.join('-')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_sessions' }, () => { if (!cancelled) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens' }, () => { if (!cancelled) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctors' }, () => { if (!cancelled) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => { if (!cancelled) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_staff' }, () => { if (!cancelled) load(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [departmentIds.join(','), clinic?.id, enabled]);

  return { rows, loading, error };
}
