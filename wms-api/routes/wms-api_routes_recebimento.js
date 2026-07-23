// ============================================================
// Rotas de recebimento
// Sem vínculo com pedido de compra: o conferente cadastra o que
// está chegando na hora, o sistema sugere a posição livre mais
// próxima e o operador confirma o put-away bipando o endereço.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// ------------------------------------------------------------
// Cria UM pallet: acha produto, acha endereço livre (ou usa o
// enderecoId informado), grava o pallet, ocupa o endereço,
// registra a movimentação, e reavalia pedidos pendentes desse
// produto. Usada tanto pelo recebimento avulso quanto pelo em
// massa (cada pallet do lote passa por aqui, um de cada vez).
// ------------------------------------------------------------
async function criarPalletRecebimento({ sku, quantidade, deposito, enderecoId, numerosSerie }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const produto = await client.query(`SELECT id, serializado FROM produtos WHERE sku = $1`, [sku]);
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return { erro: `Produto com SKU "${sku}" não está cadastrado`, status: 404 };
        }

        // Produto serializado (máquina): exige um número de série por
        // unidade da quantidade informada - sem isso não dá pra saber
        // qual máquina física está sendo guardada em cada posição.
        const listaSeries = Array.isArray(numerosSerie)
            ? numerosSerie.map((s) => String(s).trim()).filter(Boolean)
            : [];
        if (produto.rows[0].serializado && listaSeries.length !== quantidade) {
            await client.query('ROLLBACK');
            return {
                erro: `Produto serializado: informe exatamente ${quantidade} número(s) de série (recebido ${listaSeries.length})`,
                status: 400,
            };
        }

        let endereco;
        if (enderecoId) {
            endereco = await client.query(
                `SELECT id, codigo FROM enderecos WHERE id = $1 AND status = 'livre' FOR UPDATE`,
                [enderecoId]
            );
            if (endereco.rowCount === 0) {
                await client.query('ROLLBACK');
                return { erro: 'Esse endereço não está livre (ou não existe)', status: 409 };
            }
        } else {
            endereco = await client.query(
                `SELECT id, codigo FROM enderecos
                 WHERE status = 'livre'
                 ORDER BY rua, predio, andar
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
            );
            if (endereco.rowCount === 0) {
                await client.query('ROLLBACK');
                return { erro: 'Não há posições livres no vertical no momento', status: 409 };
            }
        }

        const etiquetaCodigo = `PLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const pallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [produto.rows[0].id, endereco.rows[0].id, deposito, quantidade, etiquetaCodigo]
        );

        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [endereco.rows[0].id]);

        await client.query(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, destino_tipo, destino_id)
             VALUES ($1, 'recebimento', $2, 'vertical', $3)`,
            [produto.rows[0].id, quantidade, endereco.rows[0].id]
        );

        if (produto.rows[0].serializado) {
            for (const serie of listaSeries) {
                await client.query(
                    `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, status)
                     VALUES ($1, $2, $3, $4, 'em_estoque')`,
                    [produto.rows[0].id, serie, pallet.rows[0].id, endereco.rows[0].id]
                );
            }
        }

        await client.query('COMMIT');

        await pool.query(`SELECT processar_alocacao_produto($1)`, [produto.rows[0].id]);

        return {
            palletId: pallet.rows[0].id,
            etiquetaCodigo,
            enderecoSugerido: endereco.rows[0].codigo,
            enderecoId: endereco.rows[0].id,
        };
    } catch (erro) {
        await client.query('ROLLBACK');
        if (erro.code === '23505' && erro.constraint === 'unidades_serializadas_numero_serie_key') {
            return { erro: 'Um dos números de série já está cadastrado em outra unidade', status: 409 };
        }
        console.error(erro);
        return { erro: 'Falha ao iniciar o recebimento', status: 500 };
    } finally {
        client.release();
    }
}

// POST /recebimento/iniciar
// Body: { sku, quantidade, deposito, enderecoId }
// Cria o pallet (ainda sem endereço definitivo) e já devolve a
// sugestão de onde guardar, pra tela do coletor mostrar na hora.
// O depósito escolhido descreve O QUE está sendo guardado (fica
// gravado no pallet) - o endereço em si é genérico, qualquer
// posição livre serve pra qualquer depósito.
// Se vier enderecoId, usa exatamente essa posição (precisa estar
// livre) em vez de escolher a mais próxima automaticamente.
router.post('/iniciar', async (req, res) => {
    const { sku, quantidade, deposito, enderecoId, numerosSerie } = req.body;
    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }

    const resultado = await criarPalletRecebimento({ sku, quantidade, deposito, enderecoId, numerosSerie });
    if (resultado.erro) {
        return res.status(resultado.status).json({ erro: resultado.erro });
    }
    res.json(resultado);
});

// POST /recebimento/iniciar-lote
// Body: { sku, quantidade, deposito, numeroPalletes }
// Igual ao /iniciar, só que cria vários pallets de uma vez - cada
// um pega uma posição livre diferente (sempre automático, não dá
// pra escolher endereço manual em lote). Se acabar posição livre
// no meio do caminho, para ali e devolve o que já deu certo.
router.post('/iniciar-lote', async (req, res) => {
    const { sku, quantidade, deposito, numeroPalletes, numerosSerie } = req.body;
    const numero = Number(numeroPalletes);

    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }
    if (!numero || numero <= 0) {
        return res.status(400).json({ erro: 'Informe o número de pallets (maior que zero)' });
    }

    // Se vier numerosSerie (produto serializado), é uma lista única
    // com TODOS os números do lote - cada pallet pega uma fatia do
    // tamanho da quantidade, na ordem em que foi enviada.
    if (numerosSerie && Array.isArray(numerosSerie) && numerosSerie.length !== quantidade * numero) {
        return res.status(400).json({
            erro: `Informe exatamente ${quantidade * numero} número(s) de série para ${numero} pallet(s) de ${quantidade} unidade(s) cada`,
        });
    }

    const gerados = [];
    let erroParcial = null;

    for (let i = 0; i < numero; i++) {
        const fatiaSeries = Array.isArray(numerosSerie) ? numerosSerie.slice(i * quantidade, (i + 1) * quantidade) : undefined;
        const resultado = await criarPalletRecebimento({ sku, quantidade, deposito, numerosSerie: fatiaSeries });
        if (resultado.erro) {
            erroParcial = resultado.erro;
            break;
        }
        gerados.push(resultado);
    }

    res.json({ gerados, total: gerados.length, solicitado: numero, erroParcial });
});

module.exports = router;
