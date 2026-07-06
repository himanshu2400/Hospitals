import { supabase } from './supabase';
import type { DoctorRow } from '../components/DoctorCard';

export async function callNextPatient(doctor: DoctorRow): Promise<void> {
  if (!doctor.session) return;
  const now = new Date().toISOString();
  const sessionId = doctor.session.id;
  const currentToken = doctor.session.current_token;

  // 1. End the current consultation (the token == current_token), if any.
  if (currentToken > 0) {
    const { error: endErr } = await supabase
      .from('tokens')
      .update({ status: 'completed', consult_ended_at: now })
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
    .update({ status: 'in_consult', consult_started_at: now })
    .eq('id', next.id);

  // 4. Advance the session's current_token to the next patient's number.
  const { error: sessErr } = await supabase
    .from('queue_sessions')
    .update({ current_token: next.token_number, status: 'active' })
    .eq('id', sessionId);

  if (startErr) throw startErr;
  if (sessErr) throw sessErr;
}

export async function startSession(doctorId: string): Promise<void> {
  const { error: insErr } = await supabase
    .from('queue_sessions')
    .insert({
      doctor_id: doctorId,
      session_date: new Date().toISOString().slice(0, 10),
      current_token: 0,
      status: 'waiting',
    });
  if (insErr) throw insErr;
}
