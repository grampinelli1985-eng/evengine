/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from "./supabaseClient";
import { Match, AnalysisResponse } from "../types";

const TABLE = "analysis_cache";

// Mesma lógica de TTL que já existia no geminiService — mantida aqui para
// que o cache decida sozinho por quanto tempo um resultado é válido.
const CACHE_TTL_DEFAULT = 4 * 60 * 60 * 1000; // 4 horas
const CACHE_TTL_PRE_MATCH = 30 * 60 * 1000; // 30 minutos

export function getCacheTTL(match: Match): number {
  const commenceTime = new Date(match.commence_time).getTime();
  const hoursUntilMatch = (commenceTime - Date.now()) / (60 * 60 * 1000);
  return hoursUntilMatch < 6 ? CACHE_TTL_PRE_MATCH : CACHE_TTL_DEFAULT;
}

/**
 * Busca uma análise em cache, compartilhada entre TODOS os usuários/sessões.
 * Retorna null se não existir ou já tiver expirado.
 */
export async function getCachedAnalysis(
  matchId: string
): Promise<AnalysisResponse | null> {
  if (!supabase) return null; // cliente não inicializado (env vars ausentes)

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data, expires_at")
      .eq("match_id", matchId)
      .maybeSingle();

    if (error) {
      console.warn("Cache read failed, falling back to live analysis:", error.message);
      return null;
    }

    if (!data) return null;

    const expired = new Date(data.expires_at).getTime() < Date.now();
    if (expired) return null;

    // Mesma checagem de segurança que existia antes: nunca reaproveitar
    // um resultado que caiu em modo de segurança (fallback local).
    const parsed = data.data as AnalysisResponse;
    if (parsed?.resumo?.includes("[MODO DE SEGURANÇA]")) return null;

    return parsed;
  } catch (e) {
    console.warn("Unexpected cache read error:", e);
    return null;
  }
}

/**
 * Grava (ou atualiza) o resultado da análise no cache compartilhado.
 * Falha silenciosamente — um erro de cache nunca deve quebrar a UX do app.
 */
export async function setCachedAnalysis(
  match: Match,
  analysis: AnalysisResponse
): Promise<void> {
  if (!supabase) return; // cliente não inicializado (env vars ausentes)

  try {
    const ttl = getCacheTTL(match);
    const expiresAt = new Date(Date.now() + ttl).toISOString();

    const { error } = await supabase.from(TABLE).upsert({
      match_id: match.id,
      data: analysis,
      expires_at: expiresAt,
    });

    if (error) {
      console.warn("Cache write failed (non-blocking):", error.message);
    }
  } catch (e) {
    console.warn("Unexpected cache write error (non-blocking):", e);
  }
}
