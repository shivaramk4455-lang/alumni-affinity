REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, full_name, gender, birth_year, city, institution, degree, grad_year,
  profession, employer, relocation, values_statement, bio,
  is_visible, onboarded, created_at, updated_at,
  photo_path, photo_visibility, verification_status
) ON public.profiles TO authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  full_name, gender, birth_year, city, institution, degree, grad_year,
  profession, employer, relocation, values_statement, bio,
  is_visible, onboarded, photo_path, photo_visibility, verification_status,
  alumni_email, contact_phone, linkedin_url, verification_doc_path
) ON public.profiles TO authenticated;
CREATE OR REPLACE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT
    p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin
  FROM public.profiles p
  WHERE p.id = auth.uid();
REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reveal_contact(_profile uuid)
RETURNS TABLE (profile_id uuid, contact_phone text, linkedin_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.contact_phone, p.linkedin_url
  FROM public.profiles p
  WHERE p.id = _profile
    AND p.id <> auth.uid()
    AND private.has_accepted_interest(p.id, auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.reveal_contacts(_profiles uuid[])
RETURNS TABLE (profile_id uuid, contact_phone text, linkedin_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.contact_phone, p.linkedin_url
  FROM public.profiles p
  WHERE p.id = ANY(_profiles)
    AND p.id <> auth.uid()
    AND private.has_accepted_interest(p.id, auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.reveal_contact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.desk_review_queue()
RETURNS TABLE (
  id uuid, full_name text, institution text, degree text, grad_year int, city text,
  alumni_email text, verification_doc_path text, photo_path text,
  verification_status text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.institution, p.degree, p.grad_year, p.city,
           p.alumni_email, p.verification_doc_path, p.photo_path,
           p.verification_status, p.created_at
    FROM public.profiles p
    WHERE p.verification_status = 'pending_review'
    ORDER BY p.created_at;
END; $$;
CREATE OR REPLACE FUNCTION public.desk_reports(_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid, reason text, created_at timestamptz,
  reporter_id uuid, reporter_name text,
  reported_profile_id uuid, reported_name text, reported_visible boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.reason, r.created_at,
           r.reporter_id, coalesce(rp.full_name, 'Member'),
           r.reported_profile_id, coalesce(tp.full_name, 'Member'),
           coalesce(tp.is_visible, false)
    FROM public.reports r
    LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.id = r.reported_profile_id
    ORDER BY r.created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 200), 500));
END; $$;
REVOKE EXECUTE ON FUNCTION public.desk_review_queue() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desk_reports(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_review_queue() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.desk_reports(int) TO authenticated, service_role;