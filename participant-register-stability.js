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

      const challenge = String(body.challenge ?? '').trim();
      const goal = String(body.goal ?? '').trim();
      const name = String(body.name ?? '').trim();
      const fclUser = await getOrCreateFclUser(email);

      // Keep one stable participant ID for the same challenge+goal,
      // but allow the same FCL user to register multiple different challenges.
      const { data: existingRows, error: existingError } = await supabase
        .from('participants')
        .select('*')
        .eq('user_id', fclUser.id)
        .is('archived_at', null);

      if (existingError) throw existingError;

      const duplicates = (existingRows || []).filter(row =>
        String(row.challenge || '').trim() === challenge &&
        String(row.goal || '').trim() === goal
      );

      if (duplicates.length) {
        const ids = duplicates.map(row => row.id);
        const [{ data: checkinRows, error: checkinError }, { data: actionRows, error: actionError }] = await Promise.all([
          supabase.from('checkins').select('participant_id').in('participant_id', ids),
          supabase.from('action_results').select('participant_id').in('participant_id', ids)
        ]);
        if (checkinError) throw checkinError;
        if (actionError) throw actionError;

        const history = new Map(ids.map(id => [id, { checkins: 0, actions: 0 }]));
        for (const row of checkinRows || []) history.get(row.participant_id)?.checkins++;
        for (const row of actionRows || []) history.get(row.participant_id)?.actions++;

        const canonical = [...duplicates].sort((a, b) => {
          const ac = history.get(a.id) || { checkins: 0, actions: 0 };
          const bc = history.get(b.id) || { checkins: 0, actions: 0 };
          if (bc.checkins !== ac.checkins) return bc.checkins - ac.checkins;
          if (bc.actions !== ac.actions) return bc.actions - ac.actions;
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        })[0];

        const patch = {
          name: name || canonical.name || '',
          email,
          user_id: fclUser.id,
          challenge,
          goal
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
          user_id: fclUser.id,
          external_user_id: String(body.external_user_id || `web-${Date.now()}`),
          name,
          email,
          challenge,
          goal
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
