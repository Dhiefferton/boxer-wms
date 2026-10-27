// Assinatura do motorista na saida do envio (minuta - "Impresso de envio" do Zen).
//
// Montada DENTRO de conferencia-erp.js (router.use('/envios', ...)), entao herda
// exigirLogin, o gate de permissao 'col.conferencia' e o bloqueio de escrita
// somente-leitura. Nao altera nada do fluxo de conferencia por pedido/volume:
// so LE o que a conferencia ja gravou (pedidos 'embarque_liberado',
// pedidos.shipment_id, volumes_conferidos) e grava nas 3 tabelas proprias:
//   envio_assinaturas         - 1 linha por assinatura (motorista, placa, coleta, assinatura)
//   envio_assinatura_pedidos  - quais pedidos aquela assinatura cobre (pedido_id UNICO:
//                               um pedido nunca e assinado duas vezes)
//   envio_assinatura_anexos   - foto da carga e fotos da minuta impressa
//
// Envio PARCIAL: o motorista pode assinar so as ordens ja liberadas; as que
// faltarem ficam pendentes e entram numa proxima assinatura do mesmo envio.
//
// SEGURANCA / REVERSIBILIDADE
//   - flag 'envio_assinatura' (Controle de acesso > Funcoes), padrao DESLIGADA.
//   - emergencia: ENVIO_ASSINATURA_DESLIGADO=1 na Vercel desliga tudo.
//   - nenhuma escrita no ZenERP; consulta ao Zen e best effort (se falhar, o
//     card continua funcionando so com o que ja temos localmente).
//   - se as tabelas nao existirem, /pendentes responde "desativado" (200) em vez de erro.
const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');
const { exigirCargo } = require('../auth');
const { flagAtiva } = require('../lib/feature-flags');

const router = express.Router();

// So considera pedidos liberados recentemente (evita arrastar pra sempre pedidos
// antigos que nunca foram assinados, de antes da funcao existir). Padrao: 2 dias.
// Ajustes sem mexer em codigo (variaveis na Vercel):
//   ENVIO_ASSINATURA_JANELA_DIAS=N  - muda a janela (1 a 30 dias)
//   ENVIO_ASSINATURA_DESDE=2026-10-24T08:00:00-03:00 - so conta liberacoes a partir
//     dessa data/hora (marco de inicio da funcao; vale mais que a janela)
function limiteLiberacao() {
    const desde = process.env.ENVIO_ASSINATURA_DESDE ? new Date(process.env.ENVIO_ASSINATURA_DESDE) : null;
    if (desde && !Number.isNaN(desde.getTime())) return desde.toISOString();
    const dias = Math.min(30, Math.max(1, Number(process.env.ENVIO_ASSINATURA_JANELA_DIAS) || 2));
    return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}
const MAX_IMAGEM_CHARS = 3_500_000; // ~2,6 MB binarios; o coletor ja comprime antes
const MAX_ANEXOS = { carga: 3, minuta_impressa: 6 };
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_IMAGEM = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

async function recursoLigado(req) {
    if (process.env.ENVIO_ASSINATURA_DESLIGADO === '1') return false;
    return flagAtiva(pool, 'envio_assinatura', { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo });
}

async function exigirRecurso(req, res, next) {
    try {
        if (await recursoLigado(req)) return next();
        return res.status(403).json({ erro: 'Esta função está desativada no momento.', flagDesativada: true, flag: 'envio_assinatura' });
    } catch (erro) {
        console.error('[envio-assinatura] falha ao checar flag:', erro.message);
        return res.status(403).json({ erro: 'Esta função está desativada no momento.', flagDesativada: true, flag: 'envio_assinatura' });
    }
}

// ---- Notas do envio no Zen (best effort, cache curto) ----------------------
const cacheNotas = new Map(); // shipmentId -> { em, notas }
const CACHE_MS = 45 * 1000;

