/**
 * A Odds API responde HTTP 401 tanto para chave inválida quanto para créditos esgotados
 * (`error_code: OUT_OF_USAGE_CREDITS`) — o status sozinho não diferencia. Os dois casos
 * pedem ações diferentes (trocar a chave × esperar a renovação/subir de plano), então o
 * cliente olha o corpo do 401 para escolher a mensagem certa.
 */
export const OUT_OF_CREDITS_STATUS = 'OUT_OF_USAGE_CREDITS';

/** Lê o corpo de um clone, sem consumir a resposta original. Nunca lança. */
export async function isOutOfCredits(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.error_code === OUT_OF_CREDITS_STATUS;
  } catch {
    return false;
  }
}
