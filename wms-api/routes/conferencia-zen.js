// ============================================================
// Conferência de embarque - ORIGEM NO ZEN (flag 'conferencia_embarque_zen', padrão DESLIGADA)
//
// Em vez de partir das ordens da Separação (pedidos.nota_liberada) e descobrir o envio de cada uma,
// parte do próprio Zen, em 3 passos EM LOTE (botão "Buscar envios no Zen" no coletor):
//   1. envios com status PREPARANDO        GET /shipping/shipment?q=status=="PREPARING"          (1 chamada)
//   2. todas as notas desses envios        GET /fiscal/outgoingInvoice?q=(shipment.id==1,...)    (1 por 20 envios)
//   3. todos os volumes dessas notas       GET /material/volume?q=(outgoingList.id==a,...)       (1 por 25 romaneios)
// Só LÊ o Zen (nada é gravado lá). Não grava nada no WMS: o progresso vem de volumes_conferidos e de
// pedidos (local), então o fluxo atual de conferência por ordem/volume continua igual.
//
// Rotas (montadas em conferencia-erp.js, ANTES das rotas '/:pedidoId/...'):
//   GET  /conferencia-erp/zen/status      -> { ativo }                (só flag, sem Zen)
//   POST /conferencia-erp/zen/buscar      -> envios > notas > volumes (3 chamadas em lote ao Zen)
//   GET  /conferencia-erp/zen/progresso   -> ?romaneios=1,2,3 - progresso LOCAL (sem Zen)
//   POST /conferencia-erp/zen/trazer-ordem -> { romaneioId } cria/traz a ordem de origem externa da nota que
//        nao tem ordem no WMS (mesma logica ja usada pela busca de envio) pra conferir e liberar junto com as demais
//
// Segurança: flag 'conferencia_embarque_zen' (Controle de acesso > Funções) + kill switch
// CONFERENCIA_ZEN_DESLIGADO=1 na Vercel. Qualquer falha responde erro claro; a lista atual segue intacta.
// ============================================================
const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');
const { exigirCargo } = require('../auth');
const { flagAtiva } = require('../lib/feature-flags');
const { trazerOrdensExternas } = require('./envio-assinatura');

const router = express.Router();

const FLAG = 'conferencia_embarque_zen';
const MAX_ENVIOS = 100; // envios PREPARANDO trazidos por busca
const LOTE_ENVIOS = 20; // envios por chamada de notas
const LOTE_ROMANEIOS = 25; // romaneios por chamada de volumes
const NOTAS_POR_CHAMADA = 500;
const VOLUMES_POR_CHAMADA = 1000;
const NOTA_FORA = new Set(['CANCELED', 'CANCELLED', 'DENIED', 'REJECTED']); // notas que não vão no caminhão

async function recursoLigado(req) {
    if (process.env.CONFERENCIA_ZEN_DESLIGADO === '1') return false;
    return flagAtiva(pool, FLAG, { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo });
}

function lista(resposta) {
    const d = resposta?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    return [];
}

// "(campo==1,campo==2)" - OR em lote, mesmo formato que o Zen já aceita em outras telas.
function filtroOu(campo, ids) {
    const termos = ids.map((id) => `${campo}==${id}`);
    return termos.length === 1 ? termos[0] : `(${termos.join(',')})`;
}

function pedacos(itens, tamanho) {
    const saida = [];
    for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
    return saida;
}

const primeiro = (...valores) => valores.find((v) => v !== undefined && v !== null && v !== '') ?? null;

// GET /conferencia-erp/zen/status
router.get('/status', async (req, res) => {
    try {
        res.json({ ativo: await recursoLigado(req) });
    } catch (erro) {
        console.error('[conferencia-zen] status:', erro.message);
        res.json({ ativo: false });
    }
});

