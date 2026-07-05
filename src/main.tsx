import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import App from './App.tsx';
import './index.css';
import { supabase } from './services/supabaseClient';

// Intercept window.fetch to automatically append JWT Token for all proxy endpoints (/api/football)
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
  
  if (url.startsWith('/api/football') || url.includes('/api/football')) {
    const newInit = { ...init };
    newInit.headers = { ...newInit.headers };
    
    if (supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          (newInit.headers as any)['Authorization'] = `Bearer ${session.access_token}`;
        }
      } catch (err) {
        console.error('[Fetch Interceptor] Error getting supabase session:', err);
      }
    }
    return originalFetch(input, newInit);
  }
  
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
