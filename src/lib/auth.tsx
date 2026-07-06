import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Clinic, Department, DepartmentStaff } from './types';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  clinic: Clinic | null;
  departments: Department[];
  staffAssignments: DepartmentStaff[];
  profileLoading: boolean;
  reloadProfile: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  clinic: null,
  departments: [],
  staffAssignments: [],
  profileLoading: true,
  reloadProfile: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffAssignments, setStaffAssignments] = useState<DepartmentStaff[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession) {
      setClinic(null);
      setDepartments([]);
      setStaffAssignments([]);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    const uid = currentSession.user.id;

    // 1. Does this user own a clinic?
    const { data: ownedClinic } = await supabase
      .from('clinics')
      .select('*')
      .eq('owner_id', uid)
      .maybeSingle();

    if (ownedClinic) {
      // Owner: load all departments under their clinic.
      const { data: deptList } = await supabase
        .from('departments')
        .select('*')
        .eq('clinic_id', ownedClinic.id)
        .order('name');
      setClinic(ownedClinic);
      setDepartments(deptList ?? []);
      setStaffAssignments([]);
      setProfileLoading(false);
      return;
    }

    // 2. Not an owner — check for department_staff assignments.
    const { data: staffList } = await supabase
      .from('department_staff')
      .select('*')
      .eq('user_id', uid);

    if (!staffList || staffList.length === 0) {
      setClinic(null);
      setDepartments([]);
      setStaffAssignments([]);
      setProfileLoading(false);
      return;
    }

    // Staff member: load the departments they're assigned to.
    const deptIds = staffList.map((s) => s.department_id);
    const { data: deptList } = await supabase
      .from('departments')
      .select('*')
      .in('id', deptIds)
      .order('name');

    // Load the parent clinic for branding.
    const clinicId = deptList && deptList.length > 0 ? deptList[0].clinic_id : null;
    let staffClinic: Clinic | null = null;
    if (clinicId) {
      const { data: c } = await supabase
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .maybeSingle();
      staffClinic = c;
    }

    setClinic(staffClinic);
    setDepartments(deptList ?? []);
    setStaffAssignments(staffList ?? []);
    setProfileLoading(false);
  }, []);

  // Load profile whenever the session changes.
  useEffect(() => {
    loadProfile(session);
  }, [session, loadProfile]);

  // Realtime: reload profile when clinics or department_staff change (so a newly
  // created clinic or a new staff assignment is picked up without a page reload).
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel('auth-profile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clinics' }, () => loadProfile(session))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_staff' }, () => loadProfile(session))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => loadProfile(session))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, loadProfile]);

  const reloadProfile = useCallback(() => {
    loadProfile(session);
  }, [session, loadProfile]);

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      loading,
      clinic,
      departments,
      staffAssignments,
      profileLoading,
      reloadProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
