import { useState } from 'react';
import { submitPlatformOddsKey, SET_ODDS_KEY_MESSAGES } from '../services/oddsKeyAdminService';

/**
 * Campo para o admin colar uma chave nova da Odds API. O servidor valida (chave aceita e com
 * créditos) antes de gravar; em caso de sucesso recarrega a página — o odds-proxy já passa a
 * usar a chave nova e o cliente descarta o estado da antiga (ver syncOddsKeyId).
 */
export default function AdminOddsKeyForm() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await submitPlatformOddsKey(key);
    if ('reason' in result) {
      setError(SET_ODDS_KEY_MESSAGES[result.reason]);
      setBusy(false);
      return;
    }
    window.location.reload();
  };

  return (
    <form onSubmit={submit} className="flex items-center flex-wrap justify-center gap-2">
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="Nova chave da Odds API"
        aria-label="Nova chave da Odds API"
        className="w-64 px-2 py-0.5 bg-black/30 border border-amber-500/30 rounded text-[10px] font-mono text-amber-200 placeholder:text-amber-500/40 focus:outline-none focus:border-amber-400"
      />
      <button
        type="submit"
        disabled={busy || !key.trim()}
        className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-300 text-[9px] font-black uppercase tracking-widest rounded transition-all border border-amber-500/30"
      >
        {busy ? 'Validando...' : 'Validar e Aplicar'}
      </button>
      {error && <span role="alert" className="text-[10px] text-red-400 font-medium">{error}</span>}
    </form>
  );
}
