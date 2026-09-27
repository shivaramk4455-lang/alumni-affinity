CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_copilot_of(_candidate uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.copilots c
    WHERE c.candidate_id = _candidate AND c.copilot_user_id = _user AND c.status = 'active'
  )
$$;
REVOKE EXECUTE ON FUNCTION private.is_copilot_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_copilot_of(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_accepted_interest(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.interests i
    WHERE i.status = 'accepted'
      AND ((i.sender_id = _a AND i.recipient_id = _b) OR (i.sender_id = _b AND i.recipient_id = _a))
  )
$$;
REVOKE EXECUTE ON FUNCTION private.has_accepted_interest(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_accepted_interest(uuid, uuid) TO authenticated, service_role;

DROP POLICY "Read own interests" ON public.interests;
CREATE POLICY "Read own interests" ON public.interests FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id
         OR private.is_copilot_of(sender_id, auth.uid())
         OR private.is_copilot_of(recipient_id, auth.uid()));

DROP POLICY "Candidate and copilot read recommendations" ON public.copilot_recommendations;
CREATE POLICY "Candidate and copilot read recommendations" ON public.copilot_recommendations FOR SELECT TO authenticated
  USING (auth.uid() = candidate_id OR private.is_copilot_of(candidate_id, auth.uid()));

DROP POLICY "Copilot adds recommendations" ON public.copilot_recommendations;
CREATE POLICY "Copilot adds recommendations" ON public.copilot_recommendations FOR INSERT TO authenticated
  WITH CHECK (private.is_copilot_of(candidate_id, auth.uid())
              AND copilot_id IN (SELECT id FROM public.copilots WHERE copilot_user_id = auth.uid() AND status = 'active'));

DROP POLICY "Copilot reads candidate profile" ON public.profiles;
CREATE POLICY "Copilot reads candidate profile" ON public.profiles FOR SELECT TO authenticated
  USING (private.is_copilot_of(id, auth.uid()));

DROP FUNCTION IF EXISTS public.is_copilot_of(uuid, uuid);
DROP FUNCTION IF EXISTS public.has_accepted_interest(uuid, uuid);