// GET /conferencia-erp/zen/progresso?romaneios=1,2,3 - SÓ banco local (zero chamada ao Zen).
// Usado pelo coletor pra atualizar "x de y volumes" e a etapa das ordens ao voltar da conferência.
router.get('/progresso', async (req, res) => {
    try {
        if (!(await recursoLigado(req))) return res.json({ ativo: false, romaneios: {} });
        const ids = [...new Set(String(req.query.romaneios || '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,12}$/.test(s)))].slice(0, 300);
        if (ids.length === 0) return res.json({ ativo: true, romaneios: {} });
        const { rows } = await pool.query(
            `SELECT p.id, p.numero_erp, p.outgoing_list_id, p.etapa_separacao, p.cliente_nome, p.transportadora_nome,
                    COALESCE(array_agg(v.volume_id_zenerp::text) FILTER (WHERE v.volume_id_zenerp IS NOT NULL), '{}') AS conferidos
               FROM pedidos p
               LEFT JOIN volumes_conferidos v ON v.pedido_id = p.id
              WHERE p.outgoing_list_id = ANY($1::bigint[])
              GROUP BY p.id, p.numero_erp, p.outgoing_list_id, p.etapa_separacao, p.cliente_nome, p.transportadora_nome`,
            [ids]
        );
        const romaneios = {};
        for (const r of rows) {
            romaneios[String(r.outgoing_list_id)] = {
                pedido: {
                    id: r.id,
                    numero_erp: r.numero_erp,
                    outgoing_list_id: r.outgoing_list_id,
                    etapa_separacao: r.etapa_separacao,
                    cliente_nome: r.cliente_nome,
                    transportadora_nome: r.transportadora_nome,
                },
                conferidos: r.conferidos,
            };
        }
        res.json({ ativo: true, romaneios });
    } catch (erro) {
        console.error('[conferencia-zen] progresso:', erro.message);
        res.status(500).json({ erro: 'Falha ao consultar o progresso' });
    }
});

// POST /conferencia-erp/zen/buscar
router.post('/buscar', exigirCargo('conferente', 'picking'), async (req, res) => {
    try {
        if (!(await recursoLigado(req))) {
            return res.status(403).json({ erro: 'Esta função está desativada no momento.', flagDesativada: true, flag: FLAG });
        }

        let chamadas = 0;
        const avisos = [];
        const zen = async (caminho, params) => {
            chamadas += 1;
            return zenErpGet(caminho, params);
        };

        // 1) envios PREPARANDO ------------------------------------------------------------------
        const respEnvios = await zen('/shipping/shipment', { q: 'status=="PREPARING"', max: MAX_ENVIOS, order: '-id' });
        const brutosEnvios = lista(respEnvios);
        // defesa: se o Zen ignorar o filtro, só entra envio que realmente está PREPARING
        const enviosZen = brutosEnvios.filter((s) => s?.id != null && (s.status === undefined || String(s.status).toUpperCase() === 'PREPARING'));
        if (brutosEnvios.length >= MAX_ENVIOS) avisos.push(`Mostrando só os ${MAX_ENVIOS} envios Preparando mais recentes.`);
        const amostra = {
            envio: brutosEnvios[0] ? Object.keys(brutosEnvios[0]) : [],
            nota: [],
            volume: [],
        };

        if (enviosZen.length === 0) {
            return res.json({ ativo: true, buscadoEm: new Date().toISOString(), envios: [], resumo: { envios: 0, notas: 0, volumes: 0, chamadasZen: chamadas }, avisos, amostra });
        }
        const idsEnvio = enviosZen.map((s) => String(s.id));
        const idsEnvioSet = new Set(idsEnvio);

        // 2) notas de TODOS os envios, em lote ---------------------------------------------------
        const notas = [];
        for (const grupo of pedacos(idsEnvio, LOTE_ENVIOS)) {
            const r = await zen('/fiscal/outgoingInvoice', { q: filtroOu('shipment.id', grupo), max: NOTAS_POR_CHAMADA });
            const itens = lista(r);
            if (itens.length >= NOTAS_POR_CHAMADA) avisos.push('Algum lote de envios devolveu o máximo de notas: pode haver nota faltando.');
            if (!amostra.nota.length && itens[0]) amostra.nota = Object.keys(itens[0]);
            for (const n of itens) {
                const envioId = n?.shipment?.id != null ? String(n.shipment.id) : null;
                if (!envioId || !idsEnvioSet.has(envioId)) continue; // defesa: nota fora dos envios pedidos
                notas.push({
                    id: n.id ?? null,
                    envioId,
                    numero: primeiro(n.number, n.invoiceNumber, n.documentNumber, n.numero),
                    status: n.status ? String(n.status).toUpperCase() : null,
                    romaneioId: n?.outgoingList?.id != null ? String(n.outgoingList.id) : null,
                    cliente: primeiro(n.customer?.name, n.person?.name, n.recipient?.name, n.customerName, n.personName),
                });
            }
        }
        const notasValidas = notas.filter((n) => !NOTA_FORA.has(n.status));
        const canceladas = notas.length - notasValidas.length;
        if (canceladas > 0) avisos.push(`${canceladas} nota(s) cancelada(s)/negada(s) foram ignoradas.`);

        // 3) volumes de TODOS os romaneios, em lote ----------------------------------------------
        const romaneios = [...new Set(notasValidas.map((n) => n.romaneioId).filter(Boolean))];
        const volumesPorRomaneio = new Map(); // romaneioId -> [{id, code}]
        const adicionar = (romaneioId, v) => {
            const k = String(romaneioId);
            if (!volumesPorRomaneio.has(k)) volumesPorRomaneio.set(k, new Map());
            volumesPorRomaneio.get(k).set(String(v.id), { id: v.id, code: v.code ?? null });
        };
        const sem = [];
        for (const grupo of pedacos(romaneios, LOTE_ROMANEIOS)) {
            const r = await zen('/material/volume', { q: filtroOu('outgoingList.id', grupo), max: VOLUMES_POR_CHAMADA });
            const itens = lista(r);
            if (itens.length >= VOLUMES_POR_CHAMADA) avisos.push('Algum lote de romaneios devolveu o máximo de volumes: pode haver volume faltando.');
            if (!amostra.volume.length && itens[0]) amostra.volume = Object.keys(itens[0]);
            let comRomaneio = 0;
            for (const v of itens) {
                const rid = primeiro(v?.outgoingList?.id, v?.outgoingListId);
                if (rid === null || v?.id == null) continue;
                comRomaneio += 1;
                adicionar(rid, v);
            }
            // o Zen não devolveu o romaneio dentro do volume: sem como agrupar o lote -> volta pro modo por romaneio
            if (itens.length > 0 && comRomaneio === 0) sem.push(...grupo);
        }
        if (sem.length > 0) {
            avisos.push('O Zen não informou o romaneio dentro do volume; consultei por romaneio (mais chamadas).');
            for (const rid of sem.slice(0, 40)) {
                const r = await zen('/material/volume', { q: `outgoingList.id==${rid}`, max: VOLUMES_POR_CHAMADA });
                for (const v of lista(r)) if (v?.id != null) adicionar(rid, v);
            }
            if (sem.length > 40) avisos.push('Mais de 40 romaneios sem agrupamento: os demais ficaram sem volumes.');
        }

        // Local: ordem de cada romaneio e volumes já conferidos (nenhuma chamada ao Zen) -------------
        const pedidosPorRomaneio = new Map();
        if (romaneios.length > 0) {
            const { rows } = await pool.query(
                `SELECT p.id, p.numero_erp, p.outgoing_list_id, p.etapa_separacao, p.cliente_nome, p.transportadora_nome,
                        COALESCE(array_agg(v.volume_id_zenerp::text) FILTER (WHERE v.volume_id_zenerp IS NOT NULL), '{}') AS conferidos
                   FROM pedidos p
                   LEFT JOIN volumes_conferidos v ON v.pedido_id = p.id
                  WHERE p.outgoing_list_id = ANY($1::bigint[])
                  GROUP BY p.id, p.numero_erp, p.outgoing_list_id, p.etapa_separacao, p.cliente_nome, p.transportadora_nome`,
                [romaneios]
            );
            for (const p of rows) pedidosPorRomaneio.set(String(p.outgoing_list_id), p);
        }

        // Monta a resposta: envio > notas > volumes ------------------------------------------------
        let totalNotas = 0;
        let totalVolumes = 0;
        const envios = enviosZen.map((s) => {
            const doEnvio = notasValidas.filter((n) => n.envioId === String(s.id));
            const notasOut = doEnvio.map((n) => {
                const pedido = n.romaneioId ? pedidosPorRomaneio.get(n.romaneioId) : null;
                const conferidosSet = new Set(pedido ? pedido.conferidos : []);
                const vols = n.romaneioId && volumesPorRomaneio.has(n.romaneioId) ? [...volumesPorRomaneio.get(n.romaneioId).values()] : [];
                totalNotas += 1;
                totalVolumes += vols.length;
                const volumes = vols.map((v) => ({ id: v.id, code: v.code, conferido: conferidosSet.has(String(v.id)) }));
                return {
                    id: n.id,
                    numero: n.numero,
                    status: n.status,
                    romaneioId: n.romaneioId,
                    cliente: n.cliente || pedido?.cliente_nome || null,
                    volumes,
                    totalVolumes: volumes.length,
                    totalConferidos: volumes.filter((v) => v.conferido).length,
                    pedido: pedido
                        ? {
                              id: pedido.id,
                              numero_erp: pedido.numero_erp,
                              outgoing_list_id: pedido.outgoing_list_id,
                              etapa_separacao: pedido.etapa_separacao,
                              cliente_nome: pedido.cliente_nome,
                              transportadora_nome: pedido.transportadora_nome,
                          }
                        : null,
                };
            });
            return {
                id: String(s.id),
                status: s.status ?? 'PREPARING',
                transportadora: primeiro(s.carrier?.person?.name, s.carrier?.name, s.person?.name, s.person?.tradeName, s.carrierName),
                notas: notasOut,
            };
        });

        res.json({
            ativo: true,
            buscadoEm: new Date().toISOString(),
            envios,
            resumo: { envios: envios.length, notas: totalNotas, volumes: totalVolumes, chamadasZen: chamadas },
            avisos,
            amostra,
        });
    } catch (erro) {
        console.error('[conferencia-zen] buscar:', erro?.response?.data || erro.message);
        res.status(502).json({
            erro: 'Falha ao buscar os envios no ZenERP. A lista de ordens continua funcionando normalmente.',
            detalhe: erro?.response?.data || erro.message,
        });
    }
});

// POST /conferencia-erp/zen/trazer-ordem   Body: { romaneioId }
// 2ª etapa: nota de um envio Preparando que NAO tem ordem no WMS (ex.: feita direto no Zen pelo almoxarifado).
// Ao tocar na nota, cria a ordem de origem externa (etapa nota_liberada) a partir do romaneio - a mesma rotina
// que a busca de envio ja usa (trazerOrdensExternas) - e o coletor abre a conferencia por volume de sempre
// (bipagem, foto, liberar embarque, assinatura e avanco do envio funcionam igual). O volume continua vindo do
// Zen pelo romaneio da nota. O envio vem do PROPRIO Zen (nota), nunca do que o aparelho mandou.
// Zero chamada ao Zen se a ordem ja existe e esta pronta pra conferir; senao 1 (nota) + as da rotina existente.
router.post('/trazer-ordem', exigirCargo('conferente', 'picking'), async (req, res) => {
    try {
        if (!(await recursoLigado(req))) {
            return res.status(403).json({ erro: 'Esta função está desativada no momento.', flagDesativada: true, flag: FLAG });
        }
        const romaneio = String(req.body?.romaneioId ?? '').trim();
        if (!/^\d{1,12}$/.test(romaneio)) return res.status(400).json({ erro: 'Romaneio inválido' });

        const lerPedido = async () =>
            (
                await pool.query(
                    `SELECT id, numero_erp, outgoing_list_id, etapa_separacao, cliente_nome, transportadora_nome, shipment_id
                       FROM pedidos WHERE outgoing_list_id = $1::bigint ORDER BY criado_em DESC LIMIT 1`,
                    [romaneio]
                )
            ).rows[0] || null;

        let pedido = await lerPedido();
        if (pedido && pedido.etapa_separacao === 'nota_liberada') {
            return res.json({ ok: true, criada: false, pedido });
        }
        if (pedido && !['pendente', 'processado_externamente'].includes(pedido.etapa_separacao)) {
            return res.status(409).json({
                erro: `A ordem ${pedido.numero_erp} está na etapa "${String(pedido.etapa_separacao).replace(/_/g, ' ')}" e não pode ser conferida agora.`,
            });
        }
        if (process.env.ENVIO_ORDEM_EXTERNA_DESLIGADO === '1') {
            return res.status(409).json({ erro: 'Trazer ordem do Zen está desligado (ENVIO_ORDEM_EXTERNA_DESLIGADO).' });
        }

        // o envio vem da nota no Zen (fonte da verdade)
        const r = await zenErpGet('/fiscal/outgoingInvoice', { q: `outgoingList.id==${romaneio}`, max: 20 });
        const nota = lista(r).find((n) => n?.shipment?.id != null && !NOTA_FORA.has(String(n.status || '').toUpperCase()));
        if (!nota) return res.status(409).json({ erro: 'Essa nota não está em nenhum envio no Zen (ou foi cancelada).' });
        const envioId = String(nota.shipment.id);

        const busca = {};
        await trazerOrdensExternas(envioId, [romaneio], busca, {});
        pedido = await lerPedido();
        if (!pedido) {
            const motivo = busca.detalhes?.[0]?.motivo;
            return res.status(409).json({ erro: `Não consegui identificar a ordem de separação desse romaneio no Zen${motivo ? ` (${motivo})` : ''}.` });
        }
        if (pedido.etapa_separacao !== 'nota_liberada') {
            return res.status(409).json({
                erro: `A ordem ${pedido.numero_erp} ficou na etapa "${String(pedido.etapa_separacao).replace(/_/g, ' ')}" e não pode ser conferida agora.`,
            });
        }
        res.json({ ok: true, criada: (busca.externas || []).length > 0, pedido });
    } catch (erro) {
        console.error('[conferencia-zen] trazer-ordem:', erro?.response?.data || erro.message);
        res.status(502).json({ erro: 'Falha ao trazer a ordem dessa nota. Tente de novo.', detalhe: erro?.response?.data || erro.message });
    }
});

module.exports = router;
