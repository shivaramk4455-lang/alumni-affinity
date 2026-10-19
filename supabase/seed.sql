-- ===========================================================================
-- The Merit Circle — Local Development & Staging Seed File
-- Run via: supabase db reset (or supabase db seed)
--
-- profiles.id -> auth.users.id FK (20260928000200) already exists by the
-- time the seed runs (migrations apply first), so every seeded profile
-- needs a disabled placeholder auth.users row before it can be inserted:
-- empty password, no identities, .invalid address — they can never sign in.
-- Same pattern as the backfill in 20260928000200_storage_and_integrity.sql.
--
-- PRODUCTION GUARD: `supabase db seed` can be pointed at a linked remote
-- project, and this file would then insert eight fabricated profiles marked
-- `verified` and `is_visible`, carrying real-institution alumni addresses.
-- Nothing downstream reports their arrival, so the risk is silent.
--
-- Both INSERTs are therefore conditional on the database never having held a
-- real person: a seed row is by definition an `@example.invalid` address, so
-- the first genuine member makes the predicate permanently false and the seed
-- becomes a no-op forever after. This is deliberately not an environment flag
-- (a flag can be set by accident; a populated production database cannot look
-- fresh), and it is deliberately not an exception either — `supabase db reset`
-- runs this file in CI, and a hard failure there would break the migration
-- drill for no security gain. A fresh local or staging database still seeds
-- exactly as before.
-- ===========================================================================

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT id,
       '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated',
       'authenticated',
       'directory+' || replace(id::text, '-', '') || '@example.invalid',
       '',
       now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"directory_seed": true}'::jsonb,
       now(),
       now()
