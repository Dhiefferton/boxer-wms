// ============================================================
// Mover o endereço de uma linha de estoque no ZenERP ("Alterar estoque") e
// reverter a alocação dela na reserva - os dois últimos passos do processo
// manual que o Dhiefferton gravou em vídeo (14/10/2026). Usado pelo Estoque
// Devolução (devolucao-estoque.js). A Transferência de Depósito tem a sua cópia
// em transferencia-deposito.js (moverEnderecoNoZen / reverterAlocacaoNoZen),
// mantida assim de propósito pra não mexer em fluxo que já está em produção.
//
// CONTRATO DO ZEN (lido do front e confirmado em teste real de 14/10/2026):
//     POST /material/stockOpUpdate/{idDaLinha}
//          corpo { addressId, qualityId, lotId, serialId, expirationDate,
//                  handlingUnitId, tags, quantity } - tudo igual ao da linha, só
//          o addressId muda. A linha NOVA ganha outro id e continua na reserva:
//          a conferência é pelo serial do Zen, nunca pelo id antigo.
//     POST /material/reservationOpAllocateStockRevert/{reservaId}?stockId=&quantity=1
//          reverte UMA linha da reserva.
//
// POR QUE SÓ A LINHA MOVIDA (e nunca "Reverter alocação de todos os estoques da
// reserva", reservationOpAllocateAutoRevert): a reserva 22919 do Estoque Devolução
// é a MESMA do Mercado Livre da Transferência de Depósito, e ali ficam linhas
// alocadas esperando por outros processos. Reverter a reserva inteira soltaria
// linhas que não são desta bipagem. Aqui o resultado é o mesmo do processo manual
// pra essa unidade: linha no endereço novo e sem reserva.
//
// SEGURANÇA: roda DEPOIS de tudo gravado no WMS e NUNCA lança erro - devolve
// { status, mensagem? } e a bipagem segue valendo. Só mexe numa linha que está na
// reserva esperada. A reversão só roda com o endereço já certo no Zen e confere no
// Zen se a linha soltou. Idempotente.
// status: 'movido' | 'ja_estava' | 'desligado' | 'sem_endereco' | 'erro'
// reversao (quando passou do mover): 'revertida' | 'desligado' | 'erro'
// ============================================================
const pool = require('../db');
const { zenErpGet, zenErpPost } = require('../poller');
const configuracoes = require('./configuracoes');
const { flagAtiva } = require('./feature-flags');

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consultar(q, max = 1) {
    const r = await zenErpGet('/material/stock', { q, max });
    return Array.isArray(r.data) ? r.data : r.data?.data || [];
}

async function ligado(chaveFlag, envDesligado, req) {
    if (process.env[envDesligado] === '1') return false;
    return flagAtiva(pool, chaveFlag, { colaboradorId: req?.usuario?.id, cargo: req?.usuario?.cargo });
}

