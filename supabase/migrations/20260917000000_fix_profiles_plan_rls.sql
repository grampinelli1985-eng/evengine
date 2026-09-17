-- Fix: the original "Users can update own profile" WITH CHECK compared
-- plan/plan_expires_at against `(SELECT plan FROM public.profiles WHERE id = id)`.
-- Because `id` inside the subquery is unqualified, it binds to the subquery's
-- own `profiles.id` column (not the row being updated), so the condition is a
-- tautology (`id = id`) matching every row in the table. As soon as the table
-- has more than one profile, this subquery returns multiple rows and every
-- client-side UPDATE on `profiles` fails with
-- "more than one row returned by a subquery used as an expression".
--
-- Root fix: enforce plan-escalation immutability from client sessions with a
-- BEFORE UPDATE trigger (which has correct OLD/NEW row access) instead of a
-- self-referential RLS subquery, and simplify the RLS policy back to just
-- ownership.
--
-- The trigger only blocks a client session from (a) setting plan to 'pro'/
-- 'sharp' when it wasn't already that value, and (b) pushing plan_expires_at
-- further into the future — i.e. self-granting or self-extending a paid
-- plan. It deliberately does NOT block writes that only move a profile
-- toward 'free' or leave plan_expires_at unchanged/earlier: PlanControl.tsx
-- calls updateUserPlan(user.id, 'free') directly from the client for the
-- self-service "cancel to free" action, which is a legitimate privilege
-- decrease, not an escalation.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.protect_profile_plan_escalation()
RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IN ('pro', 'sharp') AND NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'Only the service role (payment webhook) can grant a paid plan';
  END IF;

  IF NEW.plan_expires_at IS NOT NULL
     AND (OLD.plan_expires_at IS NULL OR NEW.plan_expires_at > OLD.plan_expires_at)
  THEN
    RAISE EXCEPTION 'Only the service role (payment webhook) can extend plan_expires_at';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_plan_escalation ON public.profiles;

CREATE TRIGGER trg_protect_profile_plan_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_plan_escalation();
