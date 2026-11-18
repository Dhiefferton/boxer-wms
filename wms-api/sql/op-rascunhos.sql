-- ============================================================
-- OPs em andamento (rascunho salvo no servidor) - 18/11/2026
-- Só ADICIONA uma tabela nova. Nada existente é alterado ou apagado.
-- Rode no SQL Editor do Supabase do WMS (escolha "Run and enable RLS").
-- Rollback: DROP TABLE op_rascunhos;
-- ============================================================
CREATE TABLE IF NOT EXISTS op_rascunhos (
  id            uuid PRIMARY KEY,
  receita_id    uuid NOT NULL REFERENCES op_receitas(id),
  quantidade    integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  seriais       jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacao    text,
  operador      varchar(120),
  computador    varchar(120),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_rascunhos_atualizado ON op_rascunhos(atualizado_em DESC);
