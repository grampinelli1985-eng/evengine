import { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import EngineApp from './EngineApp';

export default function App() {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Quando o usuário faz login a partir do preview, fecha o AuthPage e entra direto
  useEffect(() => {
    if (user && showAuth) setShowAuth(false);
  }, [user, showAuth]);

  // Ouve o evento de "abrir auth" disparado pelo EngineApp no preview mode
  useEffect(() => {
    const handler = () => setShowAuth(true);
    window.addEventListener('evengine_open_auth_modal', handler);
    return () => window.removeEventListener('evengine_open_auth_modal', handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Usuário autenticado — acesso completo (plano demo, free, pro ou sharp)
  if (user) {
    return <EngineApp onSignOut={() => {}} />;
  }

  // Auth modal sobre o preview (usuário clicou "Criar Conta" dentro do engine)
  if (showAuth) {
    return (
      <AuthPage
        onBack={() => setShowAuth(false)}
        onSuccess={() => setShowAuth(false)}
      />
    );
  }

  // Preview mode: UI visível, análises bloqueadas — incentiva cadastro
  if (previewMode) {
    return <EngineApp isPreviewMode={true} onSignOut={() => setPreviewMode(false)} />;
  }

  // Landing Page
  return (
    <LandingPage
      onNavigateToAuth={() => setShowAuth(true)}
      onNavigateToDemo={() => setPreviewMode(true)}
    />
  );
}
