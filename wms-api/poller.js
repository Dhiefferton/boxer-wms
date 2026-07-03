// ============================================================
// Polling do ZenERP - roda dentro do mesmo processo da API,
// pra não precisar de um segundo serviço no Railway.
//
// O que faz, em português simples:
//   1. Faz login no ZenERP e guarda o token por ~23h.
//   2. De tempos em tempos, busca pedidos abertos e os itens
//      de cada um.
//   3. Grava pedido novo no banco - isso dispara sozinho o
//      motor de alocação (gatilho já existente no banco).
//
// Só inicia se as variáveis ZENERP_* estiverem configuradas -
// se não estiverem, a API funciona normalmente sem o polling.
// ============================================================
const axios = require('axios');
const pool = require('./db');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MINUTES || 3) * 60 * 1000;

let tokenCache = { valor: null, expiraEm: 0 };

async function obterToken() {
    if (tokenCache.valor && Date.now() < tokenCache.expiraEm) {
        return tokenCache.valor;
    }

    const resposta = await axios.post(
        `${process.env.ZENERP_AUTH_BASE_URL}/auth/login`,
        {
            username: process.env.ZENERP_USERNAME,
            password: process.env.ZENERP_PASSWORD,
            properties: {},
        },
        { headers: { tenant: process.env.ZENERP_TENANT, Accept: 'application/json' } }
    );

    tokenCache = {
        valor: resposta.data.accessToken,
        expiraEm: Date.now() + 23 * 60 * 60 * 1000,
    };

    console.log('[zenerp] Login renovado.');
    return tokenCache.valor;
}

async function zenErpGet(path, params) {
    const token = await obterToken();
    return axios.get(`${process.env.ZENERP_BASE_URL}${path}`, {
        params,
        timeout: 15000,
        headers: {
            Authorization: `Bearer ${token}`,
            tenant: process.env.ZENERP_TENANT,
            Accept: 'application/json',
        },
    });
}

async function buscarPickingOrders() {
    const resposta = await zenErpGet('/material/pickingOrder', { q: 'reservation.status==APPROVED' });
    return Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
}

async function buscarItensDoPedido(pickingOrderId) {
    const resposta = await zenErpGet('/material/pickingOrderItem', {
        pickingOrder: pickingOrderId,
        q: `pickingOrder.id==${pickingOrderId}`,
    });
    const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
    return lista
        .map((item) => ({
            sku: item.productPacking?.product?.code,
            quantidade: Number(item.quantity),
        }))
        .filter((item) => item.sku && item.quantidade > 0);
}

async function montarPedidoCompleto(pickingOrder) {
    const itens = await buscarItensDoPedido(pickingOrder.id);
    return {
        numeroErp: String(pickingOrder.id),
        criadoEm: pickingOrder.date ?? new Date().toISOString(),
        itens,
    };
}

async function gravarPedido(pedido) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existente = await client.query(
            `SELECT id FROM pedidos WHERE numero_erp = $1`,
            [pedido.numeroErp]
        );

        if (existente.rowCount > 0) {
            await client.query('ROLLBACK');
            return { status: 'ja_existia', numeroErp: pedido.numeroErp };
        }

        if (pedido.itens.length === 0) {
            await client.query('ROLLBACK');
            return { status: 'sem_itens', numeroErp: pedido.numeroErp };
        }

        const { rows } = await client.query(
            `INSERT INTO pedidos (numero_erp, criado_em) VALUES ($1, $2) RETURNING id`,
            [pedido.numeroErp, pedido.criadoEm]
        );
        const pedidoId = rows[0].id;

        let itensGravados = 0;
        for (const item of pedido.itens) {
            const produto = await client.query(`SELECT id FROM produtos WHERE sku = $1`, [item.sku]);

            if (produto.rowCount === 0) {
                console.warn(
                    `[zenerp] Produto com SKU "${item.sku}" não está cadastrado. ` +
                    `Item do pedido ${pedido.numeroErp} foi ignorado.`
                );
                continue;
            }

            await client.query(
                `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x) VALUES ($1, $2, $3)`,
                [pedidoId, produto.rows[0].id, item.quantidade]
            );
            itensGravados += 1;
        }

        await client.query('COMMIT');
        return { status: 'gravado', numeroErp: pedido.numeroErp, itensGravados };
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
}

async function executarCiclo() {
    console.log(`[zenerp] Consultando pedidos abertos...`);
    try {
        const pickingOrders = await buscarPickingOrders();

        if (pickingOrders.length === 0) {
            console.log('[zenerp] Nenhum pedido aberto encontrado.');
            return;
        }

        console.log(`[zenerp] ${pickingOrders.length} pedido(s) aberto(s) encontrado(s).`);

        for (const pickingOrder of pickingOrders) {
            const pedido = await montarPedidoCompleto(pickingOrder);
            const resultado = await gravarPedido(pedido);

            if (resultado.status === 'gravado') {
                console.log(
                    `[zenerp] pedido ${resultado.numeroErp} gravado com ${resultado.itensGravados} item(ns).`
                );
            } else if (resultado.status === 'sem_itens') {
                console.log(`[zenerp] pedido ${resultado.numeroErp} sem itens válidos, ignorado.`);
            } else {
                console.log(`[zenerp] pedido ${resultado.numeroErp} já existia, ignorado.`);
            }
        }
    } catch (erro) {
        console.error('[zenerp] Erro no ciclo de polling:', erro.response?.data || erro.message);
    }
}

// ------------------------------------------------------------
// Ponto de entrada chamado pelo index.js no boot da API.
// Só liga o polling se as variáveis do ZenERP estiverem
// configuradas - senão a API sobe normal, sem essa parte.
// ------------------------------------------------------------
function iniciarPollingZenErp() {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);

    if (faltando.length > 0) {
        console.log(`[zenerp] Polling desligado - faltam variáveis: ${faltando.join(', ')}`);
        return;
    }

    console.log(`[zenerp] Polling ligado, a cada ${process.env.POLL_INTERVAL_MINUTES || 3} minuto(s).`);
    executarCiclo();
    setInterval(executarCiclo, POLL_INTERVAL_MS);
}

module.exports = { iniciarPollingZenErp };