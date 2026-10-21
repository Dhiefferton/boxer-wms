// Identidade de uma linha de estoque do ZenERP (21/10/2026, pedido do Dhiefferton: "no historico de
// cada serial nosso, tenha o serial que foi usado do zen, para ter triangulacao das informacoes").
// O serial nosso (#120575) e uma referencia interna; a linha do Zen que foi consumida/movida quando ele
// foi bipado tem o proprio id de estoque e, quando existe, o proprio serial ("-" = linha sem serial).
// Gravado em movimentacoes.serial_zen / movimentacoes.zen_stock_id (colunas opcionais).
function identidadeZen(linha) {
    if (!linha || typeof linha !== 'object') return { serialZen: null, zenStockId: null };
    const codigo = String(linha.serial?.code ?? '').trim();
    const serialZen = codigo && codigo !== '-' ? codigo.slice(0, 120) : null;
    const id = Number(linha.id);
    return { serialZen, zenStockId: Number.isFinite(id) && id > 0 ? id : null };
}

module.exports = { identidadeZen };
