import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;
const fromEmail = process.env.FCL_FROM_EMAIL;
const publicUrl = (process.env.FCL_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const model = process.env.OPENAI_EMAIL_MODEL || 'gpt-4o-mini';
const pollMs = Number(process.env.EMAIL_WORKER_POLL_MS || 15000);

// Re-check recent connection events after restart so changed recipient addresses can be delivered.
const emailEventLookbackMs = Number(process.env.EMAIL_WORKER_LOOKBACK_MS || 7 * 24 * 60 * 60 * 1000);

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
function isTestEmail(value) {
  const email = normalizeEmail(value);
  const domain = email.split('@').pop() || '';
  return domain === 'example.com' || domain === 'test.com';
}

function createAccessToken(matchId, role) {
  if (!serviceRoleKey) return '';
  const payload = Buffer.from(JSON.stringify({ match_id: matchId, role })).toString('base64url');
  const signature = crypto.createHmac('sha256', serviceRoleKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function createReengagementToken(participantId) {
  if (!serviceRoleKey || !participantId) return '';
  const payload = Buffer.from(JSON.stringify({
    purpose: 'fcl-reengagement',
    participant_id: participantId,
    exp: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000)
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', serviceRoleKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}


async function getRows(table, filters = {}) {
  let query = supabase.from(table).select('*');
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function hasSent(matchId, recipientRole, recipientEmail) {
  const events = await getRows('connection_events', { match_id: matchId, event_type: 'email_sent' });
  return events.some(event => {
    try {
      const note = JSON.parse(event.note || '{}');
      return note.email_type === 'connection_confirmed'
        && note.recipient_role === recipientRole
        && normalizeEmail(note.recipient) === normalizeEmail(recipientEmail);
    } catch {
      return false;
    }
  });
}

function buildFallbackEmail({ recipientRole, participant, supporter, matchId }) {
  const recipientName = recipientRole === 'challenger'
    ? (participant?.name || '挑戦者')
    : (supporter?.supporter_name || '支援者');
  const otherName = recipientRole === 'challenger'
    ? (supporter?.supporter_name || '支援者')
    : (participant?.name || '挑戦者');
  const token = createAccessToken(matchId, recipientRole);
  const detailUrl = `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(matchId)}&token=${encodeURIComponent(token)}`;
  const supportCategory = supporter?.support_category || '未登録';
  const strengths = Array.isArray(supporter?.strengths) && supporter.strengths.length
    ? supporter.strengths.join('、')
    : '未登録';
  const supportDescription = supporter?.description || '未登録';

  const subject = recipientRole === 'challenger'
    ? `FCL｜${otherName}さんと支援のつながりが成立しました`
    : `FCL｜${otherName}さんの挑戦とつながりました`;

  const body = recipientRole === 'challenger'
    ? [
        `${recipientName}さん`,
        '',
        `FCLで、支援者の${otherName}さんとのつながりが成立しました。`,
        '',
        '【あなたの挑戦】',
        `挑戦内容：${participant?.challenge || '未登録'}`,
        `目標：${participant?.goal || '未登録'}`,
        '',
        '【支援者ができること】',
        `支援分野：${supportCategory}`,
        `得意なこと：${strengths}`,
        `支援内容：${supportDescription}`,
        '',
        'まずはFCLの接続ページで、お互いのことを知りながら最初の一歩を話してみてください。',
        '',
        `FCLで開く：${detailUrl}`,
        '',
        'Future Challenge Lab'
      ].join('\n')
    : [
        `${recipientName}さん`,
        '',
        `FCLで、挑戦者の${otherName}さんとの支援のつながりが成立しました。`,
        '',
        '【今回の挑戦者】',
        `挑戦内容：${participant?.challenge || '未登録'}`,
        `目標：${participant?.goal || '未登録'}`,
        '',
        '【あなたの支援できること】',
        `支援分野：${supportCategory}`,
        `得意なこと：${strengths}`,
        `支援内容：${supportDescription}`,
        '',
        'まずはFCLの接続ページで、今の状況を聞きながら次の一歩を一緒に整理してみてください。',
        '',
        `FCLで開く：${detailUrl}`,
        '',
        'Future Challenge Lab'
      ].join('\n');

  return { subject, body, detailUrl, source: 'fallback' };
}

async function generateEmail({ recipientRole, participant, supporter, matchId }) {
  const fallback = buildFallbackEmail({ recipientRole, participant, supporter, matchId });
  if (!openAiApiKey) return fallback;

  const recipientName = recipientRole === 'challenger' ? (participant?.name || '挑戦者') : (supporter?.supporter_name || '支援者');
  const otherName = recipientRole === 'challenger' ? (supporter?.supporter_name || '支援者') : (participant?.name || '挑戦者');
  const roleLabel = recipientRole === 'challenger' ? '挑戦者' : '支援者';
  const otherRoleLabel = recipientRole === 'challenger' ? '支援者' : '挑戦者';
  const detailUrl = fallback.detailUrl;
  const supportCategory = supporter?.support_category || '未登録';
  const strengths = Array.isArray(supporter?.strengths) ? supporter.strengths.join('、') : '';
  const supportDescription = supporter?.description || '未登録';

  const prompt = `
FCL（Future Challenge Lab）の支援接続が成立しました。
以下の情報だけを使って、日本語の短いメールを作ってください。
目的は「つながったことを知らせる」だけでなく、「相手の挑戦内容と、今回の支援でできることを理解して、最初の会話につなげる」ことです。
押しつけず、安心感のある自然な文面にしてください。
営業色、誇張、断定的な評価、個人情報の推測は禁止です。
本文は500字以内を目安にしてください。

受信者の役割: ${roleLabel}
受信者名: ${recipientName}
相手の役割: ${otherRoleLabel}
相手の名前: ${otherName}

【挑戦者の情報】
挑戦内容: ${participant?.challenge || '未登録'}
目標: ${participant?.goal || '未登録'}

【支援者の情報】
支援分野: ${supportCategory}
得意なこと: ${strengths || '未登録'}
支援内容: ${supportDescription}

FCL接続ページURL: ${detailUrl}

メールでは、挑戦者向けなら「自分の挑戦」と「この支援者ができること」を明確にしてください。
支援者向けなら「今回の挑戦者の挑戦内容・目標」と「自分が提供できる支援内容」を明確にしてください。
最後は、FCLの接続ページで最初の会話につながる自然な一文にしてください。

次のJSONだけを返してください。
{"subject":"...","body":"..."}
`.trim();

  try {
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
      console.warn(`[email-worker] OpenAI unavailable (${response.status}); using fallback template`);
      return { ...fallback, ai_error: `OpenAI ${response.status}: ${errorText}` };
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

    return { subject, body, detailUrl, source: 'openai' };
  } catch (error) {
    console.warn(`[email-worker] OpenAI email generation failed; using fallback template: ${error?.message || error}`);
    return { ...fallback, ai_error: error?.message || String(error) };
  }
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
      html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><div style="white-space:pre-wrap">${escapeHtml(email.body)}</div><p style="margin-top:24px"><a href="${escapeHtml(email.detailUrl || publicUrl)}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(email.cta_label || 'FCLの接続ページを開く')}</a></p></div>`
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
      detail_url: `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(match.id)}`,
      generation_source: email.source || 'unknown',
      ai_error: email.ai_error || null
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
  if (participant.archived_at || supporter.archived_at) return;

  const recipients = [
    { role: 'challenger', email: normalizeEmail(participant.email) },
    { role: 'supporter', email: normalizeEmail(supporter.email) }
  ];

  for (const recipient of recipients) {
    if (!recipient.email) {
      console.warn(`[email-worker] ${match.id} ${recipient.role}: no valid email; skipping`);
      continue;
    }
    if (await hasSent(match.id, recipient.role, recipient.email)) continue;

    const email = await generateEmail({ recipientRole: recipient.role, participant, supporter, matchId: match.id });
    const resend = await sendEmail({
      to: recipient.email,
      email,
      idempotencyKey: `fcl/connection_confirmed/${match.id}/${recipient.role}/${crypto.createHash('sha256').update(recipient.email).digest('hex').slice(0, 16)}`
    });
    await recordEmailSent({
      event,
      match,
      recipientRole: recipient.role,
      recipientEmail: recipient.email,
      email,
      resendId: resend?.id || null
    });
    console.log(`[email-worker] sent connection_confirmed to ${recipient.role} for match ${match.id} via ${email.source}`);
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

    const [participantResult, checkinResult, actionResult, reengagementResult] = await Promise.all([
      supabase
        .from('participants')
        .select('id,user_id,name,email,challenge,goal,created_at,archived_at')
        .is('archived_at', null)
        .limit(1000),
      supabase
        .from('checkins')
        .select('id,participant_id,checked_in_at,risk_score,risk_level')
        .order('checked_in_at', { ascending: false })
        .limit(5000),
      supabase
        .from('action_results')
        .select('id,participant_id,created_at,completed_at,completed')
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('model_learning_events')
        .select('participant_id,features,label,created_at')
        .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .limit(2000)
    ]);
    if (participantResult.error) throw participantResult.error;
    if (checkinResult.error) throw checkinResult.error;
    if (actionResult.error) throw actionResult.error;
    if (reengagementResult.error) throw reengagementResult.error;

    const latestCheckinByParticipant = new Map();
    for (const row of (checkinResult.data || [])) {
      if (!latestCheckinByParticipant.has(row.participant_id)) latestCheckinByParticipant.set(row.participant_id, row);
    }
    const latestActionByParticipant = new Map();
    for (const row of (actionResult.data || [])) {
      const at = row.completed_at || row.created_at;
      const previous = latestActionByParticipant.get(row.participant_id);
      if (!previous || new Date(at || 0) > new Date(previous.at || 0)) {
        latestActionByParticipant.set(row.participant_id, { ...row, at });
      }
    }

    const sentReengagement = new Set();
    for (const row of (reengagementResult.data || [])) {
      try {
        const features = row.features || {};
        const label = row.label || {};
        if (features.action_type !== 'reengagement_email_sent') continue;
        const key = label.dedupe_key || features.dedupe_key;
        if (key) sentReengagement.add(key);
      } catch {}
    }

    const byUser = new Map();
    for (const participant of (participantResult.data || [])) {
      const email = normalizeEmail(participant.email);
      if (!email || isTestEmail(email) || !participant.user_id) continue;
      const checkin = latestCheckinByParticipant.get(participant.id);
      const action = latestActionByParticipant.get(participant.id);
      const latestAt = [participant.created_at, checkin?.checked_in_at, action?.at]
        .filter(Boolean)
        .map(value => new Date(value))
        .filter(date => Number.isFinite(date.getTime()))
        .sort((a,b) => b.getTime() - a.getTime())[0] || null;
      const current = byUser.get(participant.user_id);
      if (!current || (latestAt && latestAt > current.latestAt)) {
        byUser.set(participant.user_id, { participant, checkin, action, latestAt });
      }
    }

    for (const { participant, checkin, action, latestAt } of byUser.values()) {
      if (!latestAt) continue;
      let trigger = '';
      let dedupeKey = '';
      let triggerMessage = '';

      const highRisk = checkin && (String(checkin.risk_level || '') === 'high' || Number(checkin.risk_score || 0) >= 70);
      const checkinAgeHours = checkin ? (Date.now() - new Date(checkin.checked_in_at || 0).getTime()) / 36e5 : Infinity;
      const latestActivityMs = latestAt.getTime();
      const inactivityDays = (Date.now() - latestActivityMs) / 86400000;

      if (highRisk && checkinAgeHours <= 24) {
        trigger = 'high_risk';
        dedupeKey = `high_risk:${participant.id}:${checkin.id}`;
        triggerMessage = '今日の記録から、少し立ち止まりやすいタイミングが見えています。大きく進めなくても大丈夫です。今の状態を確認して、次の一歩を小さく整理してみませんか。';
      } else if ((checkin || action) && inactivityDays >= 3 && inactivityDays < 14) {
        trigger = 'inactivity';
        const activityDay = new Date(latestAt.getTime()).toISOString().slice(0, 10);
        dedupeKey = `inactivity:${participant.id}:${activityDay}`;
        triggerMessage = '少し間が空きました。FCLでは、できた日だけでなく、止まった日や迷った日もそのまま記録できます。今の自分を確認するところから、もう一度始めてみませんか。';
      }

      if (!trigger || sentReengagement.has(dedupeKey)) continue;
      const token = createReengagementToken(participant.id);
      if (!token) continue;
      const resumeUrl = `${publicUrl}/api/reengagement/${encodeURIComponent(participant.id)}/continue?token=${encodeURIComponent(token)}`;
      const name = participant.name || 'さん';
      const email = {
        subject: trigger === 'high_risk'
          ? `FCL｜「${participant.challenge || '今の挑戦'}」をもう一度、一緒に整理しませんか`
          : `FCL｜「${participant.challenge || '今の挑戦'}」の続きを、ここから`,
        body: [
          name === 'さん' ? 'FCLをお使いの方へ' : `${name}さん`,
          '',
          triggerMessage,
          '',
          '【今、進めている挑戦】',
          `挑戦内容：${participant.challenge || '未登録'}`,
          `目標：${participant.goal || '未登録'}`,
          '',
          'FCLでは、今日の状態を記録すると、今の現在地と次の一歩を一緒に整理できます。',
          '',
          `FCLを再開する：${resumeUrl}`,
          '',
          'このメールは、FCLの利用がしばらく途切れたこと、または継続が難しくなりやすい状態が記録されたことをきっかけに送っています。',
          '心当たりがない場合は、このメールを無視してください。',
          '',
          'Future Challenge Lab'
        ].join('\n'),
        resumeUrl,
        detailUrl: resumeUrl,
        cta_label: 'FCLを再開する'
      };
      const resend = await sendEmail({
        to: normalizeEmail(participant.email),
        email,
        idempotencyKey: `fcl/reengagement/${dedupeKey}`
      });
      await supabase.from('model_learning_events').insert({
        participant_id: participant.id,
        features: {
          action_type: 'reengagement_email_sent',
          trigger,
          dedupe_key: dedupeKey,
          recipient: participant.email
        },
        label: {
          email_type: 'reengagement',
          subject: email.subject,
          resend_id: resend?.id || null
        },
        created_at: new Date().toISOString()
      });
      sentReengagement.add(dedupeKey);
      console.log(`[email-worker] sent reengagement email for participant ${participant.id} trigger=${trigger} via ${email.source || 'fallback'}`);
    }

    const { data: events, error } = await supabase
      .from('connection_events')
      .select('*')
      .eq('event_type', 'connection_confirmed')
      .gte('created_at', new Date(Date.now() - emailEventLookbackMs).toISOString())
      .order('created_at', { ascending: true })
      .limit(100);
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

console.log(`[email-worker] started; poll=${pollMs}ms model=${model} lookback_ms=${emailEventLookbackMs}`);
await poll();
setInterval(poll, pollMs);