async function notasDoEnvioNoZen(shipmentId) {
    const chave = String(shipmentId);
    const hit = cacheNotas.get(chave);
    if (hit && Date.now() - hit.em < CACHE_MS) return hit.notas;
    try {
        const resposta = await zenErpGet('/fiscal/outgoingInvoice', { q: `shipment.id==${shipmentId}`, max: 200 });
        const lista = resposta.data?.data || resposta.data || [];
        if (!Array.isArray(lista) || lista.length === 0) return null;
        const notas = lista.map((n) => ({
            romaneioId: n?.outgoingList?.id ?? null,
            numeroNf: n?.number ?? n?.invoiceNumber ?? n?.documentNumber ?? n?.numero ?? null,
        }));
        cacheNotas.set(chave, { em: Date.now(), notas });
        return notas;
    } catch (erro) {
        console.warn(`[envio-assinatura] Zen indisponivel ao listar notas do envio ${shipmentId} (segue so com dados locais):`, erro?.response?.data || erro.message);
        return null;
    }
}

// ---- Montagem dos envios com ordens liberadas e ainda nao assinadas --------
async function candidatosLiberados(db, shipmentIds) {
    const { rows } = await db.query(
        `SELECT p.id AS pedido_id, p.numero_erp, p.outgoing_list_id, p.shipment_id, p.cliente_nome, p.transportadora_nome,
                COALESCE(p.volume_quantidade, (SELECT COUNT(*) FROM volumes_conferidos v WHERE v.pedido_id = p.id))::int AS volumes,
                (SELECT MAX(l.liberado_em) FROM liberacoes_embarque l WHERE l.pedido_id = p.id) AS liberado_em
           FROM pedidos p
          WHERE p.etapa_separacao = 'embarque_liberado'
            AND p.shipment_id IS NOT NULL
            AND ($2::bigint[] IS NULL OR p.shipment_id = ANY($2::bigint[]))
            AND (SELECT MAX(l.liberado_em) FROM liberacoes_embarque l WHERE l.pedido_id = p.id) > $1::timestamptz
            AND NOT EXISTS (SELECT 1 FROM envio_assinatura_pedidos a WHERE a.pedido_id = p.id)
          ORDER BY p.shipment_id, liberado_em`,
        [limiteLiberacao(), shipmentIds ? shipmentIds.map(String) : null]
    );
    return rows;
}

async function montarEnvios(shipmentIds) {
    const candidatos = await candidatosLiberados(pool, shipmentIds);
    const porEnvio = new Map();
    for (const c of candidatos) {
        const k = String(c.shipment_id);
        if (!porEnvio.has(k)) porEnvio.set(k, []);
        porEnvio.get(k).push(c);
    }
    const ids = [...porEnvio.keys()].slice(0, 20);
    if (ids.length === 0) return [];

    const { rows: assinados } = await pool.query(
        `SELECT p.shipment_id, p.outgoing_list_id
           FROM pedidos p JOIN envio_assinatura_pedidos a ON a.pedido_id = p.id
          WHERE p.shipment_id = ANY($1::bigint[])`,
        [ids]
    );
    const assinadosPorEnvio = new Map();
    for (const a of assinados) {
        const k = String(a.shipment_id);
        if (!assinadosPorEnvio.has(k)) assinadosPorEnvio.set(k, new Set());
        assinadosPorEnvio.get(k).add(String(a.outgoing_list_id));
    }

    return Promise.all(
        ids.map(async (id) => {
            const liberadas = porEnvio.get(id);
            const jaAssinadas = assinadosPorEnvio.get(id) || new Set();
            const romaneiosConhecidos = new Set([...liberadas.map((l) => String(l.outgoing_list_id)), ...jaAssinadas]);

            const notasZen = await notasDoEnvioNoZen(id);
            let pendentes = [];
            let volumesPendentes = 0;
            let volumesPendentesCompletos = true;
            if (notasZen) {
                const faltando = notasZen.filter((n) => n.romaneioId === null || !romaneiosConhecidos.has(String(n.romaneioId)));
                const romaneiosFaltando = faltando.map((n) => n.romaneioId).filter((r) => r !== null).map(String);
                let locais = [];
                if (romaneiosFaltando.length > 0) {
                    const r = await pool.query(
                        `SELECT outgoing_list_id, numero_erp, cliente_nome, volume_quantidade, etapa_separacao FROM pedidos WHERE outgoing_list_id = ANY($1::bigint[])`,
                        [romaneiosFaltando]
                    );
                    locais = r.rows;
                }
                const localPorRomaneio = new Map(locais.map((l) => [String(l.outgoing_list_id), l]));
                pendentes = faltando.map((n) => {
                    const l = n.romaneioId !== null ? localPorRomaneio.get(String(n.romaneioId)) : null;
                    if (l?.volume_quantidade != null) volumesPendentes += Number(l.volume_quantidade);
                    else volumesPendentesCompletos = false;
                    return {
                        romaneioId: n.romaneioId,
                        numeroNf: n.numeroNf,
                        numeroErp: l?.numero_erp ?? null,
                        cliente: l?.cliente_nome ?? null,
                    };
                });
            }

            const volumesLiberados = liberadas.reduce((s, l) => s + (l.volumes || 0), 0);
            const transportadora = liberadas.map((l) => l.transportadora_nome).find(Boolean) ?? null;
            return {
                shipmentId: Number(id),
                transportadora,
                zenIndisponivel: !notasZen,
                jaAssinadas: jaAssinadas.size,
                liberadas: liberadas.length,
                totalOrdens: liberadas.length + pendentes.length,
                volumesLiberados,
                volumesTotal: notasZen && volumesPendentesCompletos ? volumesLiberados + volumesPendentes : null,
                completo: !!notasZen && pendentes.length === 0,
                notas: liberadas.map((l) => ({
                    pedidoId: l.pedido_id,
                    numeroErp: l.numero_erp,
                    cliente: l.cliente_nome,
                    volumes: l.volumes,
                })),
                pendentes,
            };
        })
    );
}

