-- Renomear colunas da tabela analyses de português para inglês
ALTER TABLE analyses RENAME COLUMN "seu id" TO id;
ALTER TABLE analyses RENAME COLUMN criado_em TO created_at;
ALTER TABLE analyses RENAME COLUMN time_da_casa TO home_team;
ALTER TABLE analyses RENAME COLUMN "time visitante" TO away_team;
ALTER TABLE analyses RENAME COLUMN liga TO league;
ALTER TABLE analyses RENAME COLUMN "nível" TO tier;
ALTER TABLE analyses RENAME COLUMN mercado TO market;
ALTER TABLE analyses RENAME COLUMN prob_justo TO prob_fair;
-- prob_ia já está em inglês, mantém
ALTER TABLE analyses RENAME COLUMN afiado_bookmaker TO sharp_bookmaker;
ALTER TABLE analyses RENAME COLUMN "tem_referência" TO has_reference;
ALTER TABLE analyses RENAME COLUMN "ev_execução" TO ev_execution;
-- ev_market_deviation já está em inglês, mantém
ALTER TABLE analyses RENAME COLUMN kelly_calculado TO kelly_calculated;
ALTER TABLE analyses RENAME COLUMN "ia_confiança" TO ia_confidence;
ALTER TABLE analyses RENAME COLUMN "pontuação_composta" TO composite_score;
ALTER TABLE analyses RENAME COLUMN status_do_portão TO gate_status;
ALTER TABLE analyses RENAME COLUMN motivos_do_bloqueio TO block_reasons;
ALTER TABLE analyses RENAME COLUMN entrada_bruta_do_motor TO raw_engine_input;
ALTER TABLE analyses RENAME COLUMN "fonte de dados de Poisson" TO poisson_data_source;

-- Adicionar colunas que estão no payload mas podem não existir na tabela
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS odd_manual numeric(8,2);
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS odd_pinnacle numeric(8,2);
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS odd_betfair numeric(8,2);

-- Soltar NOT NULL de prob_ia (deve ser opcional quando análise é bloqueada)
ALTER TABLE analyses ALTER COLUMN prob_ia DROP NOT NULL;

-- Soltar NOT NULL de has_reference (default false em vez de NOT NULL)
ALTER TABLE analyses ALTER COLUMN has_reference SET DEFAULT false;
