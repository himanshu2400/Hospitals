import { supabase } from './supabase';
import type { Token } from './types';

/**
 * Check in a patient by inserting a new token into the given queue session.
 * Computes token_number as (max existing token_number + 1, or 1 if none).
 * Retries on unique-constraint violation by bumping the number.
 *
 * Returns the inserted Token row, or throws on persistent failure.
 */
export async function checkInPatient(
  queueSessionId: string,
  patientName: string,
  age?: number,
  maxRetries = 5,
): Promise<Token> {
  const name = patientName.trim();
  if (!name) throw new Error('Patient name is required.');

  // Fetch the current max token_number for this session.
  const { data: existing, error: fetchErr } = await supabase
    .from('tokens')
    .select('token_number')
    .eq('queue_session_id', queueSessionId)
    .order('token_number', { ascending: false })
    .limit(1);

  if (fetchErr) throw fetchErr;

  let nextNumber = (existing && existing.length > 0 ? existing[0].token_number : 0) + 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase
      .from('tokens')
      .insert({
        queue_session_id: queueSessionId,
        patient_name: name,
        token_number: nextNumber,
        status: 'waiting',
        age: age ?? null,
      })
      .select()
      .single();

    if (!error) return data as Token;

    // Postgres unique violation code is 23505. Retry with next number.
    if (error.code === '23505') {
      nextNumber += 1;
      continue;
    }

    throw error;
  }

  throw new Error('Could not assign a token number after several attempts. Please try again.');
}
