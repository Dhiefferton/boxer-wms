// ============================================================
// Rotas do mapa de ruas (estoque vertical)
// Alimenta o dashboard: heatmap de ocupacao por predio/andar,
// os KPIs do topo, e o detalhe de um endereco quando clicado.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');
const configuracoes = require('../lib/configuracoes');

const router = express.Router();

// GET /enderecos/mapa
// Andar 1 (estoque flutuante) e os demais (vertical) nunca tem
// pallet/unidade de picking ao mesmo tempo no mesmo endereco, entao
// da pra juntar os dois com COALESCE nas mesmas colunas de saida
// (sku/descricao/quantidade) sem o front precisar saber de qual
// tabela veio - só quem precisa saber é o produto_reservado_*, que
// só existe (e só faz sentido) no flutuante.
// CORRIGIDO (25/09/2026, junto com o limite de 10 SKUs por posição do
// Estoque Devolução - ver nf-devolucao.js/enviarParaEstoqueDevolucao):
// essa query fazia `LEFT JOIN pallets_vertical pv ON pv.endereco_id =
// e.id` supondo NO MÁXIMO 1 pallet por endereço (verdade pra
// 'vertical'/'pulmao', nunca teve mais de 1 na prática) - com uma
// posição do Estoque Devolução podendo ter até 10 pallets agora, esse
// JOIN multiplicaria a mesma posição em várias linhas (uma por
// pallet), duplicando ela no Mapa de ruas. Trocado por um LEFT JOIN
// LATERAL: pra posição reservada ao Estoque Devolução, agrega TODOS os
// pallets dela num array JSON (`pallets_devolucao`); pra qualquer outra
// posição, comportamento idêntico a antes (1 pallet, colunas soltas).
//
// AJUSTADO (01/10/2026, "posição multi-SKU" - ver PUT /:id/multi-sku
// mais abaixo): mesmo problema de duplicação, agora pra QUALQUER
// posição do flutuante que o Dhiefferton converter em multi-SKU (não
// só as 4 fixas do Estoque Devolução) - ela pode ter várias linhas em
// unidades_picking (uma por modelo) ao mesmo tempo. O `up` singular
// continua só pra posição flutuante comum (1 modelo); multi-SKU
// agrega tudo em `picking_multi_sku` (mesmo padrão de
// `pallets_devolucao`, usando unidades_picking em vez de
// pallets_vertical).
router.get('/mapa', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                e.id,
                e.rua,
                e.predio,
                e.andar,
                e.codigo,
                e.status,
                e.bloqueio_motivo,
                e.produto_reservado_id,
                e.reservado_estoque_devolucao,
                e.multi_sku,
                pr.sku AS produto_reservado_sku,
                pr.descricao AS produto_reservado_descricao,
                pv.id AS pallet_id,
                pv.area_atual,
                up.id AS unidade_picking_id,
                pv.deposito,
                COALESCE(pv.quantidade, up.quantidade) AS quantidade,
                pv.etiqueta_codigo,
                pv.etiqueta_status,
                pv.teste_status,
                COALESCE(p.sku, pp.sku) AS sku,
                COALESCE(p.descricao, pp.descricao) AS descricao,
                COALESCE(p.codigo_barras, pp.codigo_barras) AS codigo_barras,
                (
                    SELECT ARRAY_AGG(us.numero_serie ORDER BY us.numero_serie)
                    FROM unidades_serializadas us
                    WHERE us.pallet_id = pv.id
                ) AS numeros_serie,
                devolucao.pallets AS pallets_devolucao,
                multisku.itens AS picking_multi_sku
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0 AND e.reservado_estoque_devolucao = false
            LEFT JOIN produtos p ON p.id = pv.produto_id
            LEFT JOIN unidades_picking up ON up.endereco_id = e.id AND e.multi_sku = false
            LEFT JOIN produtos pp ON pp.id = up.produto_id
            LEFT JOIN produtos pr ON pr.id = e.produto_reservado_id
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object(
                    'palletId', dpv.id,
                    'produtoId', dpv.produto_id,
                    'sku', dprod.sku,
                    'descricao', dprod.descricao,
                    'quantidade', dpv.quantidade,
                    'deposito', dpv.deposito,
                    'numerosSerie', (
                        SELECT ARRAY_AGG(us.numero_serie ORDER BY us.numero_serie)
                        FROM unidades_serializadas us
                        WHERE us.pallet_id = dpv.id
                    )
                ) ORDER BY dprod.sku) AS pallets
                FROM pallets_vertical dpv
                JOIN produtos dprod ON dprod.id = dpv.produto_id
                WHERE dpv.endereco_id = e.id AND e.reservado_estoque_devolucao = true
            ) devolucao ON true
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object(
                    'produtoId', mup.produto_id,
                    'sku', mprod.sku,
                    'descricao', mprod.descricao,
                    'quantidade', mup.quantidade
                ) ORDER BY mprod.sku) AS itens
                FROM unidades_picking mup
                JOIN produtos mprod ON mprod.id = mup.produto_id
                WHERE mup.endereco_id = e.id AND e.multi_sku = true
            ) multisku ON true
            ORDER BY e.predio, e.andar
        `);

        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o mapa de ruas' });
    }
});

// PUT /enderecos/:id/reserva-flutuante
// Body: { produtoId } - produtoId null/omitido limpa a reserva.
// Dedica (ou libera) uma posição do estoque flutuante (andar 1) a
// um modelo especifico - a partir daí, reposição/entrada só aceita
// esse produto ali (ver picking.js e tarefas.js). Não deixa
// trocar/limpar enquanto a posição ainda tem saldo: precisa
// esvaziar (consumir ou mover) antes, pra nunca sobrar estoque
// "órfão" de um produto diferente do que a posição passou a valer.
router.put('/:id/reserva-flutuante', async (req, res) => {
    const produtoId = req.body?.produtoId || null;
    try {
        const endereco = await pool.query(
            `SELECT andar, produto_reservado_id, multi_sku FROM enderecos WHERE id = $1`,
            [req.params.id]
        );
        if (endereco.rowCount === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }
        if (Number(endereco.rows[0].andar) !== 1) {
            return res.status(400).json({ erro: 'Só posições do estoque flutuante (andar 1) podem ser reservadas' });
        }
        // Posição multi-SKU (01/10/2026) não usa reserva de 1 modelo só -
        // precisa desativar o multi-SKU (PUT /:id/multi-sku) antes de
        // voltar a reservar um modelo específico aqui.
        if (endereco.rows[0].multi_sku) {
            return res.status(409).json({ erro: 'Essa posição está em modo multi-SKU - desative o multi-SKU antes de reservar um modelo específico' });
        }

        if (produtoId !== endereco.rows[0].produto_reservado_id) {
            const picking = await pool.query(
                `SELECT COALESCE(SUM(quantidade), 0) AS total FROM unidades_picking WHERE endereco_id = $1`,
                [req.params.id]
            );
            if (Number(picking.rows[0].total) > 0) {
                return res.status(409).json({ erro: 'Essa posição ainda tem estoque - esvazie antes de trocar ou limpar a reserva' });
            }
        }

        if (produtoId) {
            const produto = await pool.query(`SELECT id FROM produtos WHERE id = $1 AND ativo = true`, [produtoId]);
            if (produto.rowCount === 0) {
                return res.status(404).json({ erro: 'Produto não encontrado' });
            }
        }

        await pool.query(`UPDATE enderecos SET produto_reservado_id = $2 WHERE id = $1`, [req.params.id, produtoId]);
        res.json({ status: 'atualizado', produtoReservadoId: produtoId });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar reserva da posição' });
    }
});

// PUT /enderecos/:id/multi-sku (01/10/2026, a pedido do Dhiefferton:
// "libere essas posições pra aceitar mais de um sku" - R6-A-A1,
// R6-B-A1, R7-A-A1, R7-B-A1, já com estoque de um modelo cada,
// mantendo o que já tinha).
// Body: { ativar: boolean }
// Generaliza pra qualquer posição do flutuante (andar 1) o mesmo
// mecanismo já usado nas 4 posições fixas do Estoque Devolução: até
// LIMITE_SKUS_MULTI_PICKING modelos diferentes dividindo a mesma
// posição (ver picking.js/repor e tarefas.js/reposicao/:id/confirmar).
// Ativar: limpa a reserva de 1 modelo (produto_reservado_id) - o
// estoque que já estava lá NÃO é mexido, só deixa de ser a única coisa
// que pode ocupar essa posição. Desativar: só permitido com no máximo
// 1 modelo diferente ocupando a posição no momento (senão não tem como
// saber qual vira "o" modelo reservado) - com exatamente 1, a reserva
// desse modelo é restaurada sozinha, sem precisar reservar nada nela
// de novo.
// Limite de modelos por posição multi-SKU: configuração
// 'limite_skus_multi_picking' (padrão 10 = valor que era fixo aqui).
router.put('/:id/multi-sku', async (req, res) => {
    const ativar = !!req.body?.ativar;
    try {
        const endereco = await pool.query(
            `SELECT andar, multi_sku, reservado_estoque_devolucao FROM enderecos WHERE id = $1`,
            [req.params.id]
        );
        if (endereco.rowCount === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }
        if (Number(endereco.rows[0].andar) !== 1) {
            return res.status(400).json({ erro: 'Só posições do estoque flutuante (andar 1) podem virar multi-SKU' });
        }
        if (endereco.rows[0].reservado_estoque_devolucao) {
            return res.status(400).json({ erro: 'Essa posição já é fixa do Estoque Devolução - não precisa (e não pode) virar multi-SKU também' });
        }

        if (ativar) {
            if (endereco.rows[0].multi_sku) {
                return res.json({ status: 'ja_ativo', multiSku: true });
            }
            await pool.query(
                `UPDATE enderecos SET multi_sku = true, produto_reservado_id = NULL WHERE id = $1`,
                [req.params.id]
            );
            return res.json({ status: 'ativado', multiSku: true, limite: await configuracoes.valor(pool, 'limite_skus_multi_picking') });
        }

        if (!endereco.rows[0].multi_sku) {
            return res.json({ status: 'ja_inativo', multiSku: false });
        }

        const ocupantes = await pool.query(
            `SELECT produto_id FROM unidades_picking WHERE endereco_id = $1 AND quantidade > 0`,
            [req.params.id]
        );
        if (ocupantes.rowCount > 1) {
            return res.status(409).json({
                erro: `Essa posição ainda tem ${ocupantes.rowCount} modelos diferentes guardados - reduza a 1 (ou esvazie) antes de desativar o multi-SKU`,
            });
        }

        const produtoRestante = ocupantes.rowCount === 1 ? ocupantes.rows[0].produto_id : null;
        await pool.query(
            `UPDATE enderecos SET multi_sku = false, produto_reservado_id = $2 WHERE id = $1`,
            [req.params.id, produtoRestante]
        );
        res.json({ status: 'desativado', multiSku: false, produtoReservadoId: produtoRestante });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar o modo multi-SKU da posição' });
    }
});

// POST /enderecos/:id/multi-sku/adicionar-sku (02/10/2026, a pedido do
// Dhiefferton: "para eu conseguir cadastrar mais um sku preciso fazer
// uma reposição, eu quero a opção de sempre adicionar os itens,
// selecionando na tela, igual sempre foi") - posição comum (não
// multi-SKU) já deixava reservar um modelo direto pela tela, sem
// precisar de estoque nenhum (PUT /:id/reserva-flutuante). Posição
// multi-SKU não tinha esse mesmo atalho: só dava pra "cadastrar" um
// modelo novo ali fazendo uma reposição de verdade primeiro (a linha
// em unidades_picking só nascia através de um movimento físico de
// estoque). Essa rota cria a linha direto, com quantidade=0 - mesma
// ideia de "reservado, vazio" que a posição comum já usa - pra
// aparecer na lista da posição mesmo antes de qualquer reposição
// acontecer. GET /mapa também precisou soltar o filtro
// `quantidade > 0` do array picking_multi_sku pra essa linha vazia
// aparecer (ver comentário lá).
// Body: { produtoId }
router.post('/:id/multi-sku/adicionar-sku', async (req, res) => {
    const produtoId = req.body?.produtoId || null;
    if (!produtoId) {
        return res.status(400).json({ erro: 'Informe o produtoId' });
    }
    try {
        const endereco = await pool.query(
            `SELECT andar, multi_sku FROM enderecos WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (endereco.rowCount === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }
        if (Number(endereco.rows[0].andar) !== 1) {
            return res.status(400).json({ erro: 'Só posições do estoque flutuante (andar 1) aceitam SKU cadastrado assim' });
        }
        if (!endereco.rows[0].multi_sku) {
            return res.status(400).json({ erro: 'Essa posição não está em modo multi-SKU - ative o multi-SKU antes (ou use a reserva comum)' });
        }

        const produto = await pool.query(`SELECT id FROM produtos WHERE id = $1 AND ativo = true`, [produtoId]);
        if (produto.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }

        const existente = await pool.query(
            `SELECT id FROM unidades_picking WHERE endereco_id = $1 AND produto_id = $2`,
            [req.params.id, produtoId]
        );
        if (existente.rowCount > 0) {
            return res.status(409).json({ erro: 'Esse modelo já está cadastrado nessa posição' });
        }

        const distintos = await pool.query(
            `SELECT COUNT(*) AS qtd FROM unidades_picking WHERE endereco_id = $1`,
            [req.params.id]
        );
        const limiteSkus = await configuracoes.valor(pool, 'limite_skus_multi_picking');
        if (Number(distintos.rows[0].qtd) >= limiteSkus) {
            return res.status(409).json({
                erro: `Essa posição multi-SKU já está com ${limiteSkus} modelos diferentes - remova (esvazie) algum antes de adicionar outro`,
            });
        }

        await pool.query(
            `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, 0)`,
            [produtoId, req.params.id]
        );
        await pool.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [req.params.id]);

        res.status(201).json({ status: 'adicionado', produtoId });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao adicionar SKU na posição multi-SKU' });
    }
});

