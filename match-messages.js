import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FCL_FROM_EMAIL;
const publicUrl = (process.env.FCL_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function createAccessToken(matchId, role) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return '';
  const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  const payload = base64Url(JSON.stringify({ match_id: matchId, role, iat: Math.floor(Date.now() / 1000), exp: expiresAt }));
  const signature = crypto
    .createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAccessToken(token, matchId) {
  if (!token || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(payload)
    .digest('base64url');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.match_id !== matchId) return null;
    if (!['challenger', 'supporter'].includes(parsed.role)) return null;
    // New tokens expire after 30 days. Legacy tokens without exp remain accepted
    // so existing emailed links are not invalidated by this deployment.
    if (parsed.exp !== undefined && (!Number.isFinite(Number(parsed.exp)) || Number(parsed.exp) <= Math.floor(Date.now() / 1000))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadMatch(matchId) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('supporter_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data;
}

function isConnectedMatch(match){
  if(!match) return false;
  if(String(match.status||'')==='connected') return true;
  const approvals=match?.meta?.approvals || {};
  const challengerApproved=Boolean(match.challenger_approved_at) || Boolean(approvals.challenger);
  const supporterApproved=Boolean(match.supporter_approved_at) || Boolean(approvals.supporter);
  return challengerApproved && supporterApproved;
}

async function authorize(matchId, token) {
  const auth = verifyAccessToken(token, matchId);
  if (!auth) return { error: 'invalid access token' };

  const match = await loadMatch(matchId);
  if (!match) return { error: 'match not found' };
  if (!isConnectedMatch(match)) return { error: 'message thread is available only after connection is established' };

  const expectedSenderId = auth.role === 'challenger' ? match.participant_id : match.supporter_id;
  if (!expectedSenderId) return { error: 'sender identity not found' };

  return { auth, match, senderId: expectedSenderId };
}

async function sendMessageNotification({ match, senderRole, body }) {
  if (!supabase || !resendApiKey || !fromEmail) return null;

  const [participantResult, supporterResult] = await Promise.all([
    supabase.from('participants').select('*').eq('id', match.participant_id).maybeSingle(),
    supabase.from('supporters').select('*').eq('id', match.supporter_id).maybeSingle()
  ]);

  if (participantResult.error) throw participantResult.error;
  if (supporterResult.error) throw supporterResult.error;

  const participant = participantResult.data;
  const supporter = supporterResult.data;
  const recipientRole = senderRole === 'challenger' ? 'supporter' : 'challenger';
  const recipientEmail = recipientRole === 'challenger' ? participant?.email : supporter?.email;
  const normalizedEmail = String(recipientEmail || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return null;

  const recipientName = recipientRole === 'challenger'
    ? (participant?.name || '挑戦者')
    : (supporter?.supporter_name || '支援者');
  const senderLabel = senderRole === 'challenger' ? '挑戦者' : '支援者';
  const token = createAccessToken(match.id, recipientRole);
  const link = `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(match.id)}&token=${encodeURIComponent(token)}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
      'Idempotency-Key': `fcl/message_notification/${match.id}/${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [normalizedEmail],
      subject: 'FCL｜新しいメッセージが届いています',
      text: `${recipientName}さん\n\nFCLの支援接続ページに新しいメッセージが届いています。\n\n送信者：${senderLabel}\n\n${body}\n\nメッセージを確認：${link}\n\nFuture Challenge Lab`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><p>${escapeHtml(recipientName)}さん</p><p>FCLの支援接続ページに新しいメッセージが届いています。</p><p><strong>送信者：</strong>${escapeHtml(senderLabel)}</p><blockquote style="margin:12px 0;padding-left:12px;border-left:3px solid #ccc">${escapeHtml(body).replaceAll('\n','<br>')}</blockquote><p><a href="${escapeHtml(link)}">FCLでメッセージを確認する</a></p><p>Future Challenge Lab</p></div>`
    })
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Resend ${response.status}: ${responseText}`);

  let result = {};
  try { result = JSON.parse(responseText); } catch { /* ignore malformed success payload */ }
  return result?.id || null;
}

export function registerMatchMessageRoutes(app) {
  if (!app || !supabase) return;

  // One-shot operational test for the reciprocal email notification path.
  // Disabled unless FCL_EMAIL_TEST_TOKEN is configured on the server.
  app.get('/api/test/message-notification', async (req, res) => {
    try {
      const configuredToken = String(process.env.FCL_EMAIL_TEST_TOKEN || '');
      if (!configuredToken || String(req.query?.token || '') !== configuredToken) {
        return res.status(404).json({ error: 'not found' });
      }
      const matchId = String(req.query?.match_id || '');
      if (!matchId) return res.status(400).json({ error: 'match_id is required' });

      const match = await loadMatch(matchId);
      if (!match) return res.status(404).json({ error: 'match not found' });
      if (String(match.status) !== 'connected') return res.status(409).json({ error: 'match is not connected' });

      const testBody = 'FCLメール通知テスト：支援者からの返信通知が届くか確認しています。';
      const messageId = crypto.randomUUID();
      const { error: insertError } = await supabase.from('match_messages').insert({
        id: messageId,
        match_id: match.id,
        sender_role: 'supporter',
        sender_id: match.supporter_id,
        body: testBody,
        created_at: new Date().toISOString()
      });
      if (insertError) throw insertError;

      const resendId = await sendMessageNotification({ match, senderRole: 'supporter', body: testBody });
      return res.json({ ok: true, match_id: match.id, message_id: messageId, resend_id: resendId, test_body: testBody });
    } catch (error) {
      console.error('[match-messages] operational email test failed', error);
      return res.status(500).json({ error: error.message || 'operational email test failed' });
    }
  });

  app.get('/api/matches/:id/messages', async (req, res) => {
    try {
      const authz = await authorize(req.params.id, req.query?.token);
      if (authz.error === 'match not found') return res.status(404).json({ error: authz.error });
      if (authz.error) return res.status(401).json({ error: authz.error });

      const { data: messages, error } = await supabase
        .from('match_messages')
        .select('id, match_id, sender_role, sender_id, body, created_at')
        .eq('match_id', req.params.id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      res.json({
        ok: true,
        match_id: req.params.id,
        viewer_role: authz.auth.role,
        viewer_id: authz.senderId,
        messages: messages || []
      });
    } catch (error) {
      console.error('[match-messages] load failed', error);
      res.status(500).json({ error: error.message || 'message load failed' });
    }
  });

  app.post('/api/matches/:id/messages', async (req, res) => {
    try {
      const authz = await authorize(req.params.id, req.body?.token);
      if (authz.error === 'match not found') return res.status(404).json({ error: authz.error });
      if (authz.error) return res.status(401).json({ error: authz.error });

      const body = String(req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'message is empty' });
      if (body.length > 4000) return res.status(400).json({ error: 'message is too long (max 4000 characters)' });

      const { data: message, error } = await supabase
        .from('match_messages')
        .insert({
          match_id: authz.match.id,
          sender_role: authz.auth.role,
          sender_id: authz.senderId,
          body
        })
        .select('id, match_id, sender_role, sender_id, body, created_at')
        .single();
      if (error) throw error;

      await supabase.from('connection_events').insert({
        participant_id: authz.match.participant_id,
        supporter_id: authz.match.supporter_id,
        match_id: authz.match.id,
        event_type: 'message_sent',
        note: JSON.stringify({ sender_role: authz.auth.role, message_id: message.id }),
        created_at: new Date().toISOString()
      });

      let notificationEmailId = null;
      let notificationStatus = 'skipped';
      let notificationError = null;
      try {
        notificationEmailId = await sendMessageNotification({
          match: authz.match,
          senderRole: authz.auth.role,
          body
        });
        notificationStatus = notificationEmailId ? 'sent' : 'skipped';
        await supabase.from('connection_events').insert({
          participant_id: authz.match.participant_id,
          supporter_id: authz.match.supporter_id,
          match_id: authz.match.id,
          event_type: notificationEmailId ? 'message_email_sent' : 'message_email_skipped',
          note: JSON.stringify({
            sender_role: authz.auth.role,
            recipient_role: authz.auth.role === 'challenger' ? 'supporter' : 'challenger',
            message_id: message.id,
            resend_id: notificationEmailId
          }),
          created_at: new Date().toISOString()
        });
      } catch (emailError) {
        notificationStatus = 'failed';
        notificationError = emailError?.message || String(emailError);
        console.error('[match-messages] notification email failed', notificationError);
        await supabase.from('connection_events').insert({
          participant_id: authz.match.participant_id,
          supporter_id: authz.match.supporter_id,
          match_id: authz.match.id,
          event_type: 'message_email_failed',
          note: JSON.stringify({
            sender_role: authz.auth.role,
            recipient_role: authz.auth.role === 'challenger' ? 'supporter' : 'challenger',
            message_id: message.id,
            error: notificationError
          }),
          created_at: new Date().toISOString()
        });
      }

      res.status(201).json({
        ok: true,
        message,
        notification_email_id: notificationEmailId,
        notification_status: notificationStatus,
        notification_error: notificationError
      });
    } catch (error) {
      console.error('[match-messages] send failed', error);
      res.status(500).json({ error: error.message || 'message send failed' });
    }
  });
}

export { createAccessToken, verifyAccessToken };
