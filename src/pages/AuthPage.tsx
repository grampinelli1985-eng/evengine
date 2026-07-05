import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Mail, Lock, User, ArrowLeft, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabaseClient';
import './landing.css';

interface AuthPageProps {
  onBack: () => void;
  onSuccess: () => void;
}

export default function AuthPage({ onBack, onSuccess }: AuthPageProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
        onSuccess();
      } else {
        if (password.length < 6) {
          setError('A senha deve ter pelo menos 6 caracteres');
          setLoading(false);
          return;
        }
        await signUp(email, password, fullName);
        setSuccess('Conta criada! Verifique seu email para confirmar o cadastro.');
        setMode('login');
        setPassword('');
      }
    } catch (err: any) {
      const msg = err?.message || 'Erro desconhecido';
      if (msg.includes('Invalid login credentials')) {
        setError('Email ou senha incorretos');
      } else if (msg.includes('User already registered')) {
        setError('Este email já está registrado. Faça login.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Email não confirmado. Verifique sua caixa de entrada.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Digite seu email acima antes de redefinir a senha.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSuccess('Email de redefinição enviado! Verifique sua caixa de entrada.');
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar email de redefinição.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="landing-page min-h-screen flex items-center justify-center p-6 relative">
      {/* Background Effects */}
      <div className="landing-bg-grid" />
      <div className="landing-glow-orb landing-glow-orb--blue" />
      <div className="landing-glow-orb landing-glow-orb--green" style={{ opacity: 0.15 }} />

      {/* Back Button */}
      <button
        onClick={onBack}
        className="fixed top-6 left-6 z-50 flex items-center gap-2 text-sm text-white/30 hover:text-white/70 transition-colors font-medium"
      >
        <ArrowLeft size={16} />
        Voltar
      </button>

      {/* Auth Card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="auth-card w-full max-w-md p-8 md:p-10 relative z-10"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Zap size={20} className="text-white" />
          </div>
          <div>
            <span className="text-lg font-extrabold tracking-tight text-white">
              EV<span className="text-blue-400">Engine</span>
            </span>
            <p className="text-[10px] text-white/20 font-semibold uppercase tracking-[0.15em] -mt-0.5">
              Motor Analítico
            </p>
          </div>
        </div>

        {/* Title */}
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: mode === 'login' ? -20 : 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: mode === 'login' ? 20 : -20 }}
            transition={{ duration: 0.25 }}
          >
            <h1 className="text-2xl font-black text-white mb-1">
              {mode === 'login' ? 'Bem-vindo de volta' : 'Criar conta'}
            </h1>
            <p className="text-sm text-white/30 mb-6">
              {mode === 'login' 
                ? 'Acesse seu motor analítico' 
                : 'Comece a usar o EVEngine hoje'}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2"
            >
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-red-300 font-medium">{error}</span>
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20"
            >
              <span className="text-xs text-green-300 font-medium">{success}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence>
            {mode === 'register' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <label className="block text-xs text-white/30 font-semibold uppercase tracking-wider mb-2">
                  Nome completo
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Seu nome"
                    className="auth-input pl-11"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label className="block text-xs text-white/30 font-semibold uppercase tracking-wider mb-2">
              Email
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="auth-input pl-11"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-white/30 font-semibold uppercase tracking-wider mb-2">
              Senha
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
                required
                className="auth-input pl-11 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'login' && (
            <div className="text-right">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors font-medium"
              >
                Esqueceu a senha?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="cta-button w-full justify-center !mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              mode === 'login' ? 'Entrar' : 'Criar Conta'
            )}
          </button>
        </form>

        {/* Switch mode */}
        <p className="text-center text-xs text-white/25 mt-6">
          {mode === 'login' ? 'Não tem uma conta?' : 'Já tem uma conta?'}{' '}
          <button
            onClick={switchMode}
            className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
          >
            {mode === 'login' ? 'Criar conta' : 'Fazer login'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
