// ============================================================
// Saldo do Zen por depósito de origem (15/10/2026, a pedido do Dhiefferton: "esses itens podem
// voltar para o endereço no picking, mas devem buscar o saldo no Zen, quando forem bipados, dos
// seus respectivos depósitos e não do MAQ - isso quando for etiqueta do WMS").
//
// COMO FUNCIONA
//   - No Estoque Devolução (devolucao-estoque.js), a unidade de Verde/Amarelo/Vermelho/Avarias volta
//     pro picking como a de Máquinas, e o WMS grava o depósito dela em unidades_serializadas.deposito_zen.
//     No Zen a linha dela já foi movida pro endereço do depósito (VER/AMA/VRM/AVA, ver lib/zen-endereco.js).
//   - Quando essa unidade é bipada (Separação: separacao-erp.js; Transferência: transferencia-deposito.js),
//     a linha livre a alocar vem desse endereço, em vez do MAQ. Unidade sem deposito_zen (Máquinas, ou
//     qualquer unidade antiga) continua puxando do MAQ, como sempre foi.
//   - Sem saldo livre no endereço do depósito: a bipagem é BLOQUEADA com aviso (nunca cai no MAQ por
//     conta própria - decisão do Dhiefferton, 15/10/2026).
//
// SEGURANÇA / ROLLBACK
//   - Só serial NOSSO (etiqueta do WMS) tem deposito_zen; serial de fábrica/Zen não passa por aqui.
//   - Kill switch: SALDO_ZEN_POR_DEPOSITO_DESLIGADO=1 na Vercel, ou a função 'saldo_zen_por_deposito'
//     no painel. Desligado = tudo puxa do MAQ, como antes.
//   - A coluna é nova, opcional e só adiciona (ALTER TABLE ... ADD COLUMN IF NOT EXISTS), criada na
//     primeira necessidade - não depende da ordem de deploy. Se a criação falhar, tudo continua
//     funcionando como antes (puxando do MAQ).
// ============================================================
const configuracoes = require('./configuracoes');
const { flagAtiva } = require('./feature-flags');

// Mesmos nomes usados em pallets_vertical.deposito. Máquinas fica de fora de propósito: o saldo dele é o MAQ.
const DEPOSITOS_COM_SALDO_PROPRIO = ['Verde', 'Amarelo', 'Vermelho', 'Avarias'];

let colunaPromessa = null;

// Garante a coluna unidades_serializadas.deposito_zen. Devolve true/false (nunca lança).
async function garantirColuna(pool) {
    if (!colunaPromessa) {
        colunaPromessa = pool
            .query('ALTER TABLE unidades_serializadas ADD COLUMN IF NOT EXISTS deposito_zen TEXT')
            .then(() => true)
            .catch((erro) => {
                console.error('[deposito-zen] não consegui criar a coluna deposito_zen (segue puxando do MAQ):', erro.message);
                colunaPromessa = null; // tenta de novo na próxima
                return false;
            });
    }
    return colunaPromessa;
}

async function depositoDaUnidade(pool, unidadeId) {
    try {
        const { rows } = await pool.query('SELECT deposito_zen FROM unidades_serializadas WHERE id = $1', [unidadeId]);
        return rows[0]?.deposito_zen || null;
    } catch (_) {
        return null; // coluna ainda não existe: unidade normal, puxa do MAQ
    }
}

// De onde puxar a linha livre do Zen pra essa unidade. Devolve:
//   { filtro, deposito: null|'Verde'..., rotulo }  -> usar `reservation.id==0;${filtro};type==REGULAR;...`
//   { bloqueio: 'mensagem' }                       -> responder 409 com essa mensagem
async function origemDoSaldo(pool, unidadeId, req) {
    const padrao = { filtro: "address.code=='MAQ'", deposito: null, rotulo: 'MAQ' };
    try {
        if (!unidadeId || process.env.SALDO_ZEN_POR_DEPOSITO_DESLIGADO === '1') return padrao;
        const deposito = await depositoDaUnidade(pool, unidadeId);
        if (!deposito || !DEPOSITOS_COM_SALDO_PROPRIO.includes(deposito)) return padrao;
        const ligado = await flagAtiva(pool, 'saldo_zen_por_deposito', {
            colaboradorId: req?.usuario?.id,
            cargo: req?.usuario?.cargo,
        });
        if (!ligado) return padrao;
        const enderecoId = Number(await configuracoes.valor(pool, `endereco_zen_devolucao_${deposito.toLowerCase()}`));
        if (!enderecoId) {
            return {
                bloqueio: `Essa unidade veio do depósito ${deposito}, mas o endereço do ${deposito} no ZenERP não está configurado (Configurações > Endereço do ZenERP por depósito). Configure ou fale com um admin.`,
            };
        }
        return { filtro: `address.id==${enderecoId}`, deposito, rotulo: `${deposito} (endereço ${enderecoId})` };
    } catch (erro) {
        // Falha ao decidir a origem NÃO pode travar a operação por um erro nosso: cai no MAQ, como antes.
        console.error('[deposito-zen] falha ao decidir a origem do saldo (usando MAQ):', erro.message);
        return padrao;
    }
}

function mensagemSemSaldo(origem, sku) {
    return origem.deposito
        ? `Sem saldo livre no ${origem.rotulo} do ZenERP pro produto ${sku} (essa unidade veio do depósito ${origem.deposito}). Nada foi alocado.`
        : `Sem estoque disponível na área MAQ para o produto ${sku}`;
}

module.exports = { DEPOSITOS_COM_SALDO_PROPRIO, garantirColuna, origemDoSaldo, mensagemSemSaldo };
