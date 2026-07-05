-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'sharp'
  plan_expires_at timestamptz,
  analyses_today integer NOT NULL DEFAULT 0,
  analyses_reset_at timestamptz NOT NULL DEFAULT now(),
  api_key_own text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id 
    AND plan = (SELECT plan FROM public.profiles WHERE id = id)
    AND (plan_expires_at IS NOT DISTINCT FROM (SELECT plan_expires_at FROM public.profiles WHERE id = id))
  );

-- Create bancas table
CREATE TABLE IF NOT EXISTS public.bancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL,
  valor_inicial numeric(10,2) NOT NULL,
  valor_atual numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS for bancas
ALTER TABLE public.bancas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own bancas" 
  ON public.bancas FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bancas" 
  ON public.bancas FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bancas" 
  ON public.bancas FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bancas" 
  ON public.bancas FOR DELETE 
  USING (auth.uid() = user_id);

-- Alter bets table to support closing_odd_pinnacle
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS closing_odd_pinnacle numeric(8,2);

-- Trigger to automatically create a profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, plan, plan_expires_at)
  VALUES (new.id, new.email, 'free', null)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
