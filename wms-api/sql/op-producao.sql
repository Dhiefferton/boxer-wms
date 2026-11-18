-- ============================================================
-- Ordens de Produção (OP) - 18/11/2026
-- Só ADICIONA: nenhuma tabela/coluna existente é alterada ou apagada.
-- Rode no SQL Editor do Supabase do WMS (escolha "Run and enable RLS").
-- ============================================================

-- 0) Trava de segurança: se existir CHECK em movimentacoes que restrinja
--    o 'tipo' e NÃO aceite os tipos novos, aborta aqui (nada é criado) e
--    mostra a definição - aí a gente ajusta com você antes de seguir.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'movimentacoes'::regclass AND contype = 'c'
  LOOP
    IF c.def ~* '\ytipo\y' AND c.def !~* 'op_producao' AND c.def !~* 'origem_tipo|destino_tipo' THEN
      RAISE EXCEPTION 'CHECK em movimentacoes.tipo nao aceita op_producao/op_consumo: % -> %', c.conname, c.def;
    END IF;
  END LOOP;
END $$;

-- 1) Numeração das OPs (OP-000001, ...)
CREATE SEQUENCE IF NOT EXISTS op_numero_seq START 1;

-- 2) Receitas (o que vira o quê)
CREATE TABLE IF NOT EXISTS op_receitas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             varchar(120) NOT NULL,
  produto_final_id uuid NOT NULL REFERENCES produtos(id),
  quantidade_final integer NOT NULL DEFAULT 1 CHECK (quantidade_final > 0),
  ativo            boolean NOT NULL DEFAULT true,
  criado_por       varchar(120),
  criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS op_receita_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receita_id  uuid NOT NULL REFERENCES op_receitas(id),
  produto_id  uuid NOT NULL REFERENCES produtos(id),
  quantidade  integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  UNIQUE (receita_id, produto_id)
);

-- 3) Ordens de produção
CREATE TABLE IF NOT EXISTS ordens_producao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           varchar(20) NOT NULL UNIQUE,
  receita_id       uuid NOT NULL REFERENCES op_receitas(id),
  produto_final_id uuid NOT NULL REFERENCES produtos(id),
  quantidade       integer NOT NULL CHECK (quantidade > 0),
  status           varchar(20) NOT NULL DEFAULT 'concluida',
  pallet_id        uuid,
  etiqueta_codigo  varchar(40),
  operador         varchar(120),
  observacao       text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

-- 4) Rastreio: qual serial entrou em qual peça nova
CREATE TABLE IF NOT EXISTS op_consumos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id         uuid NOT NULL REFERENCES ordens_producao(id),
  unidade_id    uuid NOT NULL,
  produto_id    uuid NOT NULL REFERENCES produtos(id),
  numero_serie  varchar(80) NOT NULL,
  unidade_final_id uuid
);

CREATE TABLE IF NOT EXISTS op_producoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id         uuid NOT NULL REFERENCES ordens_producao(id),
  unidade_id    uuid NOT NULL,
  produto_id    uuid NOT NULL REFERENCES produtos(id),
  numero_serie  varchar(80) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_consumos_op ON op_consumos(op_id);
CREATE INDEX IF NOT EXISTS idx_op_consumos_unidade ON op_consumos(unidade_id);
CREATE INDEX IF NOT EXISTS idx_op_producoes_op ON op_producoes(op_id);
