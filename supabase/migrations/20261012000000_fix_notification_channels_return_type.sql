-- ===========================================================================
-- 20261012: Fix notification_channels_for return type.
--
-- 20261006000000 declared RETURNS text[] but the body was
--   SELECT c.channel ... (setof text), so `supabase db reset` failed with:
--   ERROR: return type mismatch in function declared to return text[]
-- This re-declares it to actually aggregate to text[], returning '{}' when
-- no channel is opted in (transactional fallback is in-app only).
-- Idempotent / safe to re-apply. Also repairs databases created from the
-- pre-fix 20261006000000 body.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notification_channels_for(_user uuid, _template text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(c.channel ORDER BY c.channel), '{}'::text[])
  FROM (VALUES ('email'), ('sms'), ('whatsapp')) AS c(channel)
  LEFT JOIN public.notification_preferences p ON p.user_id = _user
  WHERE CASE c.channel
    WHEN 'email' THEN
      CASE WHEN _template = 'weekly_digest'
        THEN coalesce(p.email_digest, false)
        ELSE coalesce(p.email_alerts, true)
      END
    WHEN 'sms' THEN _template <> 'weekly_digest' AND coalesce(p.sms_alerts, false)
    WHEN 'whatsapp' THEN _template <> 'weekly_digest' AND coalesce(p.whatsapp_alerts, false)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) TO authenticated, service_role;
