// ============================================================
// Etiqueta mestre (26/11/2026) - produto SEM serial do depósito PEC
// tem UMA etiqueta fixa (código M<sku>, mesmo modelo 10x5 das
// etiquetas de serial). Os fluxos que já existem (Entradas manuais,
// Recebimento por NF...) não geram etiqueta nova pra ele: só somam a
// quantidade no saldo dessa etiqueta (ver criarPalletRecebimento).
// ============================================================
const pool = require('../db');

let promessa = null;
function garantirEtiquetaMestre() {
    if (!promessa) {
        promessa = pool.query(`
            CREATE TABLE IF NOT EXISTS etiquetas_mestre (
                id            SERIAL PRIMARY KEY,
                produto_id    UUID NOT NULL UNIQUE REFERENCES produtos(id),
                codigo        VARCHAR(60) NOT NULL UNIQUE,
                quantidade    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
                criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS etiquetas_mestre_movimentos (
                id                 BIGSERIAL PRIMARY KEY,
                etiqueta_mestre_id INTEGER NOT NULL REFERENCES etiquetas_mestre(id),
                tipo               VARCHAR(30) NOT NULL,
                quantidade         NUMERIC(14,3) NOT NULL,
                saldo_antes        NUMERIC(14,3) NOT NULL,
                saldo_depois       NUMERIC(14,3) NOT NULL,
                observacao         TEXT,
                operador           VARCHAR(120),
                criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            ALTER TABLE etiquetas_mestre_movimentos ADD COLUMN IF NOT EXISTS zenerp_handling_unit_code VARCHAR(120);
            ALTER TABLE etiquetas_mestre_movimentos ADD COLUMN IF NOT EXISTS origem_tipo VARCHAR(30);
            ALTER TABLE etiquetas_mestre_movimentos ADD COLUMN IF NOT EXISTS origem_id UUID;
            CREATE INDEX IF NOT EXISTS idx_etq_mestre_mov ON etiquetas_mestre_movimentos (etiqueta_mestre_id, criado_em DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_etq_mestre_mov_hu ON etiquetas_mestre_movimentos (zenerp_handling_unit_code)
                WHERE zenerp_handling_unit_code IS NOT NULL;
        `).catch((erro) => { promessa = null; throw erro; });
    }
    return promessa;
}

const codigoMestre = (sku) => `M${sku}`;

// Busca (ou cria) a etiqueta do produto, dentro da transação do chamador.
async function etiquetaDoProduto(client, produtoId, sku) {
    await client.query(
        `INSERT INTO etiquetas_mestre (produto_id, codigo) VALUES ($1, $2) ON CONFLICT (produto_id) DO NOTHING`,
        [produtoId, codigoMestre(sku)]);
    return (await client.query(`SELECT * FROM etiquetas_mestre WHERE produto_id = $1 FOR UPDATE`, [produtoId])).rows[0];
}

// Soma (delta > 0) ou desconta (delta < 0) no saldo, com histórico.
async function movimentarEtiquetaMestre(client, { produtoId, sku, delta, tipo, observacao = null, operador = null,
    zenerpHandlingUnitCode = null, origemTipo = null, origemId = null }) {
    const etq = await etiquetaDoProduto(client, produtoId, sku);
    const antes = Number(etq.quantidade);
    const depois = antes + Number(delta);
    if (depois < 0) throw Object.assign(new Error(`Saldo insuficiente na etiqueta ${etq.codigo} (tem ${antes})`), { status: 409 });
    await client.query(`UPDATE etiquetas_mestre SET quantidade = $2, atualizado_em = now() WHERE id = $1`, [etq.id, depois]);
    await client.query(
        `INSERT INTO etiquetas_mestre_movimentos
            (etiqueta_mestre_id, tipo, quantidade, saldo_antes, saldo_depois, observacao, operador, zenerp_handling_unit_code, origem_tipo, origem_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [etq.id, tipo, delta, antes, depois, observacao, operador, zenerpHandlingUnitCode, origemTipo, origemId]);
    return { codigo: etq.codigo, saldoAntes: antes, saldo: depois };
}

// Produto entra no fluxo de etiqueta mestre? Sem serial e no depósito PEC.
const usaEtiquetaMestre = (produto) => !!produto && !produto.serializado && produto.deposito === 'PEC';

module.exports = { garantirEtiquetaMestre, etiquetaDoProduto, movimentarEtiquetaMestre, usaEtiquetaMestre, codigoMestre };
