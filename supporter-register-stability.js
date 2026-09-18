import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { registerMatchMessageRoutes } from './match-messages.js';

const originalPost = express.application.post;
const originalListen = express.application.listen;
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function registerWithStableSupporterId(req, res, fallbackHandlers) {
  if (!supabase) {
    return fallbackHandlers[0]?.(req, res);
  }

  void (async () => {
    try {
      const body = req.body || {};
      const email = normalizeEmail(body.email);

      // Without an email address there is no stable identity key yet.
      if (!email) {
        return fallbackHandlers[0]?.(req, res);
      }

      const fclUser = await getOrCreateFclUser(email);

      const { data: existingRows, error: existingError } = await supabase
        .from('supporters')
        .select('*')
        .ilike('email', email);

      if (existingError) throw existingError;

      if (existingRows?.length) {
        // Reuse the existing supporter record that has the strongest history.
        // This preserves the ID already referenced by past matches/outcomes.
        const ids = existingRows.map(row => row.id);
        const { data: matchRows, error: matchError } = await supabase
          .from('supporter_matches')
          .select('supporter_id')
          .in('supporter_id', ids);

        if (matchError) throw matchError;

        const matchCounts = new Map(ids.map(id => [id, 0]));
        for (const row of matchRows || []) {
          matchCounts.set(row.supporter_id, (matchCounts.get(row.supporter_id) || 0) + 1);
        }

        const canonical = [...existingRows].sort((a, b) => {
          const matchDiff = (matchCounts.get(b.id) || 0) - (matchCounts.get(a.id) || 0);
          if (matchDiff !== 0) return matchDiff;
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        })[0];

        const patch = {
          organization_name: String(body.organization_name ?? '').trim() || canonical.organization_name || 'FCL',
          supporter_name: String(body.supporter_name ?? '').trim() || canonical.supporter_name || '支援者',
          email,
          user_id: fclUser.id,
          support_category: String(body.support_category ?? '').trim() || canonical.support_category || '未設定',
          strengths: asArray(body.strengths).length ? asArray(body.strengths) : (canonical.strengths || []),
          timing_tags: asArray(body.timing_tags).length ? asArray(body.timing_tags) : (canonical.timing_tags || []),
          description: String(body.description ?? '').trim() || canonical.description || '',
          active: true
        };

        const { data: updated, error: updateError } = await supabase
          .from('supporters')
          .update(patch)
          .eq('id', canonical.id)
          .select()
          .single();

        if (updateError) throw updateError;
        return res.json({ ...updated, user_id: fclUser.id, reused_existing_id: true });
      }

      const { data: created, error: createError } = await supabase
        .from('supporters')
        .insert({
          organization_name: String(body.organization_name ?? '').trim() || 'FCL',
          supporter_name: String(body.supporter_name ?? '').trim() || '支援者',
          email,
          support_category: String(body.support_category ?? '').trim() || '未設定',
          strengths: asArray(body.strengths),
          timing_tags: asArray(body.timing_tags),
          description: String(body.description ?? '').trim(),
          active: true
        })
        .select()
        .single();

      if (createError) throw createError;
      return res.json({ ...created, user_id: fclUser.id, reused_existing_id: false });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'supporter registration failed' });
    }
  })();
}

express.application.post = function patchedPost(path, ...handlers) {
  if (path === '/api/supporters/register') {
    return originalPost.call(this, path, (req, res) => registerWithStableSupporterId(req, res, handlers));
  }
  return originalPost.call(this, path, ...handlers);
};

express.application.listen = function patchedListen(...args) {
  if (!this.__fclMatchMessagesRegistered) {
    registerMatchMessageRoutes(this);
    this.__fclMatchMessagesRegistered = true;
  }
  return originalListen.apply(this, args);
};
