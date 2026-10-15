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

// Serial do Zen que serve pra achar a linha: só o que é de verdade. O Zen usa "-" (e vazio) como "sem
// serial" em MUITAS linhas ao mesmo tempo - procurar por serial.code=='-' devolve uma linha qualquer
// (foi o que fez o primeiro uso real do Estoque Devolução, produto 99302, concluir "não movi" com a
// linha já movida pro MAQ). Corrigido em 15/10/2026.
function serialDoZenValido(linha) {
    const codigo = String(linha?.serial?.code ?? '').trim();
    return codigo && codigo !== '-' ? codigo : null;
}

// Linhas do SKU que estão na reserva (usado quando a linha não tem serial no Zen e o id muda ao mover/reverter)
async function linhasDoSkuNaReserva(reservaId, sku) {
    return (await consultar(`reservation.id==${reservaId};productPacking.product.code=='${sku}'`, 200)).filter(
        (l) => Number(l.reservation?.id) === Number(reservaId)
    );
}

async function ligado(chaveFlag, envDesligado, req) {
    if (process.env[envDesligado] === '1') return false;
    return flagAtiva(pool, chaveFlag, { colaboradorId: req?.usuario?.id, cargo: req?.usuario?.cargo });
}

// Solta UMA linha da reserva e confere. Devolve { status: 'revertida'|'desligado'|'erro', mensagem? }
async function reverterLinha({ stockId, serialDoZen, reservaId, enderecoId, sku, flag, envDesligado, tag, req }) {
    try {
        if (!(await ligado(flag, envDesligado, req))) return { status: 'desligado' };
        // Conferência de que a linha soltou da reserva: pelo id (o Zen pode manter o id ao reverter), pelo serial
        // (só se for serial de verdade) ou, pra linha sem serial cujo id mudou, comparando quantas linhas do SKU
        // ficaram na reserva no endereço do depósito, antes e depois.
        const contar = async () => (await linhasDoSkuNaReserva(reservaId, sku)).filter((l) => Number(l.address?.id) === Number(enderecoId)).length;
        const antes = await contar().catch(() => null);
        let erroChamada = null;
        try {
            await zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaId}?stockId=${stockId}&quantity=1`, {});
        } catch (erro) {
            erroChamada = erro;
        }
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            const porId = (await consultar(`id==${stockId}`).catch(() => []))[0];
            if (porId && !porId.reservation?.id) {
                console.log(`[${tag}] alocação revertida no Zen: linha ${porId.id} (reserva ${reservaId})`);
                return { status: 'revertida' };
            }
            if (serialDoZen) {
                const depois = (await consultar(`serial.code=='${serialDoZen}'`).catch(() => []))[0];
                if (depois && !depois.reservation?.id) {
                    console.log(`[${tag}] alocação revertida no Zen: linha ${depois.id} (reserva ${reservaId})`);
                    return { status: 'revertida' };
                }
            }
            if (!porId) {
                // id sumiu (linha nova) e sem serial pra seguir: conta as linhas do SKU que sobraram na reserva
                const depois = await contar().catch(() => null);
                if (antes !== null && depois !== null && depois < antes) {
                    console.log(`[${tag}] alocação revertida no Zen: SKU ${sku}, reserva ${reservaId} (${antes} -> ${depois} linha(s) no endereço ${enderecoId})`);
                    return { status: 'revertida' };
                }
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

// ONDE ESTÁ A LINHA DEPOIS DE ALOCAR (corrigido 14/10/2026, achado na primeira bipagem real do
// Estoque Devolução - serial #140258, SKU 99085 - que respondeu "não achei a linha de estoque no
// ZenERP"): o id da linha que escolhemos ANTES de alocar nem sempre continua valendo depois -
// o Zen pode gerar uma linha nova (mesmo comportamento do "Alterar estoque", que troca o id).
// Por isso, em vez de confiar só no id antigo, acha a linha assim:
//   1. o próprio id, SE ele continua existindo e já está na reserva esperada;
//   2. o serial do Zen da linha (quando ela tem serial);
//   3. senão, as linhas do mesmo SKU que estão na reserva esperada, ainda no endereço de origem
//      (MAQ) e com o mesmo lote/qualidade da linha escolhida - pega a de maior id (a mais nova).
//      Na reserva compartilhada (22919) uma linha igual dessas é equivalente (o Zen é tratado
//      por produto neste sistema), então mover/reverter qualquer uma delas dá o mesmo resultado.
// `modelo` = a linha como estava ANTES de alocar (resposta de /material/stock).
async function localizarLinhaAlocada({ stockId, modelo, sku, reservaId }) {
    const naReserva = (l) => l && Number(l.reservation?.id) === Number(reservaId);
    if (stockId) {
        const porId = (await consultar(`id==${stockId}`))[0];
        if (naReserva(porId)) return porId;
    }
    const serial = serialDoZenValido(modelo);
    if (serial) {
        const porSerial = (await consultar(`serial.code=='${serial}'`))[0];
        if (naReserva(porSerial)) return porSerial;
    }
    if (sku) {
        const candidatas = (await consultar(`reservation.id==${reservaId};productPacking.product.code=='${sku}'`, 200))
            .filter((l) => naReserva(l))
            .filter((l) => modelo?.address?.id == null || Number(l.address?.id) === Number(modelo.address.id))
            .filter((l) => modelo?.lot?.id == null || Number(l.lot?.id ?? 0) === Number(modelo.lot.id))
            .filter((l) => modelo?.quality?.id == null || Number(l.quality?.id ?? 0) === Number(modelo.quality.id));
        candidatas.sort((a, b) => Number(b.id) - Number(a.id));
        if (candidatas[0]) return candidatas[0];
    }
    return null;
}

// stockId: id da linha que ACABOU de ser alocada na reserva. enderecoChave: chave de Configurações
// com o id do endereço do Zen (0 = não move). Sem enderecoId = status 'sem_endereco' e nada é feito.
async function moverEReverterLinha({ stockId, modelo, sku, reservaId, enderecoChave, flagMover, envMover, flagReverter, envReverter, tag, req }) {
    try {
        if (!(await ligado(flagMover, envMover, req))) return { status: 'desligado' };
        const enderecoId = Number(await configuracoes.valor(pool, enderecoChave));
        if (!enderecoId) return { status: 'sem_endereco' };

        const linha = await localizarLinhaAlocada({ stockId, modelo, sku, reservaId });
        if (!linha) {
            return { status: 'erro', mensagem: 'Alocado na reserva, mas não achei a linha de estoque no ZenERP - mova o endereço manualmente (Alterar estoque) e reverta a alocação.' };
        }
        const serialDoZen = serialDoZenValido(linha);

        if (Number(linha.address?.id) === enderecoId) {
            const reversao = await reverterLinha({ stockId: linha.id, serialDoZen, reservaId, enderecoId, sku, flag: flagReverter, envDesligado: envReverter, tag, req });
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
        const noDestinoAntes = (await linhasDoSkuNaReserva(reservaId, sku).catch(() => [])).filter((l) => Number(l.address?.id) === enderecoId);
        let erroChamada = null;
        let respostaMover = null;
        try {
            respostaMover = await zenErpPost(`/material/stockOpUpdate/${linha.id}`, corpo);
        } catch (erro) {
            erroChamada = erro;
        }
        // O Zen responde com a linha NOVA (a tela dele usa stock1.id): é a pista mais direta de onde a linha foi parar.
        const idNovo = respostaMover?.data?.id ?? null;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            let depois = null;
            const certa = (l) => l && Number(l.address?.id) === enderecoId;
            // 1. pelo id que o próprio Zen devolveu
            if (idNovo) depois = (await consultar(`id==${idNovo}`).catch(() => []))[0] || null;
            // 2. pelo serial, só se for serial de verdade
            if (!certa(depois) && serialDoZen) depois = (await consultar(`serial.code=='${serialDoZen}'`).catch(() => []))[0] || null;
            // 3. a linha mais nova do SKU na reserva que apareceu no endereço do depósito
            if (!certa(depois)) {
                const idsAntes = new Set(noDestinoAntes.map((l) => Number(l.id)));
                const novas = (await linhasDoSkuNaReserva(reservaId, sku).catch(() => [])).filter((l) => certa(l) && !idsAntes.has(Number(l.id)));
                depois = novas.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
            }
            if (certa(depois)) {
                console.log(`[${tag}] endereço no Zen: linha ${linha.id} -> ${depois.id} (endereço ${enderecoId}, reserva ${depois.reservation?.id ?? '-'})`);
                const reversao = await reverterLinha({ stockId: depois.id, serialDoZen, reservaId, enderecoId, sku, flag: flagReverter, envDesligado: envReverter, tag, req });
                return { status: 'movido', stockId: depois.id, reversao };
            }
        }
        const detalhe = erroChamada?.response?.data ? JSON.stringify(erroChamada.response.data) : erroChamada?.message;
        console.warn(`[${tag}] endereço no Zen NÃO movido (linha ${linha.id}): ${detalhe || 'sem erro, mas o endereço não mudou'} | resposta do Zen: ${JSON.stringify(respostaMover?.data ?? null)?.slice(0, 300)}`);
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
