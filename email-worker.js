import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;
const fromEmail = process.env.FCL_FROM_EMAIL;
const publicUrl = (process.env.FCL_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const model = process.env.OPENAI_EMAIL_MODEL || 'gpt-4o-mini';
const pollMs = Number(process.env.EMAIL_WORKER_POLL_MS || 15000);

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[email-worker] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required; worker disabled');
}

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null;
let running = false;
let lastConfigError = '';

function emailConfigError() {
  if (!supabase) return 'Supabase is not configured';
  if (!resendApiKey) return 'RESEND_API_KEY is not configured';
  if (!openAiApiKey) return 'OPENAI_API_KEY is not configured';
  if (!fromEmail) return 'FCL_FROM_EMAIL is not configured';
  return '';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

async function getRows(table, filters = {}) {
  let query = supabase.from(table).select('*');
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function hasSent(matchId, recipientRole) {
  const events = await getRows('connection_events', { match_id: matchId, event_type: 'email_sent' });
  return events.some(event => {
    try {
      const note = JSON.parse(event.note || '{}');
      return note.email_type === 'connection_confirmed' && note.recipient_role === recipientRole;
    } catch {
      return false;
    }
  });
}

async function generateEmail({ recipientRole, participant, supporter, matchId }) {
  const recipientName = recipientRole === 'challenger' ? (participant?.name || '挑戦者') : (supporter?.supporter_name || '支援者');
  const otherName = recipientRole === 'challenger' ? (supporter?.supporter_name || '支援者') : (participant?.name || '挑戦者');
  const roleLabel = recipientRole === 'challenger' ? '挑戦者' : '支援者';
  const otherRoleLabel = recipientRole === 'challenger' ? '支援者' : '挑戦者';
  const detailUrl = `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(matchId)}`;

  const prompt = `
FCL（Future Challenge Lab）の支援接続が成立しました。
以下の情報だけを使って、日本語の短いメールを作ってください。
目的は「双方がつながったことを知らせ、最初の会話につなげる」ことです。
押しつけず、安心感のある自然な文面にしてください。
営業色、誇張、断定的な評価、個人情報の推測は禁止です。
本文は400字以内を目安にしてください。

受信者の役割: ${roleLabel}
受信者名: ${recipientName}
相手の役割: ${otherRoleLabel}
相手の名前: ${otherName}
挑戦者の挑戦内容: ${participant?.challenge || '未登録'}
挑戦者の目標: ${participant?.goal || '未登録'}
支援者の支援分野: ${supporter?.support_category || '未登録'}
支援者の強み: ${Array.isArray(supporter?.strengths) ? supporter.strengths.join('、') : ''}
詳細URL: ${detailUrl}

次のJSONだけを返してください。
{"subject":"...","body":"..."}
`.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'あなたはFCLのメール作成アシスタントです。与えられた事実だけで、丁寧で簡潔な日本語メールを作成してください。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned no email content');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI email JSON parse failed');
  }

  const subject = String(parsed?.subject || '').trim();
  const body = String(parsed?.body || '').trim();
  if (!subject || !body) throw new Error('AI email subject/body is empty');

  return { subject, body, detailUrl };
}

async function sendEmail({ to, email, idempotencyKey }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
      'User-Agent': 'Future-Challenge-Lab/email-worker',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: email.subject,
      text: email.body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.7;white-space:pre-wrap">${escapeHtml(email.body)}</div>`
    })
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Resend ${response.status}: ${responseText}`);

  let result = {};
  try { result = JSON.parse(responseText); } catch { /* Resend should return JSON; keep raw-less success handling */ }
  return result;
}

async function recordEmailSent({ event, match, recipientRole, recipientEmail, email, resendId }) {
  const { error } = await supabase.from('connection_events').insert({
    participant_id: match.participant_id,
    supporter_id: match.supporter_id,
    match_id: match.id,
    event_type: 'email_sent',
    note: JSON.stringify({
      email_type: 'connection_confirmed',
      recipient_role: recipientRole,
      recipient: recipientEmail,
      subject: email.subject,
      resend_id: resendId || null,
      source_event_id: event.id,
      detail_url: email.detailUrl
    }),
    created_at: new Date().toISOString()
  });
  if (error) throw error;
}

async function processMatchEvent(event) {
  if (!event?.match_id) return;
  const [matches, participants, supporters] = await Promise.all([
    getRows('supporter_matches', { id: event.match_id }),
    getRows('participants'),
    getRows('supporters')
  ]);
  const match = matches[0];
  if (!match) return;

  const participant = participants.find(x => x.id === match.participant_id);
  const supporter = supporters.find(x => x.id === match.supporter_id);
  if (!participant || !supporter) throw new Error(`match ${match.id}: participant/supporter not found`);

  const recipients = [
    { role: 'challenger', email: normalizeEmail(participant.email) },
    { role: 'supporter', email: normalizeEmail(supporter.email) }
  ];

  for (const recipient of recipients) {
    if (!recipient.email) {
      console.warn(`[email-worker] ${match.id} ${recipient.role}: no valid email; skipping`);
      continue;
    }
    if (await hasSent(match.id, recipient.role)) continue;

    const email = await generateEmail({ recipientRole: recipient.role, participant, supporter, matchId: match.id });
    const resend = await sendEmail({
      to: recipient.email,
      email,
      idempotencyKey: `fcl/connection_confirmed/${match.id}/${recipient.role}`
    });
    await recordEmailSent({
      event,
      match,
      recipientRole: recipient.role,
      recipientEmail: recipient.email,
      email,
      resendId: resend?.id || null
    });
    console.log(`[email-worker] sent connection_confirmed to ${recipient.role} for match ${match.id}`);
  }
}

async function poll() {
  if (running) return;
  running = true;
  try {
    const configError = emailConfigError();
    if (configError) {
      if (configError !== lastConfigError) {
        console.warn(`[email-worker] waiting for configuration: ${configError}`);
        lastConfigError = configError;
      }
      return;
    }
    if (lastConfigError) {
      console.log('[email-worker] email configuration is ready');
      lastConfigError = '';
    }

    const { data: events, error } = await supabase
      .from('connection_events')
      .select('*')
      .eq('event_type', 'connection_confirmed')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    for (const event of events || []) {
      try {
        await processMatchEvent(event);
      } catch (error) {
        console.error(`[email-worker] match ${event.match_id} failed:`, error?.message || error);
      }
    }
  } catch (error) {
    console.error('[email-worker] poll failed:', error?.message || error);
  } finally {
    running = false;
  }
}

console.log(`[email-worker] started; poll=${pollMs}ms model=${model}`);
await poll();
setInterval(poll, pollMs);
