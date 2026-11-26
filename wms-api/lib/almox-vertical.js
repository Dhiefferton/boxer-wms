// ============================================================
// Almoxarifado — estoque vertical (26/11/2026, desenho aprovado pelo Dhiefferton;
// ver claude/almoxarifado-vertical-processo.md no projeto).
//
// Tabelas PRÓPRIAS, separadas da expedição (enderecos/pallets_vertical não são tocados),
// pra nenhuma regra da expedição (recebimento, reposição, pulmão) enxergar essas posições:
//   almox_enderecos       - ruas R8 e R9, prédios A a R, andares 1 a 5 (180 posições,
//                           criadas sozinhas na primeira vez). Os 5 andares são vertical.
//   almox_lotes           - um lote = uma caixa física (etiqueta de lote, L000001...).
//                           Pallet misto = vários lotes/SKUs na mesma posição. FIFO por data_entrada.
//   almox_lote_movimentos - histórico de cada lote (recebimento, conferência, guardar, reposição...).
// O Zen não acompanha esses movimentos (decisão do Dhiefferton).
// ============================================================
const pool = require('../db');

const RUAS = ['R8', 'R9'];
const PREDIOS = 'ABCDEFGHIJKLMNOPQR'.split('');
const ANDARES = [1, 2, 3, 4, 5];

let estrutura = null;
function garantirAlmoxVertical() {
    if (!estrutura) {
        estrutura = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS almox_enderecos (
                    id              SERIAL PRIMARY KEY,
                    codigo          TEXT NOT NULL UNIQUE,
                    rua             TEXT NOT NULL,
                    predio          TEXT NOT NULL,
                    andar           INTEGER NOT NULL,
                    bloqueado       BOOLEAN NOT NULL DEFAULT false,
                    bloqueio_motivo TEXT,
                    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE IF NOT EXISTS almox_lotes (
                    id                 SERIAL PRIMARY KEY,
                    codigo             TEXT UNIQUE,
                    produto_id         UUID REFERENCES produtos(id),
                    sku                TEXT NOT NULL,
                    descricao          TEXT,
                    quantidade_inicial NUMERIC(14,3) NOT NULL,
                    quantidade         NUMERIC(14,3) NOT NULL CHECK (quantidade >= 0),
                    data_entrada       DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                    nota_importacao_id UUID,
                    nf_numero          TEXT,
                    nf_item_id         UUID,
                    status             TEXT NOT NULL DEFAULT 'aguardando_conferencia',
                    endereco_id        INTEGER REFERENCES almox_enderecos(id),
                    conferencia        JSONB,
                    criado_por         TEXT,
                    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
                    guardado_em        TIMESTAMPTZ,
                    guardado_por       TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_almox_lotes_endereco ON almox_lotes (endereco_id) WHERE quantidade > 0;
                CREATE INDEX IF NOT EXISTS idx_almox_lotes_sku ON almox_lotes (sku, data_entrada);
                CREATE TABLE IF NOT EXISTS almox_lote_movimentos (
                    id          BIGSERIAL PRIMARY KEY,
                    lote_id     INTEGER NOT NULL REFERENCES almox_lotes(id),
                    tipo        TEXT NOT NULL,
                    quantidade  NUMERIC(14,3),
                    endereco_id INTEGER REFERENCES almox_enderecos(id),
                    observacao  TEXT,
                    operador    TEXT,
                    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_almox_mov_lote ON almox_lote_movimentos (lote_id, criado_em);
            `);
            // Marca no item da NF que ele é do almoxarifado vertical (etapa 2). Checa antes
            // pra não pedir lock na tabela de itens toda vez que a instância sobe.
            const col = await pool.query(
                `SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'nf_importacao_itens' AND column_name = 'almox'`);
            if (col.rowCount === 0) {
                await pool.query(`ALTER TABLE nf_importacao_itens ADD COLUMN IF NOT EXISTS almox BOOLEAN NOT NULL DEFAULT false`);
            }
            const { rows } = await pool.query(`SELECT count(*)::int AS n FROM almox_enderecos`);
            if (rows[0].n === 0) {
                const valores = [];
                const params = [];
                for (const rua of RUAS) for (const predio of PREDIOS) for (const andar of ANDARES) {
                    const b = params.length;
                    valores.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
                    params.push(`${rua}-${predio}-A${andar}`, rua, predio, andar);
                }
                await pool.query(
                    `INSERT INTO almox_enderecos (codigo, rua, predio, andar) VALUES ${valores.join(', ')} ON CONFLICT (codigo) DO NOTHING`,
                    params);
            }
        })().catch((e) => { estrutura = null; throw e; });
    }
    return estrutura;
}

function codigoLote(id) {
    return `L${String(id).padStart(6, '0')}`;
}

module.exports = { garantirAlmoxVertical, codigoLote, RUAS, PREDIOS, ANDARES };
