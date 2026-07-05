import { supabase } from './supabaseClient';
import type { User, Session } from '@supabase/supabase-js';

export type AuthUser = User;
export type AuthSession = Session;

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase não configurado');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Sign up with email and password
 */
export async function signUp(email: string, password: string, fullName?: string) {
  if (!supabase) throw new Error('Supabase não configurado');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || '' }
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Sign out current user
 */
export async function signOut() {
  if (!supabase) throw new Error('Supabase não configurado');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get current session
 */
export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      // User has been deleted or token is invalid. Force clear local storage.
      await supabase.auth.signOut();
      return null;
    }
    return session;
  }
  return null;
}

/**
 * Get current user
 */
export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/**
 * Listen to auth state changes
 */
export function onAuthStateChange(callback: (session: Session | null) => void) {
  if (!supabase) return { unsubscribe: () => {} };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return data.subscription;
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase não configurado');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.search
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Reset password via email
 */
export async function resetPassword(email: string) {
  if (!supabase) throw new Error('Supabase não configurado');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  });
  if (error) throw error;
}