// GET /enderecos/kpis
// CORRECAO 17/09/2026: os 3 contadores de posicao (livres/ocupadas/
// bloqueadas) somavam TODOS os enderecos, inclusive andar 1 - que e o
// estoque flutuante (area aberta no chao, sem posicao vertical de
// verdade), nao uma posicao do prédio/andar que faz sentido contar
// aqui. Isso inflava "Posicoes livres" (132 dos 137 mostrados eram do
// andar 1). Mesma exclusao "andar <> 1" ja usada em
// montarFiltroIntervalo (bloquear-lote/desbloquear-lote) mais abaixo
// neste arquivo, agora aplicada tambem aqui.
router.get('/kpis', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'livre') AS posicoes_livres,
                COUNT(*) FILTER (WHERE status = 'ocupado') AS posicoes_ocupadas,
                COUNT(*) FILTER (WHERE status = 'bloqueado') AS posicoes_bloqueadas,
                (SELECT COUNT(DISTINCT produto_id) FROM pallets_vertical WHERE quantidade > 0) AS produtos_distintos,
                (SELECT COALESCE(SUM(quantidade), 0) FROM pallets_vertical) AS soma_produtos
            FROM enderecos
            WHERE andar <> 1
        `);

        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao calcular os KPIs' });
    }
});

// Monta o WHERE compartilhado por bloquear-lote/desbloquear-lote: rua
// obrigatória, andar 1 sempre fora (estoque flutuante, não é posição
// vertical de verdade - nunca recebe pallet nem faz sentido bloquear),
// e prédio/andar viram um filtro de intervalo só quando os dois limites
// (de/até) vêm preenchidos - vazio = a rua inteira.
function montarFiltroIntervalo({ rua, predioDe, predioAte, andarDe, andarAte }) {
    const condicoes = ['rua = $1', 'andar <> 1'];
    const params = [rua];
    if (predioDe && predioAte) {
        const [min, max] = [predioDe, predioAte].sort();
        params.push(min, max);
        condicoes.push(`predio >= $${params.length - 1} AND predio <= $${params.length}`);
    }
    if (andarDe !== undefined && andarDe !== null && andarDe !== '' && andarAte !== undefined && andarAte !== null && andarAte !== '') {
        const min = Math.min(Number(andarDe), Number(andarAte));
        const max = Math.max(Number(andarDe), Number(andarAte));
        params.push(min, max);
        condicoes.push(`andar >= $${params.length - 1} AND andar <= $${params.length}`);
    }
    return { where: condicoes.join(' AND '), params };
}

// POST /enderecos/bloquear-lote
// Reserva (bloqueia) de uma vez todo endereço LIVRE de uma rua inteira
// ou de um bloco prédio x andar dentro dela (ex.: pra separar um
// trecho pra AVARIAS). Endereço já ocupado ou já bloqueado no meio do
// intervalo é ignorado, não trava o lote inteiro.
router.post('/bloquear-lote', async (req, res) => {
    const { rua, predioDe, predioAte, andarDe, andarAte, motivo } = req.body;
    const motivoLimpo = (motivo || '').trim();
    if (!rua) {
        return res.status(400).json({ erro: 'Informe a rua' });
    }
    if (!motivoLimpo) {
        return res.status(400).json({ erro: 'Informe o motivo do bloqueio' });
    }

    const { where, params } = montarFiltroIntervalo({ rua, predioDe, predioAte, andarDe, andarAte });

    try {
        const { rows: noIntervalo } = await pool.query(`SELECT id FROM enderecos WHERE ${where}`, params);
        if (noIntervalo.length === 0) {
            return res.status(404).json({ erro: 'Nenhum endereço encontrado com esses filtros' });
        }

        const paramsUpdate = [...params, motivoLimpo];
        const { rows } = await pool.query(
            `UPDATE enderecos SET status = 'bloqueado', bloqueio_motivo = $${paramsUpdate.length}
             WHERE ${where} AND status = 'livre'
             RETURNING codigo`,
            paramsUpdate
        );

        res.json({
            bloqueados: rows.length,
            ignorados: noIntervalo.length - rows.length,
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao bloquear endereços' });
    }
});

// POST /enderecos/desbloquear-lote
// Contrário do bloquear-lote: devolve pra livre todo endereço
// BLOQUEADO da rua inteira ou do bloco escolhido. Endereço que não
// estava bloqueado (livre ou ocupado) simplesmente não é afetado.
router.post('/desbloquear-lote', async (req, res) => {
    const { rua, predioDe, predioAte, andarDe, andarAte } = req.body;
    if (!rua) {
        return res.status(400).json({ erro: 'Informe a rua' });
    }

    const { where, params } = montarFiltroIntervalo({ rua, predioDe, predioAte, andarDe, andarAte });

    try {
        const { rows } = await pool.query(
            `UPDATE enderecos SET status = 'livre', bloqueio_motivo = NULL
             WHERE ${where} AND status = 'bloqueado'
             RETURNING codigo`,
            params
        );
        res.json({ liberados: rows.length });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao desbloquear endereços' });
    }
});

// GET /enderecos/buscar?codigo=XXXX
// Acha um endereco pelo codigo visual (ex: R1-N-A2) - usado pelo
// coletor pra resolver o id a partir do que foi bipado, sem
// precisar carregar UUID em telas de bipagem.
router.get('/buscar', async (req, res) => {
    const codigo = (req.query.codigo || '').trim();
    if (!codigo) {
        return res.status(400).json({ erro: 'Informe o código' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT id, codigo, rua, predio, andar, status FROM enderecos WHERE codigo = $1 LIMIT 1`,
            [codigo]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: `Nenhum endereço encontrado com o código "${codigo}"` });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao buscar endereço' });
    }
});

