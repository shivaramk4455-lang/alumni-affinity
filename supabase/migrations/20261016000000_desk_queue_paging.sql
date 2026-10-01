-- ===========================================================================
-- 20261016: Page the membership desk review queue.
--
-- desk_review_queue() took no arguments and returned every row whose
-- verification_status = 'pending_review', ordered by created_at with no LIMIT.
-- The desk page renders one row per application, and each row mounts a
-- <MemberPhoto>, which issues its own createSignedUrl() request with a
-- 300-second TTL. On a busy weekend that meant the browser opened hundreds of
-- image requests against the private storage bucket just to review a dozen
-- applications, and every one of those URLs was minted whether or not the
-- operator ever scrolled to the row.
--
-- Signatures: CREATE OR REPLACE cannot change a function's argument list, and
-- the return type must match to preserve existing GRANTs. So the zero-arg
-- overload is dropped and recreated as _limit/_offset, and both are given a
-- default so the old zero-arg call shape keeps working for any caller we have
-- not found. The client passes explicit values.
--
-- A hard ceiling is enforced server-side as well: a desk operator asking for
-- 100000 rows gets _limit_max, not the whole table. The cap is the security
-- property here — without it the RPC remains an unbounded fan-out regardless of
-- what the browser asks for.
-- ===========================================================================

-- Drop the zero-arg overload so the new signature does not sit beside it.
-- Verified no other migration or function body calls desk_review_queue.
DROP FUNCTION IF EXISTS public.desk_review_queue();

CREATE OR REPLACE FUNCTION public.desk_review_queue(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, full_name text, institution text, degree text, grad_year int, city text,
  alumni_email text, verification_doc_path text, photo_path text,
  verification_status text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Defensive: never trust the caller's arithmetic.
  _limit_max constant int := 200;
  _from int;
  _take int;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;

  _from := greatest(coalesce(_offset, 0), 0);
  _take := LEAST(greatest(coalesce(_limit, 0), 1), _limit_max);

  RETURN QUERY
    SELECT p.id, p.full_name, p.institution, p.degree, p.grad_year, p.city,
           p.alumni_email, p.verification_doc_path, p.photo_path,
           p.verification_status, p.created_at
    FROM public.profiles p
    WHERE p.verification_status = 'pending_review'
    ORDER BY p.created_at, p.id
    LIMIT _take OFFSET _from;
END; $$;

REVOKE EXECUTE ON FUNCTION public.desk_review_queue(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_review_queue(int, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Regression assertions. Each must hold in the shipped body; a future rewrite
-- that drops the guard fails at migrate time rather than in production.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _body text;
  _args text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _body
  FROM pg_proc WHERE proname = 'desk_review_queue' AND pronamespace = 'public'::regnamespace;

  IF _body IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() is missing';
  END IF;
  IF _body NOT LIKE '%private.is_admin()%' THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() lost its admin guard';
  END IF;
  IF _body NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() must refuse non-desk callers';
  END IF;
  IF _body NOT LIKE '%LIMIT%OFFSET%' THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() must stay bounded';
  END IF;
  IF _body NOT LIKE '%LEAST%' THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() must cap the requested page size';
  END IF;

  -- Exactly one overload, and it is the paged signature.
  SELECT string_agg(p.pronargs::text, ',') INTO _args
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'desk_review_queue';

  IF _args IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() has % overloads/args, expected one 2-arg version', _args;
  END IF;
END $$;

-- Neither anon nor the public pseudo-role may reach the desk queue.
DO $$
DECLARE
  _open text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _open
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'desk_review_queue'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE'));

  IF _open IS NOT NULL THEN
    RAISE EXCEPTION 'REGRESSION: desk_review_queue() is reachable without a signed-in session';
  END IF;
END $$;

-- Deliberately NOT asserted here: calling desk_review_queue() to check that a
-- one-row page really returns one row. private.is_admin() resolves through
-- auth.uid(), which is NULL while a migration runs, so the admin guard would
-- raise 'Membership desk only' and fail the deploy. The paging behaviour is
-- therefore covered by the body assertions above rather than by live data.