import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AuthUser, AuthSession } from '../services/authService';
import { getSession, onAuthStateChange, signIn as authSignIn, signUp as authSignUp, signOut as authSignOut, signInWithGoogle as authSignInWithGoogle } from '../services/authService';
import { setCachedProfile } from '../services/planService';

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial session
    getSession().then((sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });

    // Listen to auth changes
    const subscription = onAuthStateChange((sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });

    return () => {
      if (subscription && 'unsubscribe' in subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await authSignIn(email, password);
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    await authSignUp(email, password, fullName);
  };

  const signOut = async () => {
    try {
      await authSignOut();
    } catch (err) {
      console.warn('[AuthContext] error during authSignOut:', err);
    } finally {
      setUser(null);
      setSession(null);
      setCachedProfile(null);
      localStorage.removeItem('evengine_cached_profile');
      localStorage.removeItem('evengine_demo_analyses_today');
    }
  };

  const signInWithGoogle = async () => {
    await authSignInWithGoogle();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}
