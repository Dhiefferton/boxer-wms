// ============================================================
// Lojinha no Boxer Operações (26/11/2026, pedido do Dhiefferton): quando o WMS finaliza a
// reserva de uma ordem da Lojinha/Suporte, avisa o Operações, que preenche os campos da
// coluna "Em Separação" (início, colaborador, término) e move o card para "Em Conferência".
//
// Chamada: POST {BOXER_OPERACOES_API_URL}/api/integracoes/wms/separacao com a mesma chave
// BOXER_OPERACOES_API_KEY (precisa da tela "lojinha" liberada na chave, no Operações).
// Perfis avisados: OPERACOES_LOJINHA_PERFIS (padrão "LOJINHA,SUPORTE").
//
// Nunca trava a separação: falhou, fica em notificacoes_operacoes e o ciclo do poller tenta de
// novo (até 20 vezes). Pedido que não é da Lojinha no Operações (404 "ignorado") encerra.
// ============================================================
const pool = require('../db');

let tabela = null;
function garantirTabela() {
    if (!tabela) {
        tabela = pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_operacoes (
                pedido_id     UUID PRIMARY KEY,
                numero_erp    TEXT NOT NULL,
                corpo         JSONB NOT NULL,
                tentativas    INTEGER NOT NULL DEFAULT 0,
                erro          TEXT,
                enviado_em    TIMESTAMPTZ,
                resposta      JSONB,
                criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
            );`).catch((e) => { tabela = null; throw e; });
    }
    return tabela;
}

const configurado = () => !!(process.env.BOXER_OPERACOES_API_URL && process.env.BOXER_OPERACOES_API_KEY);
const perfisAvisados = () => String(process.env.OPERACOES_LOJINHA_PERFIS || 'LOJINHA,SUPORTE')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

async function enviar(corpo) {
    const base = String(process.env.BOXER_OPERACOES_API_URL || '').replace(/\/+$/, '');
    const r = await fetch(`${base}/api/integracoes/wms/separacao`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.BOXER_OPERACOES_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && j.ignorado) return { ignorado: true, ...j };
    if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
    return j;
}

async function tentar(pedidoId) {
    const { rows } = await pool.query(`SELECT * FROM notificacoes_operacoes WHERE pedido_id = $1 AND enviado_em IS NULL`, [pedidoId]);
    const n = rows[0];
    if (!n) return null;
    try {
        const resposta = await enviar(n.corpo);
        await pool.query(`UPDATE notificacoes_operacoes SET enviado_em = now(), resposta = $2, erro = NULL, tentativas = tentativas + 1 WHERE pedido_id = $1`,
            [pedidoId, JSON.stringify(resposta)]);
        return resposta;
    } catch (e) {
        await pool.query(`UPDATE notificacoes_operacoes SET erro = $2, tentativas = tentativas + 1 WHERE pedido_id = $1`, [pedidoId, e.message]);
        console.warn(`[operacoes-lojinha] ordem ${n.numero_erp}: ${e.message} (tenta de novo no próximo ciclo)`);
        return null;
    }
}

/** Chamado ao finalizar a reserva. Best-effort, nunca lança. */
async function avisarSeparacaoConcluida(pedidoId) {
    try {
        if (!configurado()) return { configurado: false };
        const { rows } = await pool.query(`SELECT id, numero_erp, perfil_separacao_codigo FROM pedidos WHERE id = $1`, [pedidoId]);
        const p = rows[0];
        if (!p || !perfisAvisados().includes(String(p.perfil_separacao_codigo || '').toUpperCase())) return { ignorado: true };
        const { rows: mov } = await pool.query(
            `SELECT min(criado_em) AS inicio, array_remove(array_agg(DISTINCT operador), NULL) AS separadores
               FROM movimentacoes WHERE tipo = 'separacao' AND destino_tipo = 'pedido' AND destino_id = $1`, [p.id]);
        const corpo = {
            ordemSeparacao: String(p.numero_erp),
            inicio: mov[0]?.inicio || null,
            termino: new Date().toISOString(),
            separadores: mov[0]?.separadores || [],
        };
        await garantirTabela();
        await pool.query(
            `INSERT INTO notificacoes_operacoes (pedido_id, numero_erp, corpo) VALUES ($1, $2, $3)
             ON CONFLICT (pedido_id) DO UPDATE SET corpo = EXCLUDED.corpo, enviado_em = NULL, erro = NULL, tentativas = 0`,
            [p.id, String(p.numero_erp), JSON.stringify(corpo)]);
        return await tentar(p.id);
    } catch (e) {
        console.error('[operacoes-lojinha] falha ao avisar:', e.message);
        return null;
    }
}

/** Ciclo do poller: reenvia o que falhou. */
async function reenviarPendentes() {
    if (!configurado()) return;
    try {
        await garantirTabela();
        const { rows } = await pool.query(
            `SELECT pedido_id FROM notificacoes_operacoes WHERE enviado_em IS NULL AND tentativas < 20 ORDER BY criado_em LIMIT 10`);
        for (const r of rows) await tentar(r.pedido_id);
    } catch (e) {
        console.error('[operacoes-lojinha] reenvio:', e.message);
    }
}

module.exports = { avisarSeparacaoConcluida, reenviarPendentes };