// GET /conferencia-erp/envios/pendentes
// Alimenta o card no topo da lista de conferencia. Nunca devolve erro "duro":
// qualquer problema vira { ativo: false } e o card simplesmente nao aparece.
router.get('/pendentes', async (req, res) => {
    try {
        if (!(await recursoLigado(req))) return res.json({ ativo: false, envios: [] });
        const envios = await montarEnvios(null);
        res.json({ ativo: true, envios });
    } catch (erro) {
        console.error('[envio-assinatura] pendentes:', erro.message);
        res.json({ ativo: false, envios: [] });
    }
});

// GET /conferencia-erp/envios/assinaturas/:id - assinatura gravada + anexos (reimpressao do PDF)
router.get('/assinaturas/:id', exigirRecurso, async (req, res) => {
    if (!RE_UUID.test(req.params.id)) return res.status(400).json({ erro: 'Assinatura inválida' });
    try {
        const { rows } = await pool.query(`SELECT * FROM envio_assinaturas WHERE id = $1`, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ erro: 'Assinatura não encontrada' });
        const { rows: anexos } = await pool.query(
            `SELECT id, tipo, imagem_base64, criado_em FROM envio_assinatura_anexos WHERE assinatura_id = $1 ORDER BY criado_em`,
            [req.params.id]
        );
        res.json({ assinatura: rows[0], anexos });
    } catch (erro) {
        console.error('[envio-assinatura] consulta:', erro);
        res.status(500).json({ erro: 'Falha ao consultar assinatura' });
    }
});

