// src/components/CheckoutModal.tsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CreditCard, FileText, Copy, Check, Crown, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

type PlanId = 'pro' | 'sharp';
type PaymentMethod = 'BOLETO' | 'CREDIT_CARD';

interface CardData {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  postalCode: string;
}

interface BoletoResult {
  paymentId: string;
  boletoUrl: string;
  boletoBarCode: string;
  dueDate: string;
}

const PLAN_CONFIG = {
  pro:   { label: 'Plano PRO',   price: 'R$ 147/mês', color: 'blue' },
  sharp: { label: 'Plano Sharp', price: 'R$ 247/mês', color: 'emerald' },
};

function maskCpf(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2').slice(0, 14);
}
function maskPhone(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15);
}
function maskCard(v: string) {
  return v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
}
function maskExpiry(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2').slice(0, 5);
}

export function CheckoutModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [planId, setPlanId] = useState<PlanId>('pro');
  const [method, setMethod] = useState<PaymentMethod>('BOLETO');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [card, setCard] = useState<CardData>({ holderName: '', number: '', expiryMonth: '', expiryYear: '', ccv: '', postalCode: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [boleto, setBoleto] = useState<BoletoResult | null>(null);
  const [cardSuccess, setCardSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { plan?: PlanId };
      setPlanId(detail?.plan ?? 'pro');
      setIsOpen(true);
      setError('');
      setBoleto(null);
      setCardSuccess(false);
    };
    window.addEventListener('evengine_checkout_init', handler);
    return () => window.removeEventListener('evengine_checkout_init', handler);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setError('');
    setBoleto(null);
    setCardSuccess(false);
    setCpf('');
    setPhone('');
    setCard({ holderName: '', number: '', expiryMonth: '', expiryYear: '', ccv: '', postalCode: '' });
  };

  const handleExpiryChange = (v: string) => {
    const masked = maskExpiry(v);
    const [m, y] = masked.split('/');
    setCard(c => ({ ...c, expiryMonth: m ?? '', expiryYear: y ? `20${y}` : '' }));
  };

  const handleCopy = () => {
    if (boleto?.boletoBarCode) {
      navigator.clipboard.writeText(boleto.boletoBarCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase não inicializado');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Você precisa estar logado para assinar');

      const body: Record<string, unknown> = {
        plan: planId,
        paymentMethod: method,
        cpfCnpj: cpf,
        phone,
      };

      if (method === 'CREDIT_CARD') {
        body.cardData = {
          holderName: card.holderName,
          number: card.number.replace(/\s/g, ''),
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          ccv: card.ccv,
          postalCode: card.postalCode,
        };
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xzaaogfesxfwwjpeewiz.supabase.co';
      const res = await fetch(
        `${supabaseUrl}/functions/v1/asaas-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erro ao processar pagamento');

      if (method === 'BOLETO') {
        setBoleto({
          paymentId: data.paymentId,
          boletoUrl: data.boletoUrl,
          boletoBarCode: data.boletoBarCode ?? '',
          dueDate: data.dueDate ?? '',
        });
      } else {
        setCardSuccess(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const plan = PLAN_CONFIG[planId];
  const isBlue = plan.color === 'blue';

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-md bg-[#070708] border border-white/5 rounded-3xl p-6 z-10 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <span className={`text-[10px] font-black uppercase tracking-widest mb-1 block ${isBlue ? 'text-blue-400' : 'text-emerald-400'}`}>
                Finalizar Assinatura
              </span>
              <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                <Crown size={18} className={isBlue ? 'text-blue-500 fill-blue-500/20' : 'text-emerald-500 fill-emerald-500/20'} />
                {plan.label}
              </h3>
              <p className={`text-sm font-bold mt-1 ${isBlue ? 'text-blue-400' : 'text-emerald-400'}`}>{plan.price}</p>
            </div>
            <button onClick={handleClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Sucesso boleto */}
          {boleto && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                <Check size={20} className="text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-black text-white">Boleto gerado!</p>
                  {boleto.dueDate && (
                    <p className="text-xs text-white/40 mt-0.5">
                      Vencimento: {new Date(boleto.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
              </div>

              {boleto.boletoBarCode && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                  <p className="text-[10px] font-black uppercase text-white/30 mb-2">Linha digitável</p>
                  <p className="text-xs font-mono text-white/70 break-all leading-relaxed mb-3">{boleto.boletoBarCode}</p>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors text-white"
                  >
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copied ? 'Copiado!' : 'Copiar código'}
                  </button>
                </div>
              )}

              {boleto.boletoUrl && (
                <a
                  href={boleto.boletoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`block w-full text-center py-3 rounded-xl font-black uppercase text-[10px] tracking-widest text-white transition-all ${
                    isBlue ? 'bg-blue-600 hover:bg-blue-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  Abrir boleto em PDF
                </a>
              )}

              <p className="text-[10px] text-white/25 text-center leading-relaxed">
                Seu plano será ativado automaticamente após a confirmação do pagamento.
              </p>

              <button onClick={handleClose} className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 font-black uppercase text-[10px] tracking-wider transition-colors">
                Fechar
              </button>
            </div>
          )}

          {/* Sucesso cartão */}
          {cardSuccess && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                <Check size={20} className="text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-black text-white">Pagamento confirmado!</p>
                  <p className="text-xs text-white/40 mt-0.5">Seu plano será ativado em instantes.</p>
                </div>
              </div>
              <button onClick={handleClose} className={`w-full py-3 rounded-xl font-black uppercase text-[10px] tracking-widest text-white transition-all ${isBlue ? 'bg-blue-600 hover:bg-blue-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                Continuar
              </button>
            </div>
          )}

          {/* Formulário */}
          {!boleto && !cardSuccess && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Método */}
              <div>
                <p className="text-[10px] font-black uppercase text-white/40 tracking-widest mb-2">Forma de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['BOLETO', 'CREDIT_CARD'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`py-2.5 px-3 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                        method === m
                          ? isBlue
                            ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
                            : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                          : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                      }`}
                    >
                      {m === 'BOLETO' ? <FileText size={12} /> : <CreditCard size={12} />}
                      {m === 'BOLETO' ? 'Boleto' : 'Cartão'}
                    </button>
                  ))}
                </div>
              </div>

              {/* CPF */}
              <div>
                <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">CPF</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={e => setCpf(maskCpf(e.target.value))}
                  required
                  inputMode="numeric"
                />
              </div>

              {/* Telefone */}
              <div>
                <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">Telefone</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
                  placeholder="(XX) XXXXX-0000"
                  value={phone}
                  onChange={e => setPhone(maskPhone(e.target.value))}
                  inputMode="numeric"
                />
              </div>

              {/* Dados do cartão */}
              {method === 'CREDIT_CARD' && (
                <div className="space-y-3 p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <p className="text-[10px] font-black uppercase text-white/30 tracking-widest">Dados do cartão</p>

                  <div>
                    <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">Nome no cartão</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors uppercase"
                      placeholder="NOME COMO NO CARTÃO"
                      value={card.holderName}
                      onChange={e => setCard(c => ({ ...c, holderName: e.target.value.toUpperCase() }))}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">Número</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors font-mono tracking-wider"
                      placeholder="0000 0000 0000 0000"
                      value={card.number}
                      onChange={e => setCard(c => ({ ...c, number: maskCard(e.target.value) }))}
                      inputMode="numeric"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">Validade</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
                        placeholder="MM/AA"
                        onChange={e => handleExpiryChange(e.target.value)}
                        inputMode="numeric"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">CVV</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
                        placeholder="000"
                        value={card.ccv}
                        onChange={e => setCard(c => ({ ...c, ccv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        inputMode="numeric"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-white/40 tracking-widest block mb-1.5">CEP do titular</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
                      placeholder="00000-000"
                      value={card.postalCode}
                      onChange={e => setCard(c => ({ ...c, postalCode: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl font-black uppercase text-[10px] tracking-widest text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  isBlue
                    ? 'bg-blue-600 hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20'
                }`}
              >
                {loading ? 'Processando...' : method === 'BOLETO' ? 'Gerar Boleto' : 'Pagar Agora'}
              </button>

              <p className="text-[10px] text-white/20 text-center">
                Pagamento processado com segurança · Cancele quando quiser
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
