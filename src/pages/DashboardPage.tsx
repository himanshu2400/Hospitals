import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import { CreateClinicForm } from '../components/CreateClinicForm';
import { HospitalAdminDashboard } from '../components/HospitalAdminDashboard';
import { DepartmentConsole } from '../components/DepartmentConsole';

export function DashboardPage() {
  const { session, loading: authLoading, clinic, departments, staffAssignments, profileLoading } = useAuth();
  const { navigate } = useRouter();

  // Hard auth gate: while auth is resolving, render nothing. Once resolved,
  // if there's no session, redirect to login.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!session) {
    navigate('/login');
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // Profile is loading (clinic + departments being resolved)
  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // No clinic and no staff assignments → show the "Create your hospital" form.
  if (!clinic && staffAssignments.length === 0) {
    return <CreateClinicForm onCreated={() => {}} />;
  }

  // Staff member (has department_staff assignments but no owned clinic) → department console.
  if (clinic && staffAssignments.length > 0) {
    return (
      <DepartmentConsole
        clinic={clinic}
        departments={departments}
        onSignOut={handleSignOut}
      />
    );
  }

  // Clinic owner → hospital admin dashboard.
  if (clinic) {
    return (
      <HospitalAdminDashboard
        clinic={clinic}
        departments={departments}
        onSignOut={handleSignOut}
      />
    );
  }

  // Fallback (shouldn't happen)
  return <CreateClinicForm onCreated={() => {}} />;
}
