// Rotas do fluxo de Conferencia de embarque - roda depois que o
// pedido ja passou por todo o fluxo de separacao (nota_liberada).
//
// Fluxo (confirmado com o usuario):
// 1. Colaborador abre o pedido na aba de Conferencia
// 2. Bipa o QR code de cada volume fisico - cada volume bipado e
// validado contra a lista real de volumes desse romaneio no
// ZenERP (GET /material/volume?q=outgoingList.id==X), pra evitar
// bipar volume de outro pedido por engano
// 3. Foto dos produtos que estao saindo (uma foto e suficiente)
// 4. Liberar embarque - acao SO NO NOSSO SISTEMA (nao chama o
// ZenERP). O colaborador informa o nome, e so libera se a
// quantidade de volumes bipados bater com a quantidade real de
// volumes do romaneio.
const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');

const router = express.Router();

async function buscarPedido(pedidoId) {
    const { rows } = await pool.query(
        `SELECT id, numero_erp, outgoing_list_id, etapa_separacao, foto_conferencia_base64
         FROM pedidos WHERE id = $1`,
        [pedidoId]
    );
    return rows[0] || null;
}

// GET /conferencia-erp/:pedidoId/volumes
// Lista os volumes reais do romaneio (do ZenERP) e marca quais ja
// foram conferidos (bipados) no nosso sistema.
router.get('/:pedidoId/volumes', async (req, res) => {
    try {
        const pedido = await buscarPedido(req.params.pedidoId);
        if (!pedido) {
            return res.status(404).json({ erro: 'Pedido nao encontrado' });
        }

        const respostaVolumes = await zenErpGet('/material/volume', {
            q: `outgoingList.id==${pedido.outgoing_list_id}`,
        });
        const volumesReais = respostaVolumes.data || [];

        const { rows: conferidos } = await pool.query(
            `SELECT volume_id_zenerp, volume_code, conferido_em FROM volumes_conferidos WHERE pedido_id = $1`,
            [pedido.id]
        );
        const conferidosPorId = new Map(conferidos.map((c) => [String(c.volume_id_zenerp), c]));

        const volumes = volumesReais.map((v) => ({
            id: v.id,
            code: v.code,
            checked: v.checked,
            loaded: v.loaded,
            conferido: conferidosPorId.has(String(v.id)),
            conferidoEm: conferidosPorId.get(String(v.id))?.conferido_em ?? null,
        }));

        res.json({
            totalVolumes: volumes.length,
            totalConferidos: conferidos.length,
            volumes,
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao consultar volumes no ZenERP', detalhe: erro?.response?.data });
    }
});

// POST /conferencia-erp/:pedidoId/conferir-volume
// Body: { codigo } - o QR code bipado (formato "VOL{id}")
router.post('/:pedidoId/conferir-volume', async (req, res) => {
    const codigoDigitado = String(req.body?.codigo || '').trim();
    if (!codigoDigitado) {
        return res.status(400).json({ erro: 'Informe o codigo do volume bipado' });
    }

    try {
        const pedido = await buscarPedido(req.params.pedidoId);
        if (!pedido) {
            return res.status(404).json({ erro: 'Pedido nao encontrado' });
        }

        // Confirma que esse volume pertence de verdade a esse romaneio
        const respostaVolumes = await zenErpGet('/material/volume', {
            q: `outgoingList.id==${pedido.outgoing_list_id}`,
        });
        const volumesReais = respostaVolumes.data || [];
        const volumeEncontrado = volumesReais.find(
            (v) => v.code === codigoDigitado || String(v.id) === codigoDigitado
        );
        if (!volumeEncontrado) {
            return res.status(400).json({ erro: `Volume ${codigoDigitado} nao pertence a este pedido` });
        }

        const { rowCount } = await pool.query(
            `INSERT INTO volumes_conferidos (pedido_id, volume_id_zenerp, volume_code)
             VALUES ($1, $2, $3)
             ON CONFLICT (pedido_id, volume_id_zenerp) DO NOTHING`,
            [pedido.id, volumeEncontrado.id, volumeEncontrado.code]
        );

        const { rows: conferidos } = await pool.query(
            `SELECT COUNT(*) AS total FROM volumes_conferidos WHERE pedido_id = $1`,
            [pedido.id]
        );

        res.json({
            status: rowCount > 0 ? 'volume_conferido' : 'volume_ja_conferido',
            volumeId: volumeEncontrado.id,
            volumeCode: volumeEncontrado.code,
            totalConferidos: Number(conferidos[0].total),
            totalVolumes: volumesReais.length,
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao conferir volume', detalhe: erro?.response?.data });
    }
});

// POST /conferencia-erp/:pedidoId/foto
// Body: { fotoBase64 } - foto unica dos produtos que estao saindo
router.post('/:pedidoId/foto', async (req, res) => {
    const { fotoBase64 } = req.body;
    if (!fotoBase64) {
        return res.status(400).json({ erro: 'Informe fotoBase64' });
    }
    try {
        const { rowCount } = await pool.query(
            `UPDATE pedidos SET foto_conferencia_base64 = $2 WHERE id = $1`,
            [req.params.pedidoId, fotoBase64]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Pedido nao encontrado' });
        }
        res.json({ status: 'foto_salva' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar foto' });
    }
});

// POST /conferencia-erp/:pedidoId/liberar-embarque
// Body: { colaborador }
// Trava de seguranca: so libera se TODOS os volumes reais do
// romaneio ja tiverem sido conferidos (quantidade bipada == total).
router.post('/:pedidoId/liberar-embarque', async (req, res) => {
    const colaborador = String(req.body?.colaborador || '').trim();
    if (!colaborador) {
        return res.status(400).json({ erro: 'Informe o nome do colaborador' });
    }

    try {
        const pedido = await buscarPedido(req.params.pedidoId);
        if (!pedido) {
            return res.status(404).json({ erro: 'Pedido nao encontrado' });
        }
        if (!pedido.foto_conferencia_base64) {
            return res.status(400).json({ erro: 'Tire a foto dos produtos antes de liberar o embarque' });
        }

        const respostaVolumes = await zenErpGet('/material/volume', {
            q: `outgoingList.id==${pedido.outgoing_list_id}`,
        });
        const volumesReais = respostaVolumes.data || [];

        const { rows: conferidos } = await pool.query(
            `SELECT COUNT(*) AS total FROM volumes_conferidos WHERE pedido_id = $1`,
            [pedido.id]
        );
        const totalConferidos = Number(conferidos[0].total);

        if (totalConferidos !== volumesReais.length || volumesReais.length === 0) {
            return res.status(409).json({
                erro: 'Quantidade de volumes conferidos nao bate com o total do romaneio',
                totalConferidos,
                totalVolumes: volumesReais.length,
            });
        }

        await pool.query(
            `INSERT INTO liberacoes_embarque (pedido_id, colaborador_nome) VALUES ($1, $2)`,
            [pedido.id, colaborador]
        );
        await pool.query(`UPDATE pedidos SET etapa_separacao = 'embarque_liberado' WHERE id = $1`, [pedido.id]);

        res.json({ status: 'embarque_liberado', colaborador, totalVolumes: volumesReais.length });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao liberar embarque', detalhe: erro?.response?.data });
    }
});

module.exports = router;