FROM (VALUES
  ('a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000002'::uuid),
  ('a1000000-0000-4000-8000-000000000003'::uuid),
  ('a1000000-0000-4000-8000-000000000004'::uuid),
  ('a1000000-0000-4000-8000-000000000005'::uuid),
  ('a1000000-0000-4000-8000-000000000006'::uuid),
  ('a1000000-0000-4000-8000-000000000007'::uuid),
  ('a1000000-0000-4000-8000-000000000008'::uuid)
) AS seed_ids(id)
-- PRODUCTION GUARD: never seed into a database that has held a real member.
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u
  WHERE coalesce(u.email, '') NOT LIKE '%@example.invalid'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  id, full_name, gender, birth_year, city, institution, degree, grad_year,
  profession, employer, relocation, values_statement, bio,
  is_visible, onboarded, verification_status, alumni_email, alumni_email_verified,
  verification_decided_at, photo_visibility
)
-- PRODUCTION GUARD: skipped in lockstep with the placeholder auth rows above.
-- The FK to auth.users makes a half-applied seed fail loudly rather than write
-- fabricated profiles that no later query would question.
SELECT * FROM (VALUES
  (
    'a1000000-0000-4000-8000-000000000001', 'Ananya Iyer', 'Woman', 1994, 'Mumbai',
    'IIT Bombay', 'B.Tech Computer Science', 2016, 'Engagement Manager', 'McKinsey & Company',
    'Open to relocate',
    'A partnership where both people keep their own ambition and still build a shared, unhurried life together. I value direct conversation over guessing games.',
    'Grew up between Chennai and Muscat, studied computer science at IIT Bombay, and have spent the last eight years in consulting across Mumbai and Singapore. Weekends are for long runs along the sea face and cooking far too much food for friends.',
    true, true, 'verified', 'ananya.iyer@alumni.iitb.ac.in', true, now() - interval '21 days', 'all_members'
  ),
  (
    'a1000000-0000-4000-8000-000000000002', 'Rohan Mehta', 'Man', 1992, 'Bengaluru',
    'IIM Calcutta', 'MBA', 2018, 'Head of Product', 'Fintech payments platform',
    'Prefer current city',
    'Someone who is curious about the world and kind about it. I want a household where decisions are made together and nobody has to shrink to fit.',
    'Engineering undergraduate, then three years building payments infrastructure before IIM Calcutta. I now lead product for a payments platform in Bengaluru. I play the tabla badly, cycle seriously, and read more history than is strictly reasonable.',
    true, true, 'verified', 'rohan.mehta@iimcal.ac.in', true, now() - interval '14 days', 'accepted_only'
  ),
  (
    'a1000000-0000-4000-8000-000000000003', 'Kabir Anand', 'Man', 1995, 'Bengaluru',
    'BITS Pilani', 'B.E. Computer Science', 2017, 'Founder & CEO', 'Applied AI startup',
    'Open to abroad',
    'I would like a partner who is building something of her own, in whatever form that takes. Mutual respect for the work, and equal enthusiasm for the life outside it.',
    'Started as a backend engineer, went through a Y Combinator batch, and now run a small applied AI company with fourteen people. I moved back to India by choice. I climb, I cook badly but enthusiastically, and I am the person friends call at midnight.',
    true, true, 'verified', 'kabir.anand@pilani.bits-pilani.ac.in', true, now() - interval '9 days', 'accepted_only'
  ),
  (
    'a1000000-0000-4000-8000-000000000004', 'Dr. Meera Nair', 'Woman', 1993, 'New Delhi',
    'AIIMS Delhi', 'MBBS, MD', 2019, 'Consultant Anaesthesiologist', 'AIIMS Delhi',
    'Within India only',
    'Companionship through the ordinary weeks, not only the milestones. I am looking for steadiness, humour, and someone who genuinely likes their own life.',
    'MBBS and MD from AIIMS, now a consultant anaesthesiologist. My schedule is unforgiving, so I protect the people in my life deliberately. I read Malayalam poetry, swim, and take my niece to the planetarium whenever I can.',
    true, true, 'verified', 'meera.nair@aiims.edu', true, now() - interval '30 days', 'hidden'
  ),
  (
    'a1000000-0000-4000-8000-000000000005', 'Aisha Khan', 'Woman', 1994, 'Bengaluru',
    'NLSIU Bengaluru', 'BA LLB', 2016, 'Corporate Lawyer', 'Cyril Amarchand Mangaldas',
    'Open to relocate',
    'Two people who can disagree well and still choose each other the next morning. I want warmth at home and a shared sense of purpose outside it.',
    'Studied law at NLSIU, worked in competition and regulatory practice in Delhi, and recently moved to Bengaluru for the weather and the trees. I debate for fun, run a neighbourhood reading circle, and make a genuinely excellent biryani.',
    true, true, 'verified', 'aisha.khan@nls.ac.in', true, now() - interval '17 days', 'all_members'
  ),
  (
    'a1000000-0000-4000-8000-000000000006', 'Arjun Deshpande', 'Man', 1989, 'Pune',
    'IIT Delhi', 'M.Tech Electrical Engineering', 2014, 'Director of Engineering', 'Enterprise SaaS company',
    'Prefer current city',
    'I am looking for a teammate. Someone who wants to build a home that is calm, generous and full of people, and who has her own reasons to get up in the morning.',
    'Electrical engineering at IIT Delhi, then a decade in distributed systems. I lead engineering for a SaaS company and mentor two student teams at my old department. I run marathons slowly and repair things that were not broken.',
    true, true, 'pending_review', 'arjun.deshpande@alumni.iitd.ac.in', false, null, 'accepted_only'
  ),
  (
    'a1000000-0000-4000-8000-000000000007', 'Sneha Reddy', 'Woman', 1996, 'Hyderabad',
    'ISB Hyderabad', 'MBA', 2021, 'Investment Associate', 'Private equity fund',
    'Open to relocate',
    'Honesty first. I would rather be told a hard truth than managed. Beyond that, I want someone with a full life of his own who wants to merge two of them on purpose.',
    'Banking analyst in Mumbai, then ISB Hyderabad, now investing in healthcare and consumer businesses from Hyderabad. I paint watercolours badly, travel to at least one new country a year, and am deeply attached to my grandmother''s recipes.',
    true, true, 'pending_review', 'sneha.reddy@isb.edu', false, null, 'all_members'
  ),
  (
    'a1000000-0000-4000-8000-000000000008', 'Vikram Sethi', 'Man', 1991, 'Gurugram',
    'IIM Ahmedabad', 'MBA', 2017, 'Strategy & Operations Lead', 'Consumer goods company',
    'Open to relocate',
    'A life with room for family, work that means something, and a partner who is a genuine friend first. I am not in a hurry; I would rather get this right.',
    'Studied economics in Delhi, spent three years in analytics, then IIM Ahmedabad. I now run strategy and operations for a consumer goods business and split my time between Gurugram and a farmhouse near Alwar. I fly gliders, which explains the patience.',
    true, true, 'needs_resubmission', 'vikram.sethi@iima.ac.in', false, now() - interval '5 days', 'accepted_only'
  )
) AS seeded_profile
-- PRODUCTION GUARD: see the file header.
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u
  WHERE coalesce(u.email, '') NOT LIKE '%@example.invalid'
)
ON CONFLICT (id) DO NOTHING;

-- Desk notes so the queue and member view have realistic context.
UPDATE public.profiles
   SET verification_note = 'The alumni address you gave has a personal domain. Please upload a degree certificate or alumni card so we can complete the institutional check.'
 WHERE id = 'a1000000-0000-4000-8000-000000000008'
   AND verification_note IS NULL;
