ALTER TABLE public.fcl_users
  ADD COLUMN IF NOT EXISTS account_disabled_at timestamptz;

COMMENT ON COLUMN public.fcl_users.account_disabled_at
  IS 'FCLメール登録解除・ログイン停止日時。設定されるとメール認証と既存セッションによるログインを無効化する。';

CREATE OR REPLACE FUNCTION public.fcl_unregister_user(
  target_user_id uuid,
  target_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
  redacted_email text;
  participant_count integer := 0;
  supporter_count integer := 0;
  event_count integer := 0;
BEGIN
  SELECT email
    INTO current_email
  FROM public.fcl_users
  WHERE id = target_user_id
    AND account_disabled_at IS NULL
  FOR UPDATE;

  IF current_email IS NULL THEN
    RAISE EXCEPTION 'FCL user not found or already disabled';
  END IF;

  IF lower(trim(coalesce(target_email, ''))) <> lower(trim(current_email)) THEN
    RAISE EXCEPTION 'email confirmation does not match';
  END IF;

  UPDATE public.participants
     SET email = NULL,
         archived_at = COALESCE(archived_at, now())
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS participant_count = ROW_COUNT;

  UPDATE public.supporters
     SET email = NULL,
         active = false,
         archived_at = COALESCE(archived_at, now())
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS supporter_count = ROW_COUNT;

  UPDATE public.email_events
     SET recipient = '[email removed]',
         metadata = replace(metadata::text, current_email, '[email removed]')::jsonb
   WHERE recipient = current_email;
  GET DIAGNOSTICS event_count = ROW_COUNT;

  UPDATE public.connection_events
     SET note = replace(note, current_email, '[email removed]')
   WHERE note IS NOT NULL
     AND position(current_email in note) > 0;

  UPDATE public.model_learning_events
     SET features = replace(features::text, current_email, '[email removed]')::jsonb,
         label = replace(label::text, current_email, '[email removed]')::jsonb
   WHERE position(current_email in features::text) > 0
      OR position(current_email in label::text) > 0;

  redacted_email := 'removed+' || replace(target_user_id::text, '-', '') || '@fcl.invalid';

  UPDATE public.fcl_users
     SET email = redacted_email,
         email_normalized = redacted_email,
         account_disabled_at = now(),
         auth_code_hash = NULL,
         auth_code_expires_at = NULL,
         auth_code_sent_at = NULL,
         auth_code_attempts = 0,
         updated_at = now()
   WHERE id = target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'participant_count', participant_count,
    'supporter_count', supporter_count,
    'email_event_count', event_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fcl_unregister_user(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fcl_unregister_user(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fcl_unregister_user(uuid, text) TO service_role;
