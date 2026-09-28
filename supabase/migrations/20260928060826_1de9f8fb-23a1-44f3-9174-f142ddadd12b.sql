CREATE OR REPLACE FUNCTION private.is_active_copilot(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.copilots c
    JOIN public.profiles cand ON cand.id = c.candidate_id
    WHERE c.copilot_user_id = _user AND c.status = 'active' AND cand.verification_status = 'verified'
  )
$$;
REVOKE EXECUTE ON FUNCTION private.is_active_copilot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_copilot(uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS "Verified members read the directory" ON public.profiles;
DROP POLICY IF EXISTS "Verified members and copilots read the directory" ON public.profiles;
CREATE POLICY "Verified members and copilots read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (onboarded AND is_visible AND verification_status = 'verified'
    AND (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid())));
DROP POLICY IF EXISTS "Photo read by permitted members" ON storage.objects;
CREATE POLICY "Photo read by permitted members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id::text = (storage.foldername(name))[1]
            AND p.onboarded AND p.is_visible
            AND (p.photo_visibility = 'all_members' OR private.has_accepted_interest(p.id, auth.uid()))
        )
      )
    )
  );
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS height_cm integer CHECK (height_cm IS NULL OR (height_cm BETWEEN 120 AND 230)),
  ADD COLUMN IF NOT EXISTS marital_status text DEFAULT 'Never married',
  ADD COLUMN IF NOT EXISTS diet text DEFAULT 'Vegetarian',
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  ADD COLUMN IF NOT EXISTS residency_status text DEFAULT 'India';
GRANT SELECT (height_cm, marital_status, diet, mother_tongue, residency_status) ON public.profiles TO authenticated;
GRANT UPDATE (height_cm, marital_status, diet, mother_tongue, residency_status) ON public.profiles TO authenticated;
DROP VIEW IF EXISTS public.my_profile;
CREATE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin,
    p.height_cm, p.marital_status, p.diet, p.mother_tongue, p.residency_status
  FROM public.profiles p WHERE p.id = auth.uid();
REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;