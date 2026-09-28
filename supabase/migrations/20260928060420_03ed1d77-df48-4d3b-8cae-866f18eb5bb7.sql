CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  interest_id uuid NOT NULL UNIQUE REFERENCES public.interests(id) ON DELETE CASCADE,
  participant_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_two_parties CHECK (participant_a <> participant_b)
);
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own conversations read" ON public.conversations;
CREATE POLICY "Own conversations read" ON public.conversations FOR SELECT TO authenticated
  USING (auth.uid() = participant_a OR auth.uid() = participant_b);
DROP POLICY IF EXISTS "Own conversation messages read" ON public.messages;
CREATE POLICY "Own conversation messages read" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (auth.uid() = c.participant_a OR auth.uid() = c.participant_b)));
DROP POLICY IF EXISTS "Send while introduction accepted" ON public.messages;
CREATE POLICY "Send while introduction accepted" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.interests i ON i.id = c.interest_id
      WHERE c.id = conversation_id
        AND (auth.uid() = c.participant_a OR auth.uid() = c.participant_b)
        AND i.status = 'accepted'
    )
  );
DROP POLICY IF EXISTS "Recipient marks read" ON public.messages;
CREATE POLICY "Recipient marks read" ON public.messages FOR UPDATE TO authenticated
  USING (sender_id <> auth.uid() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (auth.uid() = c.participant_a OR auth.uid() = c.participant_b)))
  WITH CHECK (sender_id <> auth.uid());
CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS messages_touch_conversation ON public.messages;
CREATE TRIGGER messages_touch_conversation AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(_interest_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid;
  _a uuid;
  _b uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to message' USING ERRCODE = '42501';
  END IF;
  SELECT sender_id, recipient_id INTO _a, _b
  FROM public.interests
  WHERE id = _interest_id AND status = 'accepted' AND (sender_id = _uid OR recipient_id = _uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_requires_accepted_interest' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.conversations (interest_id, participant_a, participant_b)
  VALUES (_interest_id, LEAST(_a, _b), GREATEST(_a, _b))
  ON CONFLICT (interest_id) DO NOTHING
  RETURNING id INTO _conv;
  IF _conv IS NULL THEN
    SELECT id INTO _conv FROM public.conversations WHERE interest_id = _interest_id;
  END IF;
  RETURN _conv;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON public.conversations(participant_a, participant_b, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at);
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
  CHECK (kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','verification_approved','verification_resubmission','verification_rejected','suggestion_received','message_received'));
DROP POLICY IF EXISTS "Notify other members" ON public.notifications;
CREATE POLICY "Notify other members" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() <> user_id
    AND kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','suggestion_received','message_received')
    AND coalesce(link, '') IN ('/connections', '/copilots', '/notifications', '/dashboard')
  );