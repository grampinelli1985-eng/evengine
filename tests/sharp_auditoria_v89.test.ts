import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeMatch, callGeminiAPI } from '../src/services/geminiService';
import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK } from '../src/config/ai';
import * as scoutingService from '../src/services/scoutingService';
import * as fixtureStatsService from '../src/services/fixtureStatsService';

// Mock the AI module globally so it doesn't make real network calls
const mockGenerateContent = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      };
    },
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' }
  };
});

describe('Auditoria v8.9 - Hotfix Gemini 404 Cascading', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. GEMINI_MODEL e GEMINI_MODEL_FALLBACK configurados corretamente', () => {
    expect(GEMINI_MODEL).toBeTruthy();
    expect(GEMINI_MODEL_FALLBACK).toBeTruthy();
    expect(GEMINI_MODEL.includes('flash')).toBe(true);
    expect(GEMINI_MODEL_FALLBACK.includes('flash')).toBe(true);
  });

  it('2. Mock de falha 404 no modelo principal ativa o fallback para GEMINI_MODEL_FALLBACK', async () => {
    mockGenerateContent
      .mockRejectedValueOnce({ status: 404, message: 'not found' })
      .mockResolvedValueOnce({ text: '{"sucesso": true}' });

    const result = await callGeminiAPI('system', 'user', 'json');
    
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0][0].model).toBe(GEMINI_MODEL);
    expect(mockGenerateContent.mock.calls[1][0].model).toBe(GEMINI_MODEL_FALLBACK);
    
    expect(result.text).toBe('{"sucesso": true}');
    expect(result.usouFallbackEstatistico).toBe(false);
  });

  it('3. Mock de falha 404 em ambos os modelos ativa o fallback estatístico e marca dados_ia_indisponivel', async () => {
    // Falha em ambas as tentativas
    mockGenerateContent
      .mockRejectedValueOnce({ status: 404, message: 'not found' })
      .mockRejectedValueOnce({ status: 404, message: 'not found' });

    vi.spyOn(scoutingService, 'fetchRealScouting').mockResolvedValue({
      home_form: ['V', 'V', 'V', 'V', 'V'],
      away_form: ['V', 'V', 'V', 'V', 'V'],
    } as any);
    vi.spyOn(scoutingService, 'fetchInjuries').mockResolvedValue([]);
    vi.spyOn(fixtureStatsService, 'fetchMatchStats').mockResolvedValue({} as any);

    const match: any = {
      home_team: 'Home',
      away_team: 'Away',
      sport_key: 'soccer',
      commence_time: new Date().toISOString(),
      bookmakers: [],
    };

    const analysis = await analyzeMatch(match);
    
    expect(analysis.dados_ia_indisponivel).toBe(true);
    expect(analysis.resumo).toContain('[MODO DE SEGURANÇA]');
  });
});
