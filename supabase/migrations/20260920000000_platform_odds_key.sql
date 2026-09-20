-- In-app rotation of the platform Odds API key.
--
-- 1) profiles.is_admin: who may replace the platform key (set only by the
--    service role; never by a client session).
-- 2) platform_secrets: server-only key/value store. RLS is enabled with NO
--    policies and all client grants are revoked, so only the service role
--    (edge functions) can read or write it — the browser never sees a value.
--    odds-proxy reads ODDS_API_KEY from here first and falls back to the
--    Supabase secret of the same name.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- The "Users can insert own profile" / "Users can update own profile" policies
-- only check ownership, so without this a user could insert or update their own
-- row with is_admin = true. Client sessions (PostgREST roles authenticated/anon)
-- can never set or change the flag; service role and direct SQL can.
CREATE OR REPLACE FUNCTION public.protect_profile_admin_flag()
RETURNS trigger AS $$
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
  ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin can only be changed by the service role';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_admin_flag ON public.profiles;

CREATE TRIGGER trg_protect_profile_admin_flag
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_admin_flag();

CREATE TABLE IF NOT EXISTS public.platform_secrets (
  name       text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_secrets FROM anon, authenticated;
