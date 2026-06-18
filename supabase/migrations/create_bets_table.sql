-- Criar tabela de apostas para rastreamento de resultados (Feature 2)
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  
  -- Decisão
  market text NOT NULL,
  odd_taken numeric(8,2) NOT NULL,
  stake_amount numeric(10,2) NOT NULL,
  bookmaker text DEFAULT 'bet365',
  
  -- Resultado
  status text DEFAULT 'pending', -- 'pending' | 'green' | 'red' | 'void' | 'cashout'
  result_amount numeric(10,2),
  settled_at timestamptz,
  
  -- Análise pós-mortem
  match_score text, -- "2-1" etc
  closing_odd numeric(8,2), -- pra calcular CLV real
  notes text
);

-- Adicionar coluna match_datetime na tabela analyses se não existir (necessário para Feature 1)
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS match_datetime timestamptz;
