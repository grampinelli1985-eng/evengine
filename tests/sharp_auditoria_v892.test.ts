import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackGeminiCall, resetGeminiCallCounter, getGeminiCallCount } from '../src/services/telemetryService';
import { fetchFormaRecenteViaGeminiSearch } from '../src/services/scoutingService';
import * as aiModule from '../src/config/ai';
import { GoogleGenAI } from '@google/genai';

describe('Auditoria v8.9.2 - Controle de Custo Gemini', () => {
  beforeEach(() => {
    resetGeminiCallCounter();
  });

  it('1. Telemetria: trackGeminiCall incrementa corretamente e resetGeminiCallCounter zera o contador', () => {
    expect(getGeminiCallCount()).toBe(0);
    
    trackGeminiCall('teste_1');
    trackGeminiCall('teste_2');
    
    expect(getGeminiCallCount()).toBe(2);
    
    resetGeminiCallCounter();
    
    expect(getGeminiCallCount()).toBe(0);
  });
});
