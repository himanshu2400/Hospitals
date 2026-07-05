export type Clinic = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  owner_id: string | null;
  created_at: string;
};

export type Doctor = {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string;
  created_at: string;
};

export type QueueSessionStatus = 'waiting' | 'active' | 'closed';
export type TokenStatus = 'waiting' | 'in_consult' | 'completed' | 'skipped';

export type QueueSession = {
  id: string;
  doctor_id: string;
  session_date: string;
  current_token: number;
  status: QueueSessionStatus;
  created_at: string;
};

export type Token = {
  id: string;
  queue_session_id: string;
  patient_name: string;
  token_number: number;
  status: TokenStatus;
  checked_in_at: string;
  consult_started_at: string | null;
  consult_ended_at: string | null;
};

export type DoctorWithSession = Doctor & {
  queue_sessions: QueueSession[];
};

export type ClinicWithDoctors = Clinic & {
  doctors: DoctorWithSession[];
};
