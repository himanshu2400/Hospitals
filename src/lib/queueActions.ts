import { supabase } from './supabase';
import type { DoctorRow } from '../components/DoctorCard';
import { triggerPush } from './push';

/**
 * End the current consultation: marks the in_consult token as completed
 * and sets consult_ended_at. Does NOT advance current_token or call the
 * next patient — that is a separate action (callNextPatient).
 */
export async function endConsultation(doctor: DoctorRow): Promise<void> {
  if (!doctor.session) return;
  const sessionId = doctor.session.id;
  const currentToken = doctor.session.current_token;
  if (currentToken <= 0) return;

  const { error: endErr } = await supabase
    .from('tokens')
    .update({ status: 'completed', consult_ended_at: new Date().toISOString() })
    .eq('queue_session_id', sessionId)
    .eq('token_number', currentToken)
    .eq('status', 'in_consult');
  if (endErr) throw endErr;
}

/**
 * Call the next waiting patient: sets the next waiting token to
 * in_consult, sets consult_started_at, and advances current_token.
 * Does NOT end the current consultation — that is a separate action
 * (endConsultation). If there is no next patient, advances current_token
 * and sets status to 'waiting'.
 *
 * Also triggers web push notifications:
 * - To the patient whose token is now within 2 of being called (reminder).
 * - To the patient whose turn it is now (it's your turn).
 */
export async function callNextPatient(doctor: DoctorRow): Promise<void> {
  if (!doctor.session) return;
  const sessionId = doctor.session.id;
  const currentToken = doctor.session.current_token;

  const next = doctor.tokens
    .filter((t) => t.status === 'waiting' && t.token_number > currentToken)
    .sort((a, b) => a.token_number - b.token_number)[0];

  if (!next) {
    const { error: sessErr } = await supabase
      .from('queue_sessions')
      .update({ current_token: currentToken + 1, status: 'waiting' })
      .eq('id', sessionId);
    if (sessErr) throw sessErr;
    return;
  }

  const { error: startErr } = await supabase
    .from('tokens')
    .update({ status: 'in_consult', consult_started_at: new Date().toISOString() })
    .eq('id', next.id);

  const { error: sessErr } = await supabase
    .from('queue_sessions')
    .update({ current_token: next.token_number, status: 'active' })
    .eq('id', sessionId);

  if (startErr) throw startErr;
  if (sessErr) throw sessErr;

  // Trigger push notifications (best-effort, silent failure).
  // 1. "It's your turn" to the patient now being called.
  void triggerPush(next.id, {
    title: "It's your turn!",
    body: `Token #${next.token_number} — please proceed to ${doctor.name}.`,
    tag: `turn-${next.id}`,
  });

  // 2. "You're near" to the patient 2 tokens ahead (within 2 of their number).
  const upcoming = doctor.tokens
    .filter((t) => t.status === 'waiting' && t.token_number > next.token_number)
    .sort((a, b) => a.token_number - b.token_number);

  // The patient whose number is next.token_number + 2 is now "within 2"
  // of being called (since current_token just became next.token_number).
  const nearToken = upcoming.find((t) => t.token_number === next.token_number + 2);
  if (nearToken) {
    void triggerPush(nearToken.id, {
      title: 'Your turn is coming soon',
      body: `Token #${nearToken.token_number} — about 2 patients ahead of you. Please get ready.`,
      tag: `near-${nearToken.id}`,
    });
  }
}

/**
 * Close the queue for today: sets status to 'closed' and ended_at to now.
 */
export async function closeQueue(sessionId: string): Promise<void> {
  const { error: sessErr } = await supabase
    .from('queue_sessions')
    .update({ status: 'closed', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
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
