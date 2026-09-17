-- Fix: the original "Users can update own profile" WITH CHECK compared
-- plan/plan_expires_at against `(SELECT plan FROM public.profiles WHERE id = id)`.
-- Because `id` inside the subquery is unqualified, it binds to the subquery's
-- own `profiles.id` column (not the row being updated), so the condition is a
-- tautology (`id = id`) matching every row in the table. As soon as the table
-- has more than one profile, this subquery returns multiple rows and every
-- client-side UPDATE on `profiles` fails with
-- "more than one row returned by a subquery used as an expression".
--
-- Root fix: enforce plan/quota immutability from client sessions with a
-- BEFORE UPDATE trigger (which has correct OLD/NEW row access) instead of a
-- self-referential RLS subquery, and simplify the RLS policy back to just
-- ownership. This also closes a second gap: the original WITH CHECK never
-- protected analyses_today/analyses_reset_at, so an authenticated user could
-- previously reset/inflate their own daily quota by calling
-- `supabase.from('profiles').update({ analyses_today: 0 })` directly,
-- bypassing the check-quota edge function entirely.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.protect_profile_billing_fields()
RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at
     OR NEW.analyses_today IS DISTINCT FROM OLD.analyses_today
     OR NEW.analyses_reset_at IS DISTINCT FROM OLD.analyses_reset_at
  THEN
    RAISE EXCEPTION 'plan, plan_expires_at, analyses_today and analyses_reset_at can only be changed by the service role (payment webhook / check-quota function)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_billing_fields ON public.profiles;

CREATE TRIGGER trg_protect_profile_billing_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_billing_fields();
