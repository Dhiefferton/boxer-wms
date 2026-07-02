-- ============================================================
-- WMS Boxer - Schema de banco de dados (PostgreSQL)
-- ============================================================
-- Este arquivo cria todas as tabelas do sistema. Pode ser
-- executado de uma vez só num banco PostgreSQL vazio.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. PRODUTOS
-- ------------------------------------------------------------
CREATE TABLE produtos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku             VARCHAR(50) NOT NULL UNIQUE,
    descricao       VARCHAR(255) NOT NULL,
    estoque_minimo  INTEGER NOT NULL DEFAULT 0,
    estoque_maximo  INTEGER,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. ENDERECOS (ruas do estoque vertical)
-- ------------------------------------------------------------
CREATE TABLE enderecos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rack            VARCHAR(20) NOT NULL,
    predio          VARCHAR(5) NOT NULL,
    andar           INTEGER NOT NULL,
    posicao         VARCHAR(10) NOT NULL,
    codigo          VARCHAR(50) NOT NULL UNIQUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'livre'
                    CHECK (status IN ('livre', 'ocupado', 'bloqueado')),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enderecos_status ON enderecos(status);
CREATE INDEX idx_enderecos_predio_andar ON enderecos(predio, andar);

-- ------------------------------------------------------------
-- 3. AREAS_FLUTUANTE
-- ------------------------------------------------------------
CREATE TABLE areas_flutuante (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome            VARCHAR(100) NOT NULL,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. PALLETS_VERTICAL
-- ------------------------------------------------------------
CREATE TABLE pallets_vertical (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id          UUID NOT NULL REFERENCES produtos(id),
    endereco_id         UUID NOT NULL REFERENCES enderecos(id),
    quantidade          INTEGER NOT NULL CHECK (quantidade >= 0),
    data_entrada        TIMESTAMPTZ NOT NULL DEFAULT now(),
    etiqueta_codigo     VARCHAR(50) UNIQUE,
    etiqueta_status     VARCHAR(20) NOT NULL DEFAULT 'sem_etiqueta'
                        CHECK (etiqueta_status IN ('com_etiqueta', 'sem_etiqueta')),
    teste_status        VARCHAR(20) NOT NULL DEFAULT 'nao_testado'
                        CHECK (teste_status IN ('testado', 'nao_testado')),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pallets_produto ON pallets_vertical(produto_id);
CREATE INDEX idx_pallets_endereco ON pallets_vertical(endereco_id);
CREATE INDEX idx_pallets_fifo ON pallets_vertical(produto_id, data_entrada);

-- ------------------------------------------------------------
-- 5. ESTOQUE_FLUTUANTE
-- ------------------------------------------------------------
CREATE TABLE estoque_flutuante (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id      UUID NOT NULL REFERENCES produtos(id),
    area_id         UUID REFERENCES areas_flutuante(id),
    quantidade      INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (produto_id, area_id)
);

CREATE INDEX idx_flutuante_produto ON estoque_flutuante(produto_id);

-- ------------------------------------------------------------
-- 6. PEDIDOS
-- ------------------------------------------------------------
CREATE TABLE pedidos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    numero_erp      VARCHAR(50) NOT NULL UNIQUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto', 'parcial', 'completo', 'cancelado')),
    sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedidos_status ON pedidos(status);
CREATE INDEX idx_pedidos_criado_em ON pedidos(criado_em);

-- ------------------------------------------------------------
-- 7. ITENS_PEDIDO
-- ------------------------------------------------------------
CREATE TABLE itens_pedido (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pedido_id               UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    produto_id              UUID NOT NULL REFERENCES produtos(id),
    quantidade_x            INTEGER NOT NULL CHECK (quantidade_x > 0),
    quantidade_separada     INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_separada >= 0),
    status                  VARCHAR(20) NOT NULL DEFAULT 'pendente'
                            CHECK (status IN ('pendente', 'parcial', 'completo')),
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (quantidade_separada <= quantidade_x)
);

CREATE INDEX idx_itens_pedido_produto ON itens_pedido(produto_id);
CREATE INDEX idx_itens_pedido_status ON itens_pedido(status);

-- ------------------------------------------------------------
-- 8. TAREFAS_SEPARACAO
-- ------------------------------------------------------------
CREATE TABLE tarefas_separacao (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_pedido_id      UUID NOT NULL REFERENCES itens_pedido(id) ON DELETE CASCADE,
    area_flutuante_id   UUID REFERENCES areas_flutuante(id),
    quantidade          INTEGER NOT NULL CHECK (quantidade > 0),
    status              VARCHAR(20) NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'divergente')),
    operador             VARCHAR(100),
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em         TIMESTAMPTZ
);

