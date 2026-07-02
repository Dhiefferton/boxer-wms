// ============================================================
// WMS - Serviço de polling do ZenERP
// ============================================================
// O que este serviço faz, em português simples:
//
//   1. Faz login no ZenERP (usuário/senha) pra conseguir um token
//      de acesso, e guarda esse token em memória por ~23h (o
//      token real dura 24h - deixamos 1h de folga).
//   2. De tempos em tempos (POLL_INTERVAL_MINUTES), busca todos
//      os pedidos abertos: GET /material/pickingOrder com filtro
//      status != FINISHED.
//   3. Para cada pedido, busca os itens dele:
//      GET /material/pickingOrderItem?pickingOrder={id}
//   4. Para cada pedido que ainda não existe no nosso banco,
//      grava o pedido + os itens. Gravar em `itens_pedido` já
//      dispara sozinho o motor de alocação (gatilho no banco).
//
// Não existe filtro de "desde quando" nesse endpoint do ZenERP,
// então buscamos TODOS os pedidos abertos a cada ciclo - o que
// evita duplicar é a checagem de "já existe" antes de gravar.
// ============================================================

require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MINUTES || 3) * 60 * 1000;

// ------------------------------------------------------------
// Login e cache do token. O ZenERP dura ~24h, guardamos por 23h
// de propósito (margem de segurança).
// ------------------------------------------------------------
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
        {
            headers: { tenant: process.env.ZENERP_TENANT },
        }
    );

    tokenCache = {
        valor: resposta.data.accessToken,
        expiraEm: Date.now() + 23 * 60 * 60 * 1000, // 23h de folga
    };

    console.log('Login no ZenERP renovado.');
    return tokenCache.valor;
}

// ------------------------------------------------------------
// Cliente HTTP para os endpoints de material - sempre busca um
// token válido antes de cada chamada (usa o cache se ainda
// estiver bom, só loga de novo quando expirar).
// ------------------------------------------------------------
async function zenErpGet(path, params) {
    const token = await obterToken();
    return axios.get(`${process.env.ZENERP_BASE_URL}${path}`, {
        params,
        timeout: 15000,
        headers: {
            Authorization: `Bearer ${token}`,
            tenant: process.env.ZENERP_TENANT,
        },
    });
}

// ------------------------------------------------------------
// Busca todos os pedidos abertos (não finalizados) no ZenERP.
// ------------------------------------------------------------
async function buscarPickingOrders() {
    const resposta = await zenErpGet('/material/pickingOrder', { iq: 'status!=FINISHED' });
    return Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
}

// ------------------------------------------------------------
// Busca os itens de um pedido específico.
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Junta pedido + itens no formato interno que o resto do
// serviço espera.
// ------------------------------------------------------------
async function montarPedidoCompleto(pickingOrder) {
    const itens = await buscarItensDoPedido(pickingOrder.id);
    return {
        numeroErp: String(pickingOrder.id),
        criadoEm: pickingOrder.date ?? new Date().toISOString(),
        itens,
    };
}

// ------------------------------------------------------------
// Grava um pedido novo no banco, se ele ainda não existir.
// Cada item inserido dispara o motor de alocação automaticamente.
// ------------------------------------------------------------
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
            const produto = await client.query(
                `SELECT id FROM produtos WHERE sku = $1`,
                [item.sku]
            );

            if (produto.rowCount === 0) {
                console.warn(
                    `[aviso] Produto com SKU "${item.sku}" não está cadastrado no WMS. ` +
                    `Item do pedido ${pedido.numeroErp} foi ignorado - cadastre o produto primeiro.`
                );
                continue;
            }

            // Este INSERT dispara o gatilho itens_pedido_after_insert,
            // que roda o motor de alocação sozinho.
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

// ------------------------------------------------------------
// Um ciclo completo de polling.
// ------------------------------------------------------------
async function executarCiclo() {
    const inicio = new Date().toISOString();
    console.log(`\n[${inicio}] Consultando ZenERP por pedidos abertos...`);

    try {
        const pickingOrders = await buscarPickingOrders();

        if (pickingOrders.length === 0) {
            console.log('Nenhum pedido aberto encontrado.');
            return;
        }

        console.log(`${pickingOrders.length} pedido(s) aberto(s) encontrado(s) no ZenERP.`);

        for (const pickingOrder of pickingOrders) {
            const pedido = await montarPedidoCompleto(pickingOrder);
            const resultado = await gravarPedido(pedido);

            if (resultado.status === 'gravado') {
                console.log(
                    `  -> pedido ${resultado.numeroErp} gravado com ${resultado.itensGravados} item(ns). ` +
                    `Motor de alocação disparado.`
                );
            } else if (resultado.status === 'sem_itens') {
                console.log(`  -> pedido ${resultado.numeroErp} não tem itens válidos, ignorado.`);
            } else {
                console.log(`  -> pedido ${resultado.numeroErp} já existia, ignorado.`);
            }
        }
    } catch (erro) {
        console.error('Erro no ciclo de polling:', erro.response?.data || erro.message);
    }
}

// ------------------------------------------------------------
// Loop principal: roda um ciclo agora, depois repete no intervalo
// configurado. Se um ciclo demorar mais que o intervalo, o próximo
// só começa depois que o anterior terminar (evita sobreposição).
// ------------------------------------------------------------
async function iniciar() {
    console.log(
        `Serviço de polling do ZenERP iniciado. Consultando a cada ` +
        `${process.env.POLL_INTERVAL_MINUTES || 3} minuto(s).`
    );

    while (true) {
        await executarCiclo();
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

iniciar();