// POST /conferencia-erp/envios/assinaturas/:id/anexo
// Body: { tipo: 'carga' | 'minuta_impressa', imagemBase64 } - UMA imagem por
// chamada (limite de corpo da Vercel ~4,5 MB; o coletor comprime antes).
router.post('/assinaturas/:id/anexo', exigirRecurso, exigirCargo('conferente', 'picking'), async (req, res) => {
    const { tipo, imagemBase64 } = req.body || {};
    if (!RE_UUID.test(req.params.id)) return res.status(400).json({ erro: 'Assinatura inválida' });
    if (!MAX_ANEXOS[tipo]) return res.status(400).json({ erro: "tipo deve ser 'carga' ou 'minuta_impressa'" });
    if (typeof imagemBase64 !== 'string' || !RE_IMAGEM.test(imagemBase64) || imagemBase64.length > MAX_IMAGEM_CHARS) {
        return res.status(400).json({ erro: 'Imagem inválida ou grande demais' });
    }
    try {
        const { rows: ass } = await pool.query(`SELECT 1 FROM envio_assinaturas WHERE id = $1`, [req.params.id]);
        if (ass.length === 0) return res.status(404).json({ erro: 'Assinatura não encontrada' });
        const { rows: cont } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM envio_assinatura_anexos WHERE assinatura_id = $1 AND tipo = $2`,
            [req.params.id, tipo]
        );
        if (cont[0].n >= MAX_ANEXOS[tipo]) {
            return res.status(409).json({ erro: `Limite de ${MAX_ANEXOS[tipo]} imagem(ns) desse tipo atingido` });
        }
        const { rows } = await pool.query(
            `INSERT INTO envio_assinatura_anexos (assinatura_id, tipo, imagem_base64) VALUES ($1, $2, $3) RETURNING id`,
            [req.params.id, tipo, imagemBase64]
        );
        res.json({ status: 'anexo_salvo', id: rows[0].id });
    } catch (erro) {
        console.error('[envio-assinatura] anexo:', erro);
        res.status(500).json({ erro: 'Falha ao salvar anexo' });
    }
});

// ---- Fila de conferencia agrupada por MINUTA (envio) -----------------------
// Em vez de uma lista solta de ordens de separacao, a Conferencia mostra as
// minutas (envios do Zen) e, dentro de cada uma, as ordens dela. Pra saber a
// qual envio cada ordem pertence ANTES da liberacao do embarque, consulta a nota
// de saida do romaneio no Zen (a mesma consulta do liberar-embarque) e grava o
// resultado em pedidos.shipment_id - assim cada ordem so e consultada uma vez
// (o liberar-embarque continua regravando esse campo normalmente).
const cacheSemEnvio = new Map(); // pedidoId -> quando foi checada sem envio
const SEM_ENVIO_MS = 3 * 60 * 1000;
const MAX_CONSULTAS_ZEN = 30;

async function descobrirEnvioDosPedidos(pedidos) {
    const limite = Date.now() - SEM_ENVIO_MS;
    const alvo = pedidos.filter((p) => p.outgoing_list_id && !(cacheSemEnvio.get(p.id) > limite)).slice(0, MAX_CONSULTAS_ZEN);
    let i = 0;
    async function trabalhador() {
        while (i < alvo.length) {
            const p = alvo[i];
            i += 1;
            try {
                const r = await zenErpGet('/fiscal/outgoingInvoice', { q: `outgoingList.id==${p.outgoing_list_id}`, max: 5 });
                const notas = r.data?.data || r.data || [];
                const envioId = (Array.isArray(notas) ? notas : []).map((n) => n?.shipment?.id).find(Boolean) ?? null;
                if (envioId) {
                    p.shipment_id = envioId;
                    cacheSemEnvio.delete(p.id);
                    await pool.query(`UPDATE pedidos SET shipment_id = $2 WHERE id = $1 AND shipment_id IS NULL`, [p.id, envioId]);
                } else {
                    cacheSemEnvio.set(p.id, Date.now());
                }
            } catch (erro) {
                cacheSemEnvio.set(p.id, Date.now());
                console.warn(`[envio-assinatura] nao consegui achar o envio da ordem ${p.numero_erp} no Zen:`, erro?.response?.data || erro.message);
            }
        }
    }
    await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
}

function numeroOrdem(a, b) {
    return Number(a.numero_erp) - Number(b.numero_erp) || String(a.numero_erp).localeCompare(String(b.numero_erp));
}

// ---- Ordens feitas direto no Zen (almoxarifado) -----------------------------
// Uma nota do envio cujo romaneio NAO passou pela separacao do WMS (ordem feita
// pelo almoxarifado direto no Zen: no WMS ela esta 'pendente', 'processado_externamente'
// ou nem existe) entra na Conferencia como ordem de origem externa: etapa
// 'nota_liberada' + origem_externa = true (nao gera movimentacao de estoque aqui, pois
// o WMS nao separou nada). So acontece na busca explicita do envio e so para romaneios
// que JA TEM nota no envio. Ordens que estao no meio do fluxo do WMS nunca sao tocadas.
// Desligar: ENVIO_ORDEM_EXTERNA_DESLIGADO=1 na Vercel.
// Reverter uma ordem: UPDATE pedidos SET etapa_separacao = 'processado_externamente',
//   shipment_id = NULL, origem_externa = false WHERE numero_erp = '...' AND etapa_separacao = 'nota_liberada';
const ETAPAS_EXTERNAS = ['pendente', 'processado_externamente'];

async function trazerOrdensExternas(envioId, romaneios, busca) {
    busca.externas = [];
    busca.naoIdentificadas = 0;
    if (process.env.ENVIO_ORDEM_EXTERNA_DESLIGADO === '1' || romaneios.length === 0) return;
    for (const romaneio of romaneios) {
        try {
            const { rows: locais } = await pool.query(`SELECT id, numero_erp, etapa_separacao FROM pedidos WHERE outgoing_list_id = $1`, [romaneio]);
            if (locais.length > 0) {
                for (const l of locais.filter((x) => ETAPAS_EXTERNAS.includes(x.etapa_separacao))) {
                    const r = await pool.query(
                        `UPDATE pedidos SET etapa_separacao = 'nota_liberada', shipment_id = $2, origem_externa = true
                          WHERE id = $1 AND etapa_separacao = ANY($3::text[]) RETURNING id`,
                        [l.id, envioId, ETAPAS_EXTERNAS]
                    );
                    if (r.rowCount > 0) {
                        busca.externas.push({ numeroErp: l.numero_erp, romaneioId: Number(romaneio), de: l.etapa_separacao });
                        console.log(`[envio-assinatura] ordem ${l.numero_erp} (romaneio ${romaneio}) trazida do Zen como ordem de almoxarifado no envio ${envioId}; etapa anterior: ${l.etapa_separacao}`);
                    }
                }
                continue;
            }
            // nao existe no WMS: descobre a ordem de separacao (pickingOrder) pelo romaneio
            const resp = await zenErpGet('/material/pickingOrder', { q: `outgoingList.id==${romaneio}`, max: 5 });
            const lista = Array.isArray(resp.data) ? resp.data : resp.data?.data || [];
            const po = lista[0];
            if (!po?.id) {
                busca.naoIdentificadas += 1;
                continue;
            }
            const numeroErp = String(po.id);
            const ins = await pool.query(
                `INSERT INTO pedidos (numero_erp, criado_em, reservation_id, outgoing_list_id, perfil_separacao_codigo, etapa_separacao, shipment_id, origem_externa)
                 VALUES ($1, $2, $3, $4, $5, 'nota_liberada', $6, true)
                 ON CONFLICT (numero_erp) DO NOTHING RETURNING id`,
                [numeroErp, po.date ?? new Date().toISOString(), po.reservation?.id ?? null, romaneio, po.pickingProfile?.code ?? null, envioId]
            );
            if (ins.rowCount > 0) {
                busca.externas.push({ numeroErp, romaneioId: Number(romaneio), de: 'novo' });
                console.log(`[envio-assinatura] ordem ${numeroErp} (romaneio ${romaneio}) criada no WMS como ordem de almoxarifado no envio ${envioId}`);
            } else {
                // ja existia com esse numero mas sem romaneio ligado: completa o vinculo so se ainda nao foi mexida
                const up = await pool.query(
                    `UPDATE pedidos SET etapa_separacao = 'nota_liberada', outgoing_list_id = $2, shipment_id = $3, origem_externa = true
                      WHERE numero_erp = $1 AND outgoing_list_id IS NULL AND etapa_separacao = ANY($4::text[]) RETURNING id`,
                    [numeroErp, romaneio, envioId, ETAPAS_EXTERNAS]
                );
                if (up.rowCount > 0) busca.externas.push({ numeroErp, romaneioId: Number(romaneio), de: 'sem_romaneio' });
                else busca.naoIdentificadas += 1;
            }
        } catch (erro) {
            busca.naoIdentificadas += 1;
            console.warn(`[envio-assinatura] nao consegui trazer o romaneio ${romaneio} do envio ${envioId}:`, erro?.response?.data || erro.message);
        }
    }
}

// Busca explicita por numero de envio (digitado na busca do coletor): consulta o
// Zen sem cache, liga ao envio as ordens locais cujo romaneio esta nas notas dele
// (so preenche shipment_id vazio - aditivo e reversivel) e devolve um resumo
// para o coletor explicar o que achou. Nunca escreve no Zen.
async function vincularEnvio(envioId) {
    const busca = { envio: Number(envioId), notasNoZen: 0, ordensVinculadas: 0, semOrdemLocal: 0, erro: null };
    try {
        cacheNotas.delete(String(envioId));
        const resposta = await zenErpGet('/fiscal/outgoingInvoice', { q: `shipment.id==${envioId}`, max: 200 });
        const lista = resposta.data?.data || resposta.data || [];
        const notas = Array.isArray(lista) ? lista : [];
        busca.notasNoZen = notas.length;
        const romaneios = [...new Set(notas.map((n) => n?.outgoingList?.id).filter(Boolean).map(String))];
        if (romaneios.length > 0) {
            const { rows } = await pool.query(
                `UPDATE pedidos SET shipment_id = $1
                  WHERE outgoing_list_id = ANY($2::bigint[]) AND shipment_id IS NULL
                    AND etapa_separacao IN ('nota_liberada', 'embarque_liberado')
              RETURNING id`,
                [envioId, romaneios]
            );
            busca.ordensVinculadas = rows.length;
            const { rows: locais } = await pool.query(`SELECT DISTINCT outgoing_list_id FROM pedidos WHERE outgoing_list_id = ANY($1::bigint[])`, [romaneios]);
            busca.semOrdemLocal = romaneios.length - locais.length;
            await trazerOrdensExternas(envioId, romaneios, busca);
        }
    } catch (erro) {
        busca.erro = erro?.response?.data?.message || erro.message || 'falha ao consultar o Zen';
        console.warn(`[envio-assinatura] busca do envio ${envioId} no Zen falhou:`, erro?.response?.data || erro.message);
    }
    return busca;
}

// GET /conferencia-erp/envios/fila[?envio=NNNN]
// { ativo, minutas: [...], semMinuta: [...] } - qualquer problema vira { ativo:false }
// e o coletor volta pra lista simples de ordens (comportamento de sempre).
router.get('/fila', async (req, res) => {
    try {
        if (!(await recursoLigado(req))) return res.json({ ativo: false });

        const envioBuscado = /^\d{1,9}$/.test(String(req.query.envio || '')) ? String(Number(req.query.envio)) : null;
        const busca = envioBuscado ? await vincularEnvio(envioBuscado) : null;

        const { rows: fila } = await pool.query(
            `SELECT id, numero_erp, outgoing_list_id, shipment_id, etapa_separacao, criado_em, transportadora_nome, cliente_nome,
                    volume_quantidade AS volumes, COALESCE((to_jsonb(pedidos) ->> 'origem_externa')::boolean, false) AS origem_externa
               FROM pedidos WHERE etapa_separacao = 'nota_liberada' ORDER BY criado_em DESC`
        );
        await descobrirEnvioDosPedidos(fila.filter((p) => !p.shipment_id));
        const liberadas = await candidatosLiberados(pool, null);

        const ids = [...new Set([...fila.filter((p) => p.shipment_id).map((p) => String(p.shipment_id)), ...liberadas.map((l) => String(l.shipment_id))])]
            .sort((a, b) => Number(b) - Number(a))
            .slice(0, 40);
        // envio buscado pelo numero entra sempre (mesmo sem ordem local: aparece com as notas pendentes)
        if (envioBuscado && busca && busca.notasNoZen > 0 && !ids.includes(envioBuscado)) ids.unshift(envioBuscado);

        const assinadosPorEnvio = new Map();
        if (ids.length > 0) {
            const { rows: assinados } = await pool.query(
                `SELECT p.shipment_id, p.outgoing_list_id
                   FROM pedidos p JOIN envio_assinatura_pedidos a ON a.pedido_id = p.id
                  WHERE p.shipment_id = ANY($1::bigint[])`,
                [ids]
            );
            for (const a of assinados) {
                const k = String(a.shipment_id);
                if (!assinadosPorEnvio.has(k)) assinadosPorEnvio.set(k, new Set());
                assinadosPorEnvio.get(k).add(String(a.outgoing_list_id));
            }
        }

        const minutas = await Promise.all(
            ids.map(async (id) => {
                const aConferir = fila.filter((p) => String(p.shipment_id) === id);
                const lib = liberadas.filter((l) => String(l.shipment_id) === id);
                const jaAssinadas = assinadosPorEnvio.get(id) || new Set();
                const conhecidos = new Set([...aConferir, ...lib].map((o) => String(o.outgoing_list_id)).concat([...jaAssinadas]));

                const notasZen = await notasDoEnvioNoZen(id);
                let pendentes = [];
                let volumesPendentes = 0;
                let volumesPendentesCompletos = true;
                if (notasZen) {
                    const faltando = notasZen.filter((n) => n.romaneioId === null || !conhecidos.has(String(n.romaneioId)));
                    const romaneios = faltando.map((n) => n.romaneioId).filter((r) => r !== null).map(String);
                    let locais = [];
                    if (romaneios.length > 0) {
                        const r = await pool.query(
                            `SELECT outgoing_list_id, numero_erp, cliente_nome, volume_quantidade, etapa_separacao FROM pedidos WHERE outgoing_list_id = ANY($1::bigint[])`,
                            [romaneios]
                        );
                        locais = r.rows;
                    }
                    const porRomaneio = new Map(locais.map((l) => [String(l.outgoing_list_id), l]));
                    pendentes = faltando.map((n) => {
                        const l = n.romaneioId !== null ? porRomaneio.get(String(n.romaneioId)) : null;
                        if (l?.volume_quantidade != null) volumesPendentes += Number(l.volume_quantidade);
                        else volumesPendentesCompletos = false;
                        return { romaneioId: n.romaneioId, numeroNf: n.numeroNf, numeroErp: l?.numero_erp ?? null, cliente: l?.cliente_nome ?? null, etapa: l?.etapa_separacao ?? null };
                    });
                }

                const volumesLiberados = lib.reduce((s, l) => s + (l.volumes || 0), 0);
                const volumesConferir = aConferir.reduce((s, o) => s + (o.volumes ?? 0), 0);
                const volumesConferirCompletos = aConferir.every((o) => o.volumes != null);
                const ordens = [
                    ...aConferir.map((o) => ({
                        id: o.id,
                        numero_erp: o.numero_erp,
                        outgoing_list_id: o.outgoing_list_id,
                        etapa_separacao: o.etapa_separacao,
                        criado_em: o.criado_em,
                        transportadora_nome: o.transportadora_nome,
                        cliente_nome: o.cliente_nome,
                        volumes: o.volumes,
                        origem_externa: o.origem_externa === true,
                        status: 'conferir',
                    })),
                    ...lib.map((l) => ({
                        id: l.pedido_id,
                        numero_erp: l.numero_erp,
                        cliente_nome: l.cliente_nome,
                        volumes: l.volumes,
                        status: 'liberada',
                    })),
                ].sort((a, b) => (a.status === b.status ? numeroOrdem(a, b) : a.status === 'conferir' ? -1 : 1));

                return {
                    shipmentId: Number(id),
                    transportadora: [...aConferir, ...lib].map((o) => o.transportadora_nome).find(Boolean) ?? null,
                    zenIndisponivel: !notasZen,
                    jaAssinadas: jaAssinadas.size,
                    aConferir: aConferir.length,
                    liberadas: lib.length,
                    totalOrdens: aConferir.length + lib.length + pendentes.length,
                    volumesLiberados,
                    volumesTotal: notasZen && volumesPendentesCompletos && volumesConferirCompletos ? volumesLiberados + volumesConferir + volumesPendentes : null,
                    completo: !!notasZen && aConferir.length === 0 && pendentes.length === 0 && lib.length > 0,
                    ordens,
                    pendentes,
                };
            })
        );

        const semMinuta = fila
            .filter((p) => !p.shipment_id)
            .map((o) => ({
                id: o.id,
                numero_erp: o.numero_erp,
                outgoing_list_id: o.outgoing_list_id,
                etapa_separacao: o.etapa_separacao,
                criado_em: o.criado_em,
                transportadora_nome: o.transportadora_nome,
                cliente_nome: o.cliente_nome,
                status: 'conferir',
            }));

        res.json({ ativo: true, minutas, semMinuta, ...(busca ? { busca } : {}) });
    } catch (erro) {
        console.error('[envio-assinatura] fila por minuta:', erro);
        res.json({ ativo: false });
    }
});

// GET /conferencia-erp/envios/:shipmentId - dados da tela de assinatura
router.get('/:shipmentId(\\d+)', exigirRecurso, async (req, res) => {
    try {
        const [envio] = await montarEnvios([req.params.shipmentId]);
        if (!envio) return res.status(404).json({ erro: 'Nenhuma ordem liberada aguardando assinatura nesse envio' });
        res.json(envio);
    } catch (erro) {
        console.error('[envio-assinatura] detalhe:', erro);
        res.status(500).json({ erro: 'Falha ao consultar o envio' });
    }
});

// POST /conferencia-erp/envios/:shipmentId/assinar
// Body: { motoristaNome, placa, coleta?, assinaturaBase64 }
// A lista de ordens coberta e SEMPRE recalculada aqui no servidor (todas as
// liberadas e ainda nao assinadas do envio) - o cliente nao escolhe pedidos.
router.post('/:shipmentId(\\d+)/assinar', exigirRecurso, exigirCargo('conferente', 'picking'), async (req, res) => {
    const shipmentId = req.params.shipmentId;
    const motoristaNome = String(req.body?.motoristaNome || '').trim().replace(/\s+/g, ' ');
    const placa = String(req.body?.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const coleta = String(req.body?.coleta || '').trim().slice(0, 60) || null;
    const assinatura = req.body?.assinaturaBase64;

    if (motoristaNome.length < 3 || motoristaNome.length > 120) return res.status(400).json({ erro: 'Informe o nome do motorista' });
    if (placa.length < 6 || placa.length > 8) return res.status(400).json({ erro: 'Informe a placa do veículo' });
    if (typeof assinatura !== 'string' || !RE_IMAGEM.test(assinatura) || assinatura.length < 800 || assinatura.length > 1_500_000) {
        return res.status(400).json({ erro: 'Assinatura do motorista ausente ou inválida' });
    }

    try {
        const [envio] = await montarEnvios([shipmentId]);
        if (!envio) return res.status(409).json({ erro: 'Nenhuma ordem liberada aguardando assinatura nesse envio' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`envio_assinatura:${shipmentId}`]);
            // Rele dentro da transacao (com o lock) pra nao assinar 2x o mesmo pedido
            const liberadas = await candidatosLiberados(client, [shipmentId]);
            if (liberadas.length === 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ erro: 'Essas ordens já foram assinadas' });
            }
            const notas = liberadas.map((l) => ({ pedidoId: l.pedido_id, numeroErp: l.numero_erp, cliente: l.cliente_nome, volumes: l.volumes }));
            const totalVolumes = notas.reduce((s, n) => s + (n.volumes || 0), 0);
            const parcial = envio.pendentes.length > 0;
            const transportadora = liberadas.map((l) => l.transportadora_nome).find(Boolean) ?? null;

            const { rows } = await client.query(
                `INSERT INTO envio_assinaturas
                    (shipment_id, motorista_nome, placa, coleta, assinatura_base64, total_notas, total_volumes, parcial, transportadora_nome, notas, colaborador_nome)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                 RETURNING id, data_saida`,
                [shipmentId, motoristaNome, placa, coleta, assinatura, notas.length, totalVolumes, parcial, transportadora, JSON.stringify(notas), req.usuario?.nome ?? null]
            );
            const assinaturaId = rows[0].id;
            for (const n of notas) {
                await client.query(`INSERT INTO envio_assinatura_pedidos (assinatura_id, pedido_id) VALUES ($1, $2)`, [assinaturaId, n.pedidoId]);
            }
            await client.query('COMMIT');
            res.json({
                status: 'assinado',
                id: assinaturaId,
                shipmentId: Number(shipmentId),
                dataSaida: rows[0].data_saida,
                parcial,
                totalNotas: notas.length,
                totalVolumes,
                transportadora,
                colaborador: req.usuario?.nome ?? null,
                motoristaNome,
                placa,
                coleta,
                notas,
                pendentes: envio.pendentes,
            });
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            client.release();
        }
    } catch (erro) {
        console.error('[envio-assinatura] assinar:', erro);
        res.status(500).json({ erro: 'Falha ao registrar a assinatura' });
    }
});

module.exports = router;
