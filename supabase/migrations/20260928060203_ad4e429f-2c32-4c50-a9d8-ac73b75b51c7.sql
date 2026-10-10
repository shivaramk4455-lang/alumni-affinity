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
-- Retroactive-apply safety (matches this project's DROP-first convention):
-- on databases where later migrations already widened this view, plain
-- OR REPLACE would refuse to drop columns (SQLSTATE 42P16).
DROP VIEW IF EXISTS public.my_profile;
CREATE VIEW public.my_profile WITH (security_invoker = false) AS
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
-- Retroactive-apply safety (same DROP-first rule as the my_profile view
-- above): 20261005000000_access_audit.sql (already applied on this database)
-- converted these to VOLATILE plpgsql bodies, so plain OR REPLACE here trips
-- SQLSTATE 42P13. Rebuilding via DROP-first is safe because both overloads are
-- re-created immediately below with identical signatures.
DROP FUNCTION IF EXISTS public.reveal_contact(uuid);
DROP FUNCTION IF EXISTS public.reveal_contacts(uuid[]);
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
-- Retroactive-apply safety (matches the project's DROP-first convention):
-- 20261016000000_desk_queue_paging.sql (already applied on this database)
-- replaced the zero-arg desk_review_queue() with a paged two-arg overload,
-- so re-creating the zero-arg shape via OR REPLACE trips SQLSTATE 42P13.
-- The old file is pure history: drop WITHOUT recreating the dead overload;
-- the current two-arg version stays untouched. Dropping the dead overload is
-- a no-op (nothing calls it), and recreating the historic shape on top of the
-- paged database would actively downgrade the desk queue. This keeps the
-- retroactive insert from firing on every remaining historical file.
DROP FUNCTION IF EXISTS public.desk_review_queue();
-- Retroactive-apply safety (same DROP-first rule): 20261011000000
-- (already applied on this database) later widens the reporter desk return
-- shape, so re-creating the historic shape via OR REPLACE trips 42P13.
-- The wider shape is re-created by the already-applied file; this historic
-- block drops-first so the retroactive insert does not error.
DROP FUNCTION IF EXISTS public.desk_reports(int);
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
-- Zero-arg desk_review_queue(): no longer re-created here (see the
-- retroactive-apply note above); only the still-current functions below
-- get their privilege grants. Granting privileges on the dropped overload
-- would raise SQLSTATE 42883 on this database (the old overload no longer
-- exists here once dropped), while skipping the GRANT is harmless.
REVOKE EXECUTE ON FUNCTION public.desk_reports(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_reports(int) TO authenticated, service_role;