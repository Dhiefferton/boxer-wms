-- ============================================================
-- WMS Boxer - Motor de alocação
-- ============================================================
-- Esta função roda toda vez que um item de pedido novo chega
-- (vindo do polling do ZenERP). Ela faz o trabalho pesado:
--
--   1. Soma quanto os pedidos abertos ainda precisam desse
--      produto (X_total), do pedido mais antigo pro mais novo.
--   2. Distribui o que existe no estoque flutuante (Y) entre
--      esses pedidos, na ordem de chegada (FIFO entre pedidos).
--   3. Se sobrar demanda sem cobertura, cria tarefas de
--      reposição puxando do pallet mais antigo do vertical
--      (FIFO dentro do vertical).
--
-- Nada fica "bloqueado": todo pedido recebe o que existe agora,
-- e o restante vira reposição automática.
-- ============================================================

CREATE OR REPLACE FUNCTION processar_alocacao_produto(p_produto_id UUID)
RETURNS VOID AS $$
DECLARE
    v_saldo_flutuante   INTEGER;
    v_restante          INTEGER;
    v_falta_total       INTEGER;
    v_falta_item        INTEGER;
    v_aloca             INTEGER;
    v_qtd_pallet        INTEGER;
    item                RECORD;
    pallet              RECORD;
BEGIN
    -- 1. Saldo atual do flutuante para esse produto (soma de todas as áreas)
    SELECT COALESCE(SUM(quantidade), 0)
    INTO v_saldo_flutuante
    FROM estoque_flutuante
    WHERE produto_id = p_produto_id;

    v_restante := v_saldo_flutuante;

    -- 2. Percorre os itens de pedido pendentes/parciais desse produto,
    --    do pedido mais antigo para o mais novo (FIFO entre pedidos).
    --    Cada um recebe o que der, respeitando o que já foi separado antes.
    FOR item IN
        SELECT ip.id, ip.quantidade_x, ip.quantidade_separada
        FROM itens_pedido ip
        JOIN pedidos p ON p.id = ip.pedido_id
        WHERE ip.produto_id = p_produto_id
          AND ip.status IN ('pendente', 'parcial')
        ORDER BY p.criado_em ASC
        FOR UPDATE OF ip
    LOOP
        v_falta_item := item.quantidade_x - item.quantidade_separada;

        IF v_falta_item <= 0 THEN
            CONTINUE;
        END IF;

        v_aloca := LEAST(v_falta_item, v_restante);

        IF v_aloca > 0 THEN
            -- Cria a tarefa de separação para o que está disponível agora
            INSERT INTO tarefas_separacao (item_pedido_id, quantidade, status)
            VALUES (item.id, v_aloca, 'pendente');

            UPDATE itens_pedido
            SET quantidade_separada = quantidade_separada + v_aloca,
                status = CASE
                    WHEN quantidade_separada + v_aloca >= quantidade_x THEN 'completo'
                    ELSE 'parcial'
                END
            WHERE id = item.id;

            -- Nota de simplificação (MVP): a baixa é feita no saldo
            -- agregado do produto, sem escolher de qual área tirar.
            -- Numa evolução futura dá pra decidir a área específica
            -- (ex: mais próxima da doca de expedição).
            UPDATE estoque_flutuante
            SET quantidade = GREATEST(quantidade - v_aloca, 0),
                atualizado_em = now()
            WHERE id = (
                SELECT id FROM estoque_flutuante
                WHERE produto_id = p_produto_id AND quantidade > 0
                ORDER BY quantidade DESC
                LIMIT 1
            );

            v_restante := v_restante - v_aloca;
        END IF;
    END LOOP;

    -- 3. Recalcula quanto ainda falta no total, depois da distribuição acima
    SELECT COALESCE(SUM(ip.quantidade_x - ip.quantidade_separada), 0)
    INTO v_falta_total
    FROM itens_pedido ip
    JOIN pedidos p ON p.id = ip.pedido_id
    WHERE ip.produto_id = p_produto_id
      AND ip.status IN ('pendente', 'parcial');

    -- 4. Se ainda falta, gera reposição puxando o pallet mais antigo primeiro
    IF v_falta_total > 0 THEN
        FOR pallet IN
            SELECT id, quantidade
            FROM pallets_vertical
            WHERE produto_id = p_produto_id AND quantidade > 0
            ORDER BY data_entrada ASC
            FOR UPDATE
        LOOP
            EXIT WHEN v_falta_total <= 0;

            v_qtd_pallet := LEAST(pallet.quantidade, v_falta_total);

            -- Evita criar tarefa duplicada se já existe uma pendente
            -- para esse mesmo pallet
            IF NOT EXISTS (
                SELECT 1 FROM tarefas_reposicao
                WHERE pallet_origem_id = pallet.id AND status = 'pendente'
            ) THEN
                INSERT INTO tarefas_reposicao (produto_id, pallet_origem_id, quantidade, status)
                VALUES (p_produto_id, pallet.id, v_qtd_pallet, 'pendente');

                v_falta_total := v_falta_total - v_qtd_pallet;
            END IF;
        END LOOP;
    END IF;

    -- 5. Sincroniza o status do pedido com o status agregado dos itens.
    --    Sem isso, a tela de acompanhamento de pedidos nunca mostrava
    --    "completo", porque só os itens eram atualizados, não o pedido.
    UPDATE pedidos p
    SET status = sub.novo_status
    FROM (
        SELECT ip.pedido_id,
            CASE
                WHEN bool_and(ip.status = 'completo') THEN 'completo'
                WHEN bool_or(ip.status IN ('completo', 'parcial')) THEN 'parcial'
                ELSE 'aberto'
            END AS novo_status
        FROM itens_pedido ip
        WHERE ip.pedido_id IN (
            SELECT DISTINCT pedido_id FROM itens_pedido WHERE produto_id = p_produto_id
        )
        GROUP BY ip.pedido_id
    ) sub
    WHERE p.id = sub.pedido_id
      AND p.status <> 'cancelado';
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Gatilho: toda vez que um item de pedido novo é inserido
-- (o job de polling do ZenERP grava aqui), o motor roda sozinho.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_itens_pedido_alocar()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM processar_alocacao_produto(NEW.produto_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS itens_pedido_after_insert ON itens_pedido;
CREATE TRIGGER itens_pedido_after_insert
AFTER INSERT ON itens_pedido
FOR EACH ROW EXECUTE FUNCTION trg_itens_pedido_alocar();

-- ============================================================
-- Como testar manualmente (exemplo):
--
--   SELECT processar_alocacao_produto('uuid-do-produto-aqui');
--
-- Depois, confira:
--   SELECT * FROM tarefas_separacao ORDER BY criado_em DESC;
--   SELECT * FROM tarefas_reposicao ORDER BY criado_em DESC;
-- ============================================================