CREATE INDEX idx_tarefas_sep_status ON tarefas_separacao(status);
CREATE INDEX idx_tarefas_sep_item ON tarefas_separacao(item_pedido_id);

-- ------------------------------------------------------------
-- 9. TAREFAS_REPOSICAO
-- ------------------------------------------------------------
CREATE TABLE tarefas_reposicao (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id          UUID NOT NULL REFERENCES produtos(id),
    pallet_origem_id    UUID NOT NULL REFERENCES pallets_vertical(id),
    area_destino_id     UUID REFERENCES areas_flutuante(id),
    quantidade          INTEGER NOT NULL CHECK (quantidade > 0),
    status              VARCHAR(20) NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'em_andamento', 'concluida')),
    operador            VARCHAR(100),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em        TIMESTAMPTZ
);

CREATE INDEX idx_tarefas_rep_status ON tarefas_reposicao(status);
CREATE INDEX idx_tarefas_rep_produto ON tarefas_reposicao(produto_id);

-- ------------------------------------------------------------
-- 10. MOVIMENTACOES
-- ------------------------------------------------------------
CREATE TABLE movimentacoes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id      UUID NOT NULL REFERENCES produtos(id),
    tipo            VARCHAR(30) NOT NULL
                    CHECK (tipo IN ('recebimento', 'separacao', 'reposicao', 'ajuste_inventario')),
    quantidade      INTEGER NOT NULL,
    origem_tipo     VARCHAR(20) CHECK (origem_tipo IN ('vertical', 'flutuante', 'externo')),
    origem_id       UUID,
    destino_tipo    VARCHAR(20) CHECK (destino_tipo IN ('vertical', 'flutuante', 'externo')),
    destino_id      UUID,
    operador        VARCHAR(100),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimentacoes_produto ON movimentacoes(produto_id);
CREATE INDEX idx_movimentacoes_tipo ON movimentacoes(tipo);
CREATE INDEX idx_movimentacoes_criado_em ON movimentacoes(criado_em);

-- ------------------------------------------------------------
-- 11. CONTAGENS_INVENTARIO
-- ------------------------------------------------------------
CREATE TABLE contagens_inventario (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('ciclico', 'geral')),
    produto_id          UUID NOT NULL REFERENCES produtos(id),
    endereco_id         UUID REFERENCES enderecos(id),
    area_flutuante_id   UUID REFERENCES areas_flutuante(id),
    saldo_esperado      INTEGER NOT NULL,
    quantidade_contada  INTEGER,
    numero_contagem     INTEGER NOT NULL DEFAULT 1 CHECK (numero_contagem IN (1, 2)),
    contagem_pai_id     UUID REFERENCES contagens_inventario(id),
    operador            VARCHAR(100),
    status              VARCHAR(20) NOT NULL DEFAULT 'pendente'
                        CHECK (status IN (
                            'pendente', 'bateu', 'aguardando_segunda',
                            'ajustado', 'escalonado', 'aprovado'
                        )),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em        TIMESTAMPTZ
);

CREATE INDEX idx_contagens_status ON contagens_inventario(status);
CREATE INDEX idx_contagens_produto ON contagens_inventario(produto_id);
CREATE INDEX idx_contagens_pai ON contagens_inventario(contagem_pai_id);

-- ------------------------------------------------------------
-- 12. APROVACOES_DIVERGENCIA
-- ------------------------------------------------------------
CREATE TABLE aprovacoes_divergencia (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contagem_id             UUID NOT NULL REFERENCES contagens_inventario(id),
    quantidade_aprovada     INTEGER NOT NULL,
    supervisor              VARCHAR(100) NOT NULL,
    observacao              TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Fim do schema.
-- ============================================================
