// ============================================================
// WMS - Serviço de polling do ZenERP
// ============================================================
// O que este serviço faz, em português simples:
//
//   1. De tempos em tempos (POLL_INTERVAL_MINUTES), pergunta pro
//      ZenERP: "tem pedido novo desde a última vez que eu chequei?"
//   2. Para cada pedido novo, grava uma linha em `pedidos` e uma
//      linha em `itens_pedido` para cada produto do pedido.
//   3. Gravar em `itens_pedido` já dispara sozinho o motor de
//      alocação (o gatilho que criamos no banco) - este serviço
//      não precisa saber nada sobre separação ou reposição.
//
// IMPORTANTE - suposição a confirmar com o fornecedor do ZenERP:
// Não temos ainda o endpoint exato de pedidos, então este código
// assume um formato de resposta JSON razoável (ver função
// `normalizarPedidoErp` abaixo). Assim que você tiver a
// documentação real do endpoint de pedidos, me manda que eu
// ajusto essa função para o formato certo - o resto do serviço
// (banco, agendamento, controle de duplicados) não muda.
// ============================================================

require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const zenErp = axios.create({
    baseURL: process.env.ZENERP_BASE_URL,
    timeout: 15000,
    headers: {
        Authorization: `Bearer ${process.env.ZENERP_BEARER_TOKEN}`,
        'X-Tenant-Key': process.env.ZENERP_TENANT_KEY,
    },
});

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MINUTES || 3) * 60 * 1000;

// ------------------------------------------------------------
// Descobre a partir de quando devemos buscar pedidos novos.
// Usa a data do último pedido já gravado no nosso banco.
// ------------------------------------------------------------
async function obterMarcaDagua() {
    const { rows } = await pool.query(
        `SELECT MAX(sincronizado_em) AS ultima FROM pedidos`
    );
    return rows[0].ultima || new Date(0).toISOString();
}

// ------------------------------------------------------------
// Busca pedidos novos no ZenERP a partir da marca d'água.
//
// AJUSTAR: troque a URL, o nome do parâmetro de data e o formato
// da resposta assim que tiver a documentação real do endpoint.
// ------------------------------------------------------------
async function buscarPedidosNovos(desde) {
    const path = process.env.ZENERP_PEDIDOS_PATH || '/pedidos';
    const resposta = await zenErp.get(path, {
        params: { desde },
    });

    // Suposição: a resposta é uma lista de pedidos.
    // Ajuste aqui se o ZenERP embrulhar em algo como { data: [...] }
    const listaBruta = Array.isArray(resposta.data)
        ? resposta.data
        : resposta.data?.data || [];

    return listaBruta.map(normalizarPedidoErp);
}

// ------------------------------------------------------------
// Traduz o formato do ZenERP para o formato interno que o
// resto do serviço espera. Se o formato real for diferente,
// só essa função precisa mudar.
// ------------------------------------------------------------
function normalizarPedidoErp(pedidoBruto) {
    return {
        numeroErp: String(pedidoBruto.numero ?? pedidoBruto.id),
        criadoEm: pedidoBruto.criado_em ?? pedidoBruto.data_criacao ?? new Date().toISOString(),
        itens: (pedidoBruto.itens ?? pedidoBruto.items ?? []).map((item) => ({
            sku: item.sku ?? item.codigo_produto,
            quantidade: Number(item.quantidade ?? item.qtd),
        })),
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
    console.log(`\n[${inicio}] Consultando ZenERP por pedidos novos...`);

    try {
        const marcaDagua = await obterMarcaDagua();
        const pedidos = await buscarPedidosNovos(marcaDagua);

        if (pedidos.length === 0) {
            console.log('Nenhum pedido novo encontrado.');
            return;
        }

        console.log(`${pedidos.length} pedido(s) encontrado(s) no ZenERP.`);

        for (const pedido of pedidos) {
            const resultado = await gravarPedido(pedido);
            if (resultado.status === 'gravado') {
                console.log(
                    `  -> pedido ${resultado.numeroErp} gravado com ${resultado.itensGravados} item(ns). ` +
                    `Motor de alocação disparado.`
                );
            } else {
                console.log(`  -> pedido ${resultado.numeroErp} já existia, ignorado.`);
            }
        }
    } catch (erro) {
        console.error('Erro no ciclo de polling:', erro.message);
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
