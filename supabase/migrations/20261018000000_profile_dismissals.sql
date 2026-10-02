-- ===========================================================================
-- 20261018: Profile dismissals — "not for me".
--
-- THE GAP THIS FILLS
-- Until now the only way to stop seeing a member was to *report* them (a desk
-- alert, for something genuinely wrong) or block them (terminal, ends an
-- introduction, hides you both). Neither is "this profile is not for me".
-- A directory where the only negative control is an accusation pushes people
-- either to send requests they don't want, or to stay silent.
--
-- A dismissal is private, one-way and reversible. The other member is never
-- told, never notified, and cannot tell: unlike a block, it does not hide the
-- *other* member from anyone, and it does not affect any introduction.
--
-- Deliberately NOT a table of rejects that could be read sideways: RLS lets
-- only the dismisser see their own rows.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.profile_dismissals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dismisser_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dismissed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_dismissals_not_self CHECK (dismisser_id <> dismissed_id)
);

-- One dismissal per pair; re-dismissing is a no-op rather than a growing table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_dismissals_pair
  ON public.profile_dismissals(dismisser_id, dismissed_id);

-- The search filter needs "everything I dismissed" in one read.
CREATE INDEX IF NOT EXISTS idx_profile_dismissals_dismisser
  ON public.profile_dismissals(dismisser_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.profile_dismissals TO authenticated;
GRANT ALL ON public.profile_dismissals TO service_role;
ALTER TABLE public.profile_dismissals ENABLE ROW LEVEL SECURITY;

-- Strictly personal: you can see and edit only your own dismissals. No policy
-- lets another member read them, so there is no way to detect "who dismissed
-- me" — the whole point.
DROP POLICY IF EXISTS "Own dismissals only" ON public.profile_dismissals;
CREATE POLICY "Own dismissals only" ON public.profile_dismissals FOR ALL TO authenticated
  USING (dismisser_id = auth.uid()) WITH CHECK (dismisser_id = auth.uid());