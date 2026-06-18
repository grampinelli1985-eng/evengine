import React, { useState } from 'react';
import { registrarResultadoManual } from '../services/calibrationService';
import { resolverAposta } from '../services/historicoService';
import { getBancaAtual, setBancaAtual } from '../services/bancaService';

interface ResultadoModalProps {
  key?: React.Key;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (matchId: string, placar: string, resultado: 'WIN' | 'RED' | 'VOID') => void | Promise<void>;
  // Pré-preencher se vier de uma análise existente
  preenchido?: {
    homeTeam: string;
    awayTeam: string;
    liga: string;
    mercado: string;
    confianca: number;
    ev: number;
    odd: number;
    stake: number;
    gateScore: number;
    matchId?: string;
    apostaTid?: string;
  };
}

const MERCADOS = [
  'Vitória Casa', 'Empate', 'Vitória Fora',
  'Dupla Chance 1X', 'Dupla Chance X2', 'Dupla Chance 12',
  'Mais de 1.5 Gols', 'Mais de 2.5 Gols', 'Mais de 3.5 Gols'
];

export function ResultadoModal({ isOpen, onClose, preenchido, onSaved }: ResultadoModalProps): React.ReactElement | null {
  const [form, setForm] = useState({
    homeTeam: preenchido?.homeTeam ?? '',
    awayTeam: preenchido?.awayTeam ?? '',
    liga: preenchido?.liga ?? '',
    data: new Date().toISOString().substring(0, 10),
    mercado: preenchido?.mercado ?? '',
    confianca: preenchido?.confianca ?? 0,
    ev: preenchido?.ev ?? 0,
    odd: preenchido?.odd ?? 0,
    stake: preenchido?.stake ?? 0,
    gateScore: preenchido?.gateScore ?? 0,
    placarCasa: 0,
    placarFora: 0,
    resultado: '' as 'WIN' | 'RED' | 'VOID' | '',
  });

  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const handleSalvar = async () => {
    if (!form.resultado || !form.homeTeam || !form.mercado) return;
    setSalvando(true);

    try {
      // Registrar na calibração
      await registrarResultadoManual({
        matchId: preenchido?.matchId ?? `manual_${Date.now()}`,
        homeTeam: form.homeTeam,
        awayTeam: form.awayTeam,
        liga: form.liga,
        commenceTime: form.data,
        mercadoPrevisto: form.mercado,
        resultadoPrevisto: form.mercado,
        confiancaEstimada: form.confianca,
        evEstimado: form.ev,
        oddUtilizada: form.odd,
        scoreGate: form.gateScore,
        placarCasa: form.placarCasa,
        placarFora: form.placarFora,
        resultado: form.resultado as 'WIN' | 'RED' | 'VOID'
      });

      if (preenchido?.matchId) {
        onSaved?.(preenchido.matchId, `${form.placarCasa}-${form.placarFora}`, form.resultado as 'WIN' | 'RED' | 'VOID');
      }

      // Registrar no histórico P&L se tiver apostaTid
      if (preenchido?.apostaTid) {
        const bancaAtual = getBancaAtual();
        const novaBanca = form.resultado === 'WIN'
          ? bancaAtual + (form.stake * (form.odd - 1))
          : form.resultado === 'RED'
          ? bancaAtual - form.stake
          : bancaAtual;
        
        resolverAposta(preenchido.apostaTid, form.resultado, novaBanca);
        setBancaAtual(novaBanca);
      }

      setSalvo(true);
      setTimeout(() => {
        setSalvo(false);
        onClose();
      }, 1500);

    } finally {
      setSalvando(false);
    }
  };

  if (!isOpen) return null;

  const inputStyle = {
    background: '#0a0a12',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    color: '#e0e0ff',
    padding: '8px 12px',
    fontFamily: 'monospace',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16
    }}>
      <div style={{
        background: '#0d0d1a',
        border: '1px solid #1e1e3e',
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 480,
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, fontFamily: 'monospace' }}>
              📊 REGISTRAR RESULTADO
            </div>
            <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5 }}>
              ALIMENTA O SISTEMA DE CALIBRAÇÃO
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#666',
            fontSize: 20, cursor: 'pointer'
          }}>×</button>
        </div>

        {/* Partida */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
            PARTIDA
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input style={inputStyle} placeholder="Time Casa"
              value={form.homeTeam}
              onChange={e => setForm(p => ({ ...p, homeTeam: e.target.value }))} />
            <span style={{ color: '#555', fontSize: 12 }}>vs</span>
            <input style={inputStyle} placeholder="Time Fora"
              value={form.awayTeam}
              onChange={e => setForm(p => ({ ...p, awayTeam: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={inputStyle} placeholder="Liga"
              value={form.liga}
              onChange={e => setForm(p => ({ ...p, liga: e.target.value }))} />
            <input style={inputStyle} type="date"
              value={form.data}
              onChange={e => setForm(p => ({ ...p, data: e.target.value }))} />
          </div>
        </div>

        {/* Mercado */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
            MERCADO APOSTADO
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {MERCADOS.map(m => (
              <button key={m} onClick={() => setForm(p => ({ ...p, mercado: m }))}
                style={{
                  padding: '6px 4px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 10, fontFamily: 'monospace',
                  background: form.mercado === m ? '#00e67622' : '#070714',
                  border: `1px solid ${form.mercado === m ? '#00e676' : '#1a1a2e'}`,
                  color: form.mercado === m ? '#00e676' : '#666',
                }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Dados da análise */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
            DADOS DA ANÁLISE (GATE)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ color: '#555', fontSize: 9, marginBottom: 4 }}>CONFIANÇA %</div>
              <input style={inputStyle} type="number" placeholder="ex: 68"
                value={form.confianca || ''}
                onChange={e => { const v = parseFloat(e.target.value); setForm(p => ({ ...p, confianca: isNaN(v) ? 0 : v })); }} />
            </div>
            <div>
              <div style={{ color: '#555', fontSize: 9, marginBottom: 4 }}>EV %</div>
              <input style={inputStyle} type="number" placeholder="ex: 34.1"
                value={form.ev || ''}
                onChange={e => { const v = parseFloat(e.target.value); setForm(p => ({ ...p, ev: isNaN(v) ? 0 : v })); }} />
            </div>
            <div>
              <div style={{ color: '#555', fontSize: 9, marginBottom: 4 }}>ODD</div>
              <input style={inputStyle} type="number" placeholder="ex: 1.47"
                value={form.odd || ''}
                onChange={e => { const v = parseFloat(e.target.value); setForm(p => ({ ...p, odd: isNaN(v) ? 0 : v })); }} />
            </div>
            <div>
              <div style={{ color: '#555', fontSize: 9, marginBottom: 4 }}>STAKE R$</div>
              <input style={inputStyle} type="number" placeholder="ex: 50"
                value={form.stake || ''}
                onChange={e => { const v = parseFloat(e.target.value); setForm(p => ({ ...p, stake: isNaN(v) ? 0 : v })); }} />
            </div>
          </div>
        </div>

        {/* Placar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
            PLACAR FINAL
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
            <input style={{ ...inputStyle, textAlign: 'center', fontSize: 20, fontWeight: 700 }}
              type="number" placeholder="0"
              value={form.placarCasa || ''}
              onChange={e => { const v = parseInt(e.target.value, 10); setForm(p => ({ ...p, placarCasa: isNaN(v) ? 0 : v })); }} />
            <span style={{ color: '#555', fontSize: 16 }}>×</span>
            <input style={{ ...inputStyle, textAlign: 'center', fontSize: 20, fontWeight: 700 }}
              type="number" placeholder="0"
              value={form.placarFora || ''}
              onChange={e => { const v = parseInt(e.target.value, 10); setForm(p => ({ ...p, placarFora: isNaN(v) ? 0 : v })); }} />
          </div>
        </div>

        {/* Resultado */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: '#555', fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
            RESULTADO DA APOSTA
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { id: 'WIN', label: '✅ WIN', cor: '#00e676' },
              { id: 'RED', label: '❌ RED', cor: '#f44336' },
              { id: 'VOID', label: '○ VOID', cor: '#888' },
            ].map(r => (
              <button key={r.id}
                onClick={() => setForm(p => ({ ...p, resultado: r.id as any }))}
                style={{
                  padding: '12px', borderRadius: 10, cursor: 'pointer',
                  fontWeight: 800, fontSize: 13, fontFamily: 'monospace',
                  background: form.resultado === r.id ? r.cor + '22' : '#070714',
                  border: `1px solid ${form.resultado === r.id ? r.cor : '#1a1a2e'}`,
                  color: form.resultado === r.id ? r.cor : '#555',
                  transition: 'all 0.2s'
                }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Botões */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <button onClick={onClose} style={{
            padding: 14, borderRadius: 12, cursor: 'pointer',
            background: 'transparent', border: '1px solid #1e1e3e',
            color: '#666', fontFamily: 'monospace', fontSize: 12
          }}>
            CANCELAR
          </button>
          <button
            onClick={handleSalvar}
            disabled={!form.resultado || !form.homeTeam || !form.mercado || salvando}
            style={{
              padding: 14, borderRadius: 12, cursor: 'pointer',
              background: salvo ? '#00e676' : (!form.resultado || !form.homeTeam) ? '#111' : 'linear-gradient(135deg, #00e676, #00bcd4)',
              border: 'none',
              color: (!form.resultado || !form.homeTeam) ? '#333' : '#050508',
              fontWeight: 900, fontSize: 13, letterSpacing: 2,
              fontFamily: 'monospace', transition: 'all 0.3s'
            }}>
            {salvo ? '✓ REGISTRADO' : salvando ? 'SALVANDO...' : '💾 REGISTRAR'}
          </button>
        </div>
      </div>
    </div>
  );
}