// Solta UMA linha da reserva e confere. Devolve { status: 'revertida'|'desligado'|'erro', mensagem? }
async function reverterLinha({ stockId, serialDoZen, reservaId, flag, envDesligado, tag, req }) {
    try {
        if (!(await ligado(flag, envDesligado, req))) return { status: 'desligado' };
        let erroChamada = null;
        try {
            await zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaId}?stockId=${stockId}&quantity=1`, {});
        } catch (erro) {
            erroChamada = erro;
        }
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            const depois = (await consultar(serialDoZen ? `serial.code=='${serialDoZen}'` : `id==${stockId}`).catch(() => []))[0];
            if (depois && !depois.reservation?.id) {
                console.log(`[${tag}] alocação revertida no Zen: linha ${depois.id} (reserva ${reservaId})`);
                return { status: 'revertida' };
            }
        }
        const detalhe = erroChamada?.response?.data ? JSON.stringify(erroChamada.response.data) : erroChamada?.message;
        console.warn(`[${tag}] alocação NÃO revertida no Zen (linha ${stockId}, reserva ${reservaId}): ${detalhe || 'sem erro, mas continua alocada'}`);
        return {
            status: 'erro',
            mensagem: `Endereço movido no ZenERP, mas NÃO consegui reverter a alocação na reserva ${reservaId}${erroChamada?.response?.status ? ` (HTTP ${erroChamada.response.status})` : ''}. Reverta manualmente no Zen (Reverter alocação).`,
        };
    } catch (erro) {
        console.error(`[${tag}] falha ao reverter alocação no Zen (não crítico):`, erro?.response?.data || erro.message);
        return { status: 'erro', mensagem: `Endereço movido no ZenERP, mas não consegui falar com o Zen pra reverter a alocação na reserva ${reservaId}. Reverta manualmente (Reverter alocação).` };
    }
}

// stockId: id da linha que ACABOU de ser alocada na reserva. enderecoChave: chave de Configurações
// com o id do endereço do Zen (0 = não move). Sem enderecoId = status 'sem_endereco' e nada é feito.
async function moverEReverterLinha({ stockId, reservaId, enderecoChave, flagMover, envMover, flagReverter, envReverter, tag, req }) {
    try {
        if (!(await ligado(flagMover, envMover, req))) return { status: 'desligado' };
        const enderecoId = Number(await configuracoes.valor(pool, enderecoChave));
        if (!enderecoId) return { status: 'sem_endereco' };

        const linha = stockId ? (await consultar(`id==${stockId}`))[0] : null;
        if (!linha) {
            return { status: 'erro', mensagem: 'Alocado na reserva, mas não achei a linha de estoque no ZenERP - mova o endereço manualmente (Alterar estoque) e reverta a alocação.' };
        }
        if (Number(linha.reservation?.id) !== Number(reservaId)) {
            return {
                status: 'erro',
                mensagem: `No ZenERP a linha ${linha.id} está ${linha.reservation?.id ? `na reserva ${linha.reservation.id}` : 'sem reserva'} (esperado: ${reservaId}) - não movi o endereço. Confira no Zen.`,
            };
        }
        const serialDoZen = linha.serial?.code;

        if (Number(linha.address?.id) === enderecoId) {
            const reversao = await reverterLinha({ stockId: linha.id, serialDoZen, reservaId, flag: flagReverter, envDesligado: envReverter, tag, req });
            return { status: 'ja_estava', stockId: linha.id, reversao };
        }

        // mesmo corpo da tela do Zen: tudo igual ao da linha, só o endereço muda
        const corpo = {
            addressId: enderecoId,
            qualityId: linha.quality?.id,
            lotId: linha.lot?.id,
            serialId: linha.serial?.id,
            expirationDate: linha.expirationDate,
            handlingUnitId: linha.handlingUnit?.id,
            tags: linha.tags,
            quantity: linha.quantity,
        };
        let erroChamada = null;
        try {
            await zenErpPost(`/material/stockOpUpdate/${linha.id}`, corpo);
        } catch (erro) {
            erroChamada = erro;
        }
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            const depois = (await consultar(serialDoZen ? `serial.code=='${serialDoZen}'` : `id==${linha.id}`).catch(() => []))[0];
            if (depois && Number(depois.address?.id) === enderecoId) {
                console.log(`[${tag}] endereço no Zen: linha ${linha.id} -> ${depois.id} (endereço ${enderecoId}, reserva ${depois.reservation?.id ?? '-'})`);
                const reversao = await reverterLinha({ stockId: depois.id, serialDoZen, reservaId, flag: flagReverter, envDesligado: envReverter, tag, req });
                return { status: 'movido', stockId: depois.id, reversao };
            }
        }
        const detalhe = erroChamada?.response?.data ? JSON.stringify(erroChamada.response.data) : erroChamada?.message;
        console.warn(`[${tag}] endereço no Zen NÃO movido (linha ${linha.id}): ${detalhe || 'sem erro, mas o endereço não mudou'}`);
        return {
            status: 'erro',
            mensagem: `Alocado na reserva, mas NÃO consegui mover o endereço no ZenERP${erroChamada?.response?.status ? ` (HTTP ${erroChamada.response.status})` : ''}. Mova manualmente (Alterar estoque) e reverta a alocação.`,
        };
    } catch (erro) {
        console.error(`[${tag}] falha ao mover o endereço no Zen (não crítico):`, erro?.response?.data || erro.message);
        return { status: 'erro', mensagem: 'Alocado na reserva, mas não consegui falar com o ZenERP pra mover o endereço. Mova manualmente (Alterar estoque) e reverta a alocação.' };
    }
}

// Texto de aviso pro coletor (vazio quando deu tudo certo, estava desligado ou sem endereço)
function avisoDoZen(r) {
    if (r?.status === 'erro') return { avisoZen: r.mensagem };
    if (r?.reversao?.status === 'erro') return { avisoZen: r.reversao.mensagem };
    return {};
}

module.exports = { moverEReverterLinha, avisoDoZen };
