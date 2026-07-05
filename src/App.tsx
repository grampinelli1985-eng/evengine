import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import EngineApp from './EngineApp';

export default function App() {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Se o usuário estiver autenticado, renderiza o painel completo (EngineApp)
  if (user) {
    return <EngineApp onSignOut={() => {}} />;
  }

  // Se estiver no modo demonstração (não autenticado), renderiza com initialDemoMode
  if (demoMode) {
    return <EngineApp initialDemoMode={true} onSignOut={() => setDemoMode(false)} />;
  }

  // Se o usuário solicitou autenticação (login/registro), renderiza a AuthPage
  if (showAuth) {
    return (
      <AuthPage 
        onBack={() => setShowAuth(false)} 
        onSuccess={() => setShowAuth(false)} 
      />
    );
  }

  // Caso contrário, mostra a Landing Page de apresentação
  return (
    <LandingPage 
      onNavigateToAuth={() => setShowAuth(true)} 
      onNavigateToDemo={() => setDemoMode(true)} 
    />
  );
}
