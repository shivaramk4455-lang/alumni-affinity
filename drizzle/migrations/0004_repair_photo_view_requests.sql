CREATE OR REPLACE FUNCTION public.guard_photo_request_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.requester_id IS DISTINCT FROM OLD.requester_id
          OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'A photograph request cannot be re-pointed at another pair' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS photo_view_requests_freeze_pair ON public.photo_view_requests;
CREATE TRIGGER photo_view_requests_freeze_pair
  BEFORE UPDATE ON public.photo_view_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_photo_request_pair();
DROP POLICY IF EXISTS "Owner decides incoming photo requests" ON public.photo_view_requests;
CREATE POLICY "Owner decides incoming photo requests" ON public.photo_view_requests
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND status IN ('accepted', 'declined', 'revoked'));