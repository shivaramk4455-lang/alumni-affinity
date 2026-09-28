CREATE TABLE IF NOT EXISTS public.calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ringing',
  decline_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  CONSTRAINT calls_two_parties CHECK (caller_id <> callee_id),
  CONSTRAINT calls_status_valid CHECK (status IN ('ringing', 'active', 'ended'))
);
CREATE TABLE IF NOT EXISTS public.call_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_signals_kind_valid CHECK (kind IN ('offer', 'answer', 'ice', 'ice-done', 'hangup'))
);
GRANT SELECT, INSERT ON public.calls TO authenticated;
GRANT UPDATE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;
GRANT SELECT, INSERT, DELETE ON public.call_signals TO authenticated;
GRANT ALL ON public.call_signals TO service_role;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants read calls" ON public.calls;
CREATE POLICY "Participants read calls" ON public.calls FOR SELECT TO authenticated
  USING ((auth.uid() = caller_id OR auth.uid() = callee_id) AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.interests i ON i.id = c.interest_id
    WHERE c.id = conversation_id AND i.status = 'accepted' AND (auth.uid() = c.participant_a OR auth.uid() = c.participant_b)));
DROP POLICY IF EXISTS "Call on accepted introduction" ON public.calls;
CREATE POLICY "Call on accepted introduction" ON public.calls FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caller_id AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.interests i ON i.id = c.interest_id
    WHERE c.id = conversation_id AND i.status = 'accepted'
      AND (c.participant_a = caller_id AND c.participant_b = callee_id OR c.participant_a = callee_id AND c.participant_b = caller_id)));
DROP POLICY IF EXISTS "Participants update calls" ON public.calls;
CREATE POLICY "Participants update calls" ON public.calls FOR UPDATE TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id)
  WITH CHECK (auth.uid() = caller_id OR auth.uid() = callee_id);
DROP POLICY IF EXISTS "Participants read signals" ON public.call_signals;
CREATE POLICY "Participants read signals" ON public.call_signals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.calls ca WHERE ca.id = call_id AND ca.status <> 'ended' AND (auth.uid() = ca.caller_id OR auth.uid() = ca.callee_id)));
DROP POLICY IF EXISTS "Send own signal" ON public.call_signals;
CREATE POLICY "Send own signal" ON public.call_signals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.calls ca WHERE ca.id = call_id AND ca.status <> 'ended' AND (auth.uid() = ca.caller_id OR auth.uid() = ca.callee_id)));
CREATE OR REPLACE FUNCTION public.guard_call_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.caller_id IS DISTINCT FROM OLD.caller_id
     OR NEW.callee_id IS DISTINCT FROM OLD.callee_id THEN
    RAISE EXCEPTION 'A call cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ended' AND NEW.status IS DISTINCT FROM 'ended' THEN
    RAISE EXCEPTION 'A finished call cannot be reopened' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ringing' AND NEW.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'Invalid call transition' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'Invalid call transition' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS calls_guard_columns ON public.calls;
CREATE TRIGGER calls_guard_columns BEFORE UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION public.guard_call_columns();
CREATE OR REPLACE FUNCTION public.purge_call_signals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'ended' THEN
    DELETE FROM public.call_signals WHERE call_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS calls_purge_signals ON public.calls;
CREATE TRIGGER calls_purge_signals AFTER UPDATE OF status ON public.calls
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.purge_call_signals();
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_one_live ON public.calls(conversation_id) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS idx_calls_callee_ringing ON public.calls(callee_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_signals_call ON public.call_signals(call_id, id);
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
  CHECK (kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','verification_approved','verification_resubmission','verification_rejected','suggestion_received','message_received','call_missed'));
DROP POLICY IF EXISTS "Notify other members" ON public.notifications;
CREATE POLICY "Notify other members" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() <> user_id
    AND kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','suggestion_received','message_received','call_missed')
    AND coalesce(link, '') IN ('/connections', '/copilots', '/notifications', '/dashboard'));
DROP POLICY IF EXISTS "Clear signals after call" ON public.call_signals;
CREATE POLICY "Clear signals after call" ON public.call_signals FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.calls ca WHERE ca.id = call_id AND ca.status = 'ended' AND (auth.uid() = ca.caller_id OR auth.uid() = ca.callee_id)));