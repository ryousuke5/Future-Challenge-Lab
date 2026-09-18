import express from 'express';
import { createClient } from '@supabase/supabase-js';

const originalPost = express.application.post;
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function getOrCreateFclUser(email) {
  const normalized = normalizeEmail(email);
  const { data, error } = await supabase
    .from('fcl_users')
    .upsert(
      { email: normalized, email_normalized: normalized, updated_at: new Date().toISOString() },
      { onConflict: 'email_normalized' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function registerWithStableParticipantId(req, res, fallbackHandlers) {
  if (!supabase) {
    return originalPost.call(req.app, '/api/participants', ...fallbackHandlers);
  }

  void (async () => {
    try {
      const body = req.body || {};
      const email = normalizeEmail(body.email);

      if (!email) {
        return originalPost.call(req.app, '/api/participants', ...fallbackHandlers);
      }

      const fclUser = await getOrCreateFclUser(email);

      const { data: existingRows, error: existingError } = await supabase
        .from('participants')
        .select('*')
        .ilike('email', email);

      if (existingError) throw existingError;

      if (existingRows?.length) {
        const ids = existingRows.map(row => row.id);
        const [{ data: checkinRows, error: checkinError }, { data: actionRows, error: actionError }] = await Promise.all([
          supabase.from('checkins').select('participant_id').in('participant_id', ids),
          supabase.from('action_results').select('participant_id').in('participant_id', ids)
        ]);

        if (checkinError) throw checkinError;
        if (actionError) throw actionError;

        const history = new Map(ids.map(id => [id, { checkins: 0, actions: 0 }]));
        for (const row of checkinRows || []) {
          const entry = history.get(row.participant_id);
          if (entry) entry.checkins += 1;
        }
        for (const row of actionRows || []) {
          const entry = history.get(row.participant_id);
          if (entry) entry.actions += 1;
        }

        // Keep the participant ID attached to the richest existing history.
        const canonical = [...existingRows].sort((a, b) => {
          const ac = history.get(a.id) || { checkins: 0, actions: 0 };
          const bc = history.get(b.id) || { checkins: 0, actions: 0 };
          if (bc.checkins !== ac.checkins) return bc.checkins - ac.checkins;
          if (bc.actions !== ac.actions) return bc.actions - ac.actions;
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        })[0];

        const patch = {
          name: String(body.name ?? '').trim() || canonical.name || '',
          email,
          user_id: fclUser.id,
          challenge: String(body.challenge ?? '').trim() || canonical.challenge || '',
          goal: String(body.goal ?? '').trim() || canonical.goal || ''
        };

        const { data: updated, error: updateError } = await supabase
          .from('participants')
          .update(patch)
          .eq('id', canonical.id)
          .select()
          .single();

        if (updateError) throw updateError;
        return res.json({ ...updated, user_id: fclUser.id, reused_existing_id: true });
      }

      const { data: created, error: createError } = await supabase
        .from('participants')
        .insert({
          external_user_id: String(body.external_user_id || `web-${Date.now()}`),
          name: String(body.name ?? '').trim(),
          email,
          challenge: String(body.challenge ?? '').trim(),
          goal: String(body.goal ?? '').trim()
        })
        .select()
        .single();

      if (createError) throw createError;
      return res.json({ ...created, user_id: fclUser.id, reused_existing_id: false });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'participant registration failed' });
    }
  })();
}

express.application.post = function patchedPost(path, ...handlers) {
  if (path === '/api/participants') {
    return originalPost.call(this, path, (req, res) => registerWithStableParticipantId(req, res, handlers));
  }
  return originalPost.call(this, path, ...handlers);
};
