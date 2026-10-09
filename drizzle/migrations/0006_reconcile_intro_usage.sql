CREATE OR REPLACE FUNCTION public.count_intro_usage(_user uuid)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int := 0;
BEGIN
  IF _user IS NULL THEN RETURN 0; END IF;
  SELECT count(*) INTO _n
  FROM public.interests i
  JOIN public.subscriptions s ON s.user_id = _user AND s.status IN ('authenticated','active','pending')
  WHERE i.sender_id = _user AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days');
  RETURN coalesce(_n, 0);
END; $$;
REVOKE EXECUTE ON FUNCTION public.count_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_intro_usage(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mirror_intro_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT ((TG_OP = 'INSERT' AND NEW.status = 'pending')
    OR (TG_OP = 'UPDATE' AND OLD.status IN ('declined','withdrawn','expired') AND NEW.status = 'pending')) THEN
    RETURN NEW;
  END IF;
  SELECT id INTO _sub FROM public.subscriptions
  WHERE user_id = NEW.sender_id AND status IN ('authenticated','active','pending')
  ORDER BY array_position(ARRAY['active','authenticated','pending'], status), created_at DESC LIMIT 1;
  IF _sub IS NOT NULL THEN
    UPDATE public.subscriptions SET requests_used = public.count_intro_usage(NEW.sender_id), updated_at = now() WHERE id = _sub;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS interests_mirror_usage ON public.interests;
CREATE TRIGGER interests_mirror_usage AFTER INSERT OR UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.mirror_intro_usage();

CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT id INTO _sub FROM public.subscriptions
  WHERE user_id = _user AND status IN ('authenticated','active','pending')
  ORDER BY array_position(ARRAY['active','authenticated','pending'], status), created_at DESC LIMIT 1;
  IF _sub IS NULL THEN RETURN; END IF;
  UPDATE public.subscriptions SET requests_used = public.count_intro_usage(_user), updated_at = now() WHERE id = _sub;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intro_usage(uuid) TO service_role;

UPDATE public.subscriptions s SET requests_used = public.count_intro_usage(s.user_id), updated_at = now()
WHERE s.status IN ('authenticated','active','pending');