// GET /enderecos/:id
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `
            SELECT e.*, pv.id AS pallet_id, pv.deposito, pv.quantidade, pv.data_entrada,
                   pv.etiqueta_status, pv.teste_status, p.sku, p.descricao
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE e.id = $1
            `,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }

        const endereco = rows[0];
        if (endereco.pallet_id) {
            const unidades = await pool.query(
                `SELECT id, numero_serie, status FROM unidades_serializadas WHERE pallet_id = $1 ORDER BY numero_serie`,
                [endereco.pallet_id]
            );
            endereco.numeros_serie = unidades.rows;
        }

        res.json(endereco);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o endereço' });
    }
});

// DELETE /enderecos/:id/pallet
router.delete('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        await client.query(`UPDATE pallets_vertical SET quantidade = 0 WHERE id = $1`, [pallet.rows[0].id]);
        await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);

        const unidades = await client.query(
            `SELECT id, numero_serie FROM unidades_serializadas WHERE pallet_id = $1`,
            [pallet.rows[0].id]
        );

        if (unidades.rowCount > 0) {
            await client.query(
                `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                 WHERE pallet_id = $1`,
                [pallet.rows[0].id]
            );
            for (const unidade of unidades.rows) {
                await registrarMovimento(client, {
                    produtoId: pallet.rows[0].produto_id,
                    tipo: 'ajuste_manual',
                    quantidade: 1,
                    origemTipo: 'vertical',
                    origemId: req.params.id,
                    destinoTipo: 'externo',
                    unidadeSerializadaId: unidade.id,
                    numeroSerieSnapshot: unidade.numero_serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: pallet.rows[0].produto_id,
                tipo: 'ajuste_manual',
                quantidade: pallet.rows[0].quantidade,
                origemTipo: 'vertical',
                origemId: req.params.id,
                destinoTipo: 'externo',
            });
        }

        await client.query('COMMIT');
        res.json({ status: 'liberado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir alocação do endereço' });
    } finally {
        client.release();
    }
});

// PATCH /enderecos/:id/pallet
router.patch('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        const quantidadeExcluir = Number(req.body?.quantidade);
        const numerosSerie = Array.isArray(req.body?.numerosSerie)
            ? req.body.numerosSerie.map((s) => String(s).trim()).filter(Boolean)
            : [];
        if (!Number.isFinite(quantidadeExcluir) || quantidadeExcluir <= 0) {
            client.release();
            return res.status(400).json({ erro: 'Informe uma quantidade válida maior que zero' });
        }

        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        const atual = pallet.rows[0].quantidade;
        if (quantidadeExcluir > atual) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: `Quantidade maior que o saldo alocado (${atual})` });
        }

        const unidadesLigadas = await client.query(
            `SELECT id, numero_serie FROM unidades_serializadas WHERE pallet_id = $1`,
            [pallet.rows[0].id]
        );

        let unidadesRemovidas = [];
        if (unidadesLigadas.rowCount > 0) {
            if (numerosSerie.length !== quantidadeExcluir) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    erro: `Este pallet é serializado: informe exatamente ${quantidadeExcluir} número(s) de série pra excluir`,
                });
            }
            const seriesValidas = new Set(unidadesLigadas.rows.map((u) => u.numero_serie));
            const invalidas = numerosSerie.filter((s) => !seriesValidas.has(s));
            if (invalidas.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ erro: `Número(s) de série não encontrado(s) neste pallet: ${invalidas.join(', ')}` });
            }
            unidadesRemovidas = unidadesLigadas.rows.filter((u) => numerosSerie.includes(u.numero_serie));
            await client.query(
                `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                 WHERE pallet_id = $1 AND numero_serie = ANY($2::text[])`,
                [pallet.rows[0].id, numerosSerie]
            );
        }

        const restante = atual - quantidadeExcluir;
        await client.query(`UPDATE pallets_vertical SET quantidade = $1 WHERE id = $2`, [restante, pallet.rows[0].id]);

        if (restante === 0) {
            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);
        }

        if (unidadesRemovidas.length > 0) {
            for (const unidade of unidadesRemovidas) {
                await registrarMovimento(client, {
                    produtoId: pallet.rows[0].produto_id,
                    tipo: 'ajuste_manual',
                    quantidade: 1,
                    origemTipo: 'vertical',
                    origemId: req.params.id,
                    destinoTipo: 'externo',
                    unidadeSerializadaId: unidade.id,
                    numeroSerieSnapshot: unidade.numero_serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: pallet.rows[0].produto_id,
                tipo: 'ajuste_manual',
                quantidade: quantidadeExcluir,
                origemTipo: 'vertical',
                origemId: req.params.id,
                destinoTipo: 'externo',
            });
        }

        await client.query('COMMIT');
        res.json({ status: restante === 0 ? 'liberado' : 'reduzido', quantidade_restante: restante });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao reduzir alocação do endereço' });
    } finally {
        client.release();
    }
});

module.exports = router;
