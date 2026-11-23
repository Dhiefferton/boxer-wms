// ============================================================
// Estoque do ZenERP pela categoria "Máquinas" do Boxer Operações
// (pedido do Dhiefferton, 23/11/2026, para o acompanhamento do inventário).
//
// O Boxer Operações já sincroniza o saldo do Zen das máquinas (perfil MAQ,
// endereço MAQ, reserva livre) em materiais.quantidade_erp. Aqui o WMS lê esse
// número pela API pública somente leitura do Operações (/api/v1), com uma chave
// criada em Integrações (tela Catálogo ou Estoque liberada).
//
// Variáveis na Vercel do wms-api:
//   BOXER_OPERACOES_API_URL  (ex.: https://boxer-requisicoes-2kyh.vercel.app)
//   BOXER_OPERACOES_API_KEY  (bx_live_…)
// Sem elas: devolve { configurado: false } e a tela mostra o aviso. Nunca lança.
// Cache de 5 min (a sincronização do Operações também não é contínua).
// ============================================================
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { em, valor }

async function chamar(caminho) {
    const base = String(process.env.BOXER_OPERACOES_API_URL || '').replace(/\/+$/, '');
    const r = await fetch(`${base}/api/v1/${caminho}`, {
        headers: { Authorization: `Bearer ${process.env.BOXER_OPERACOES_API_KEY}` },
        signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
    return j;
}

async function lerMaquinas() {
    // Tela liberada na chave: Catálogo ou Estoque (as duas têm materiais e categorias)
    let tela = 'estoque';
    let cats;
    try { cats = await chamar(`${tela}/categorias?limite=500`); } catch (e) {
        tela = 'catalogo';
        cats = await chamar(`${tela}/categorias?limite=500`);
    }
    const cat = (cats.dados || []).find((c) => String(c.nome || '').trim().toLowerCase() === 'máquinas');
    if (!cat) throw new Error('categoria "Máquinas" não encontrada no Boxer Operações');
    const saldos = {};
    let sincronizado = null;
    for (let pagina = 1; pagina <= 20; pagina++) {
        const r = await chamar(`${tela}/materiais?categoria_id=${cat.id}&limite=500&pagina=${pagina}&campos=codigo,quantidade_erp,ultima_sync_erp`);
        for (const m of r.dados || []) {
            const sku = String(m.codigo || '').trim().toUpperCase();
            if (!sku) continue;
            saldos[sku] = (saldos[sku] || 0) + (Number(m.quantidade_erp) || 0);
            if (m.ultima_sync_erp && (!sincronizado || m.ultima_sync_erp > sincronizado)) sincronizado = m.ultima_sync_erp;
        }
        if (pagina >= (r.paginas || 1)) break;
    }
    return { saldos, sincronizado };
}

/** { configurado, saldos: { SKU: qtd }, sincronizado_em, erro? } */
async function estoqueZenMaquinas() {
    if (!process.env.BOXER_OPERACOES_API_URL || !process.env.BOXER_OPERACOES_API_KEY) {
        return { configurado: false, saldos: {}, sincronizado_em: null };
    }
    if (cache && Date.now() - cache.em < CACHE_MS) return cache.valor;
    try {
        const { saldos, sincronizado } = await lerMaquinas();
        const valor = { configurado: true, saldos, sincronizado_em: sincronizado };
        cache = { em: Date.now(), valor };
        return valor;
    } catch (erro) {
        console.error('[estoque-operacoes]', erro.message);
        // Mantém o último valor bom, se houver, avisando do erro
        if (cache) return { ...cache.valor, erro: erro.message };
        return { configurado: true, saldos: {}, sincronizado_em: null, erro: erro.message };
    }
}

module.exports = { estoqueZenMaquinas };
