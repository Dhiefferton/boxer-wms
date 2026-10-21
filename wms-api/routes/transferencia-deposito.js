// Transferência de Depósito (16/09/2026)
// Fluxo novo, independente de qualquer pedido/ordem de separação:
// usa UMA reserva fixa no ZenERP (reserva 22919, conforme combinado
// com o Dhiefferton) que fica pra sempre "iniciada" lá - nosso
// sistema nunca finaliza essa reserva, ela só vai acumulando itens
// alocados nela, um por bipagem, representando o que já saiu daqui
// pro depósito de marketplace (Mercado Livre).
//
// Todo produto usado nesse fluxo é serializado (decisão do usuário -
// "todos os itens vão ser serializado, até as luvas") e sempre sai da
// área MAQ no ZenERP. Por isso a bipagem é livre: não tem uma lista
// prévia de itens esperados (a reserva não vem com produtos
// pré-definidos) - o colaborador bipa qualquer unidade que for de
// fato sair pra esse depósito, uma de cada vez.
//
// O item bipado SAI do estoque do WMS de vez (status='removido',
// desvincula de pallet/endereço) - fisicamente ele vai embora pro
// depósito de marketplace, não fica mais disponível aqui. Mesma
// representação de "unidade removida" já usada em DELETE
// /unidades-serializadas/:id, só que aqui é o fluxo normal do dia a
// dia (não uma correção manual), e antes de dar baixa aqui, aloca a
// unidade na reserva fixa do Zen - mesma lógica de escolha de linha
// de estoque (serial nosso x serial do Zen) já usada em
// separacao-erp.js (bipar-serial).
//
// CORREÇÃO 17/09/2026: além de Mercado Livre, agora dá pra escolher
// Showroom ou Assistência Técnica como depósito de destino (dropdown
// no coletor, ver TransferenciaDeposito.jsx) - ver comentário do mapa
// DESTINOS abaixo pra detalhe de como cada um é tratado.
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost } = require('../poller');
const { exigirCargo } = require('../auth');
const { reavaliarFilaPulmao } = require('../lib/pulmao');
const { cancelarTarefasSemEstoqueSuficiente } = require('../lib/reposicao');
const configuracoes = require('../lib/configuracoes');
const { flagAtiva } = require('../lib/feature-flags');
const { origemDoSaldo, mensagemSemSaldo, garantirColuna: garantirColunaDeposito } = require('../lib/deposito-zen');
const { moverEReverterLinha } = require('../lib/zen-endereco');
const { identidadeZen } = require('../lib/zen-serial');

const router = express.Router();

// Reserva fixa no ZenERP usada por esse fluxo - sempre fica "iniciada"
// lá, nunca é finalizada por aqui. Hoje só Mercado Livre usa a 22919
// (ver DESTINOS abaixo).
const RESERVATION_ID_TRANSFERENCIA_DEPOSITO = 22919;

// CORREÇÃO 28/09/2026: a pedido do Dhiefferton ("vamos usar a reserva
// 48981, para as transferência para os depositos assistencia,
// engenharia, showroom"), esses três depósitos passaram a usar uma
// reserva PRÓPRIA no ZenERP, separada da 22919 (que Mercado Livre e
// Almoxarifado continuam usando). Confirmado com ele por
// AskUserQuestion que só esses três mudam.
const RESERVATION_ID_ENGENHARIA = 48981;

// CORREÇÃO 08/10/2026: a pedido do Dhiefferton ("agora vamos ter uma
// reserva para cada depósito"), cada depósito passa a ter a sua PRÓPRIA
// reserva fixa no ZenERP:
//   Mercado Livre -> 22919 (RESERVATION_ID_TRANSFERENCIA_DEPOSITO)
//   Engenharia    -> 48981
//   Assistência   -> 50317
//   Showroom      -> 50318
//   Almoxarifado  -> 50319
// (Almoxarifado saiu da 22919 e Assistência/Showroom saíram da 48981.)
const RESERVATION_ID_ASSISTENCIA = 50317;
const RESERVATION_ID_SHOWROOM = 50318;
const RESERVATION_ID_ALMOXARIFADO = 50319;

// Depósitos de destino suportados por esse fluxo (17/09/2026, a pedido
// do Dhiefferton: "precisa acrescenta os depositos Showroom e
// Assistência Técnica"). Até 27/09/2026 todos caíam na mesma reserva
// fixa 22919 no ZenERP - só mudava o destino_tipo gravado aqui no WMS,
// pra distinguir pra onde cada unidade foi de verdade na tela de
// Histórico.
//
// CORREÇÃO 21/09/2026: acrescentado o depósito Almoxarifado (a pedido
// do Dhiefferton), na época também caindo na reserva fixa 22919.
//
// CORREÇÃO 27/09/2026: acrescentado o depósito Engenharia, mesmo
// padrão (na época também reserva fixa 22919).
//
// CORREÇÃO 28/09/2026: Showroom, Assistência Técnica e Engenharia
// passaram a usar a reserva 48981 (ver constante acima) - Mercado
// Livre e Almoxarifado continuam na 22919. IMPORTANTE: o número da
// reserva usado em cada bipagem é gravado por linha em
// `movimentacoes.reserva_zen_id` (ver registrarMovimentacao abaixo) -
// não confiar em nenhum número hardcoded pra ler o histórico de
// movimentações antigas, porque esse valor pode mudar de novo no
// futuro pra qualquer depósito.
const DESTINOS = {
    mercado_livre: { destinoTipo: 'reserva_zen', label: 'Mercado Livre', reservationId: RESERVATION_ID_TRANSFERENCIA_DEPOSITO },
    showroom: { destinoTipo: 'reserva_zen_showroom', label: 'Showroom', reservationId: RESERVATION_ID_SHOWROOM },
    assistencia_tecnica: { destinoTipo: 'reserva_zen_assistencia_tecnica', label: 'Assistência Técnica', reservationId: RESERVATION_ID_ASSISTENCIA },
    almoxarifado: { destinoTipo: 'reserva_zen_almoxarifado', label: 'Almoxarifado', reservationId: RESERVATION_ID_ALMOXARIFADO },
    engenharia: { destinoTipo: 'reserva_zen_engenharia', label: 'Engenharia', reservationId: RESERVATION_ID_ENGENHARIA },
};

// Reserva do ZenERP do depósito (Fase 7, 08/10/2026): vem da configuração
// 'reserva_zen_<depósito>' (painel Controle de acesso > Configurações). Sem
// nada salvo, é exatamente o número fixo do mapa DESTINOS acima. Qualquer
// falha na leitura cai no número fixo - nunca trava a bipagem.
async function reservaDoDestino(destinoChave, destino) {
    try {
        return await configuracoes.valor(pool, `reserva_zen_${destinoChave}`);
    } catch (erro) {
        console.error('[transferencia-deposito] falha ao ler a reserva configurada (usando a fixa):', erro.message);
        return destino.reservationId;
    }
}

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mesmo padrão de separacao-erp.js: se a chamada pro Zen der
// timeout/erro de rede mas a operação já tiver acontecido de
// verdade lá, confirma reconsultando antes de reportar falha.
async function chamarComVerificacao(chamada, conferirStatus, statusEsperado) {
    try {
        await chamada();
        return;
    } catch (erroChamada) {
        const statusAceitos = Array.isArray(statusEsperado) ? statusEsperado : [statusEsperado];
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0) {
                await aguardar(2000);
            }
            const statusReal = await conferirStatus().catch(() => null);
            if (statusAceitos.includes(statusReal)) {
                return;
            }
        }
        throw erroChamada;
    }
}

// Best-effort, igual picking.js: nunca trava a rota principal.
async function reavaliarPulmaoBestEffort(client) {
    try {
        await reavaliarFilaPulmao(client);
    } catch (erro) {
        console.warn('[transferencia-deposito] Falha ao reavaliar fila do Pulmão (não crítico):', erro.message);
    }
}

async function registrarMovimentacao(dados) {
    try {
        const base = [
            dados.produtoId,
            dados.tipo,
            dados.quantidade,
            dados.origemTipo ?? null,
            dados.origemId ?? null,
            dados.destinoTipo ?? null,
            dados.destinoId ?? null,
            dados.operador ?? null,
            dados.unidadeSerializadaId ?? null,
            dados.numeroSerieSnapshot ?? null,
            dados.reservaZenId ?? null,
        ];
        try {
            // serial_zen / zen_stock_id (21/10/2026): linha do Zen usada nessa movimentacao (triangulacao
            // com o serial nosso). Se as colunas ainda nao existirem no banco, grava sem elas.
            await pool.query(
                `INSERT INTO movimentacoes
                    (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot, reserva_zen_id, serial_zen, zen_stock_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [...base, dados.serialZen ?? null, dados.zenStockId ?? null]
            );
        } catch (erroColunas) {
            if (erroColunas?.code !== '42703') throw erroColunas;
            await pool.query(
                `INSERT INTO movimentacoes
                    (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot, reserva_zen_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                base
            );
        }
    } catch (erro) {
        console.error('Falha ao registrar movimentacao (nao critico):', erro);
    }
}


// TROCA DE DEPÓSITO (09/10/2026, a pedido do Dhiefferton: "precisa ser liberado
// o serial para ser transferido entre depósito - hoje o sistema bloqueia se o
// serial já foi transferido pra algum depósito"). Um serial que já saiu por
// esta tela (status 'removido', última movimentação = transferencia_deposito
// pra um dos depósitos do mapa DESTINOS) pode ser bipado de novo pra OUTRO
// depósito. No Zen isso é: desfazer a alocação na reserva do depósito antigo
// (reservationOpAllocateStockRevert, mesma operação que a tela de reserva do
// Zen usa) e alocar na reserva do novo depósito. Se qualquer passo do Zen não
// confirmar, NADA muda no WMS (a unidade já está 'removido' aqui) e, se o
// desfazer deu certo mas o novo alocar falhou, tenta devolver pra reserva
// antiga. Desligar sem deploy: flag 'transferencia_entre_depositos' (Controle
// de acesso > Funções) ou TRANSFERENCIA_ENTRE_DEPOSITOS_DESLIGADO=1 na Vercel -
// desligado, volta o bloqueio de antes.
function rotuloDestinoPorTipo(destinoTipo) {
    const d = Object.values(DESTINOS).find((x) => x.destinoTipo === destinoTipo);
    return d ? d.label : destinoTipo;
}

// Devolve { erro: { status, mensagem } } se não pode trocar, ou { origem } se pode.
async function validarTrocaDeDeposito(unidadeLocal, destino, req) {
    const bloqueioPadrao = {
        erro: {
            status: 400,
            mensagem: `Serial ${unidadeLocal.numero_serie} já está com status "${unidadeLocal.status}", não pode ser transferido de novo`,
        },
    };
    const desligado =
        process.env.TRANSFERENCIA_ENTRE_DEPOSITOS_DESLIGADO === '1' ||
        !(await flagAtiva(pool, 'transferencia_entre_depositos', { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo }));
    if (desligado) return bloqueioPadrao;

    const destinosValidos = Object.values(DESTINOS).map((d) => d.destinoTipo);
    const { rows } = await pool.query(
        `SELECT tipo, destino_tipo, reserva_zen_id FROM movimentacoes
         WHERE unidade_serializada_id = $1
         ORDER BY criado_em DESC LIMIT 1`,
        [unidadeLocal.id]
    );
    const ultima = rows[0];
    if (!ultima || ultima.tipo !== 'transferencia_deposito' || !destinosValidos.includes(ultima.destino_tipo)) {
        return {
            erro: {
                status: 400,
                mensagem: `Serial ${unidadeLocal.numero_serie} já está com status "${unidadeLocal.status}" e não saiu por Transferência de Depósito (última movimentação: ${ultima?.tipo || 'nenhuma'}) - não dá pra transferir por aqui`,
            },
        };
    }
    if (ultima.destino_tipo === destino.destinoTipo) {
        return { erro: { status: 409, mensagem: `Serial ${unidadeLocal.numero_serie} já está no depósito ${destino.label}` } };
    }
    if (!ultima.reserva_zen_id) {
        return {
            erro: {
                status: 409,
                mensagem: `Não sei em qual reserva do Zen o serial ${unidadeLocal.numero_serie} está (movimentação antiga sem o número da reserva) - desfaça a alocação manualmente no Zen e fale com um admin`,
            },
        };
    }
    return {
        origem: {
            destinoTipo: ultima.destino_tipo,
            label: rotuloDestinoPorTipo(ultima.destino_tipo),
            reservaZenId: Number(ultima.reserva_zen_id),
        },
    };
}

// Move uma unidade da reserva antiga pra do novo depósito no Zen. A unidade do
// WMS NÃO tem linha própria no Zen (o /bipar normal aloca "qualquer linha livre
// do produto na MAQ" - ver abaixo), então aqui também é por produto: pega uma
// linha do mesmo SKU que esteja na reserva antiga, desfaz a alocação (1 un.) e
// aloca uma linha livre da MAQ na reserva nova. Reserva antiga == nova (ex.: o
// Almoxarifado usava a 22919, a mesma do Mercado Livre até 08/10/2026): no Zen a
// unidade já está onde deve, não mexe em nada. Lança Error com
// .statusHttp/.mensagemUsuario quando não deu pra fazer (nada mudou no WMS).
async function trocarReservaNoZen(skuProduto, reservaAntiga, reservaNova) {
    const falha = (statusHttp, mensagemUsuario) => Object.assign(new Error(mensagemUsuario), { statusHttp, mensagemUsuario });
    if (Number(reservaAntiga) === Number(reservaNova)) return { mexeuNoZen: false };

    const consulta = async (q) => (await zenErpGet('/material/stock', { q, max: 1 })).data?.[0] || null;

    const linhaAntiga = await consulta(`reservation.id==${reservaAntiga};productPacking.product.code=='${skuProduto}'`);
    if (!linhaAntiga) {
        throw falha(409, `Não achei no ZenERP nenhuma unidade do produto ${skuProduto} na reserva ${reservaAntiga} - confira se ela ainda está alocada lá antes de transferir`);
    }

    // 1. desfaz a alocação (1 unidade) na reserva antiga
    await chamarComVerificacao(
        () => zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaAntiga}?stockId=${linhaAntiga.id}&quantity=1`, {}),
        () => zenErpGet('/material/stock', { q: `id==${linhaAntiga.id}`, max: 1 }).then((r) => (r.data?.[0]?.reservation?.id ?? 0)),
        0
    ).catch((erro) => {
        throw falha(502, `Não consegui desfazer a alocação do produto ${skuProduto} na reserva ${reservaAntiga} do Zen (nada foi alterado no WMS): ${erro?.response?.data?.message || erro.message}`);
    });

    // 2. pega uma linha livre da MAQ (a que acabou de ser liberada ou outra) e
    //    aloca na reserva do novo depósito
    const devolverParaAntiga = async (stockId) => {
        try {
            await chamarComVerificacao(
                () => zenErpPost(`/material/reservationOpAllocateStock/${reservaAntiga}?stockId=${stockId}&quantity=1`, {}),
                () => zenErpGet('/material/stock', { q: `id==${stockId}`, max: 1 }).then((r) => r.data?.[0]?.reservation?.id ?? null),
                Number(reservaAntiga)
            );
            return true;
        } catch (_) {
            return false;
        }
    };
    const livre = await consulta(`reservation.id==0;address.code=='MAQ';type==REGULAR;productPacking.product.code=='${skuProduto}'`);
    if (!livre) {
        const voltou = await devolverParaAntiga(linhaAntiga.id);
        throw falha(
            409,
            voltou
                ? `Sem linha livre na MAQ pro produto ${skuProduto}; a unidade foi devolvida pra reserva ${reservaAntiga}. Nada mudou.`
                : `Desfiz a alocação na reserva ${reservaAntiga} mas não achei linha livre na MAQ pro produto ${skuProduto} - avise um admin pra conferir no Zen.`
        );
    }
    try {
        await chamarComVerificacao(
            () => zenErpPost(`/material/reservationOpAllocateStock/${reservaNova}?stockId=${livre.id}&quantity=1`, {}),
            () => zenErpGet('/material/stock', { q: `id==${livre.id}`, max: 1 }).then((r) => r.data?.[0]?.reservation?.id ?? null),
            Number(reservaNova)
        );
    } catch (erro) {
        const voltou = await devolverParaAntiga(livre.id);
        throw falha(
            502,
            voltou
                ? `Não consegui alocar o produto ${skuProduto} na reserva ${reservaNova}; ele foi devolvido pra reserva ${reservaAntiga}. Nada mudou.`
                : `Desfiz a alocação na reserva ${reservaAntiga}, mas NÃO consegui alocar na ${reservaNova} nem devolver - avise um admin pra alocar manualmente no Zen o produto ${skuProduto}.`
        );
    }
    return { mexeuNoZen: true };
}

// REVERTER A ALOCAÇÃO NO ZEN (14/10/2026, a pedido do Dhiefferton: "faltou a parte
// que o sistema reverte a alocação total do estoque"). É o ÚLTIMO passo do processo
// manual gravado em vídeo: depois de "Alterar estoque", na reserva do depósito ele
// roda "Reverter alocação de todos os estoques da reserva" - a linha fica no endereço
// novo, sem reserva, e a reserva (que é só um "ponto de passagem") volta a ficar vazia.
//
// COMO O ZEN FAZ (lido do script da própria tela de Reservas):
//     POST /material/reservationOpAllocateAutoRevert/{reservaId}        (sem corpo)
//         = "Reverter alocação de todos os estoques da reserva" (ação da reserva INTEIRA)
//     POST /material/reservationOpAllocateStockRevert/{reservaId}?stockId=&quantity=1
//         = reverte UMA linha (o mesmo que o resto deste arquivo já usa)
//
// POR QUE NÃO REVERTER "TUDO" SEMPRE: a reserva é compartilhada. Se dois colaboradores
// transferem ao mesmo tempo, o "reverter tudo" do primeiro soltaria a linha do segundo
// ANTES dela ser movida de endereço (e o mover do segundo falharia). Por isso, no modo 2
// (padrão, igual ao processo manual) só usa o "reverter tudo" se TODAS as linhas da
// reserva já estão no endereço do depósito; se sobrar alguma ainda esperando (outro
// colaborador no meio do processo), reverte só as linhas que já foram movidas, uma a uma.
// Modo 1 (Configurações): sempre uma a uma, só a linha que acabou de ser movida.
//
// SEGURANÇA: só roda com o endereço JÁ movido no Zen; nunca derruba a bipagem; nunca mexe
// em linha que esteja fora do endereço do depósito. Confere no Zen se as linhas soltaram.
// Kill switch: TRANSFERENCIA_REVERTER_ALOCACAO_ZEN_DESLIGADO=1 na Vercel, ou a função
// 'transferencia_reverter_alocacao_zen' no painel.
// Devolve { status: 'revertida' | 'nada' | 'desligado' | 'erro', mensagem? }.
async function reverterAlocacaoNoZen({ reservaId, enderecoId, stockId, sku, req }) {
    try {
        if (process.env.TRANSFERENCIA_REVERTER_ALOCACAO_ZEN_DESLIGADO === '1') return { status: 'desligado' };
        const ligado = await flagAtiva(pool, 'transferencia_reverter_alocacao_zen', {
            colaboradorId: req?.usuario?.id,
            cargo: req?.usuario?.cargo,
        });
        if (!ligado) return { status: 'desligado' };
        if (!reservaId || !enderecoId) return { status: 'nada' };

        const consultar = async (q, max = 500) => {
            const r = await zenErpGet('/material/stock', { q, max });
            return Array.isArray(r.data) ? r.data : r.data?.data || [];
        };
        const modo = Number(await configuracoes.valor(pool, 'reverter_alocacao_zen_modo')) === 1 ? 1 : 2;

        const naReserva = await consultar(`reservation.id==${reservaId}`);
        const jaMovidas = naReserva.filter((l) => Number(l.address?.id) === enderecoId);
        // alvo: a linha que acabou de ser movida; sem id (nova tentativa), as do mesmo SKU já movidas
        const alvo = jaMovidas.filter((l) => (stockId ? Number(l.id) === Number(stockId) : !sku || l.productPacking?.product?.code === sku));
        if (alvo.length === 0) return { status: 'nada' };

        const tudoMovido = jaMovidas.length === naReserva.length;
        const revertTotal = modo === 2 && tudoMovido;
        let erroChamada = null;
        if (revertTotal) {
            try {
                await zenErpPost(`/material/reservationOpAllocateAutoRevert/${reservaId}`, {});
            } catch (erro) {
                erroChamada = erro;
            }
        } else {
            // uma a uma: no modo 2 com linha de outro colaborador esperando, reverte todas as já movidas
            const lista = modo === 2 ? jaMovidas : alvo;
            for (const l of lista) {
                try {
                    await zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaId}?stockId=${l.id}&quantity=${Number(l.quantity ?? 1) || 1}`, {});
                } catch (erro) {
                    erroChamada = erroChamada || erro;
                }
            }
        }

        // nunca confia só no HTTP: confere se as linhas soltaram da reserva
        const idsAlvo = new Set((revertTotal ? naReserva : modo === 2 ? jaMovidas : alvo).map((l) => Number(l.id)));
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            const depois = await consultar(`reservation.id==${reservaId}`).catch(() => null);
            if (depois && !depois.some((l) => idsAlvo.has(Number(l.id)))) {
                console.log(`[transferencia-deposito] alocação revertida no Zen: reserva ${reservaId} (${revertTotal ? 'reserva inteira' : `${idsAlvo.size} linha(s)`})`);
                return { status: 'revertida' };
            }
        }

        const detalhe = erroChamada?.response?.data ? JSON.stringify(erroChamada.response.data) : erroChamada?.message;
        console.warn(`[transferencia-deposito] alocação NÃO revertida no Zen (reserva ${reservaId}): ${detalhe || 'sem erro, mas continua alocado'}`);
        return {
            status: 'erro',
            mensagem: `Endereço movido no ZenERP, mas NÃO consegui reverter a alocação na reserva${erroChamada?.response?.status ? ` (HTTP ${erroChamada.response.status})` : ''}. Reverta manualmente (Reverter alocação) ou toque em "Tentar mover no Zen de novo".`,
        };
    } catch (erro) {
        console.error('[transferencia-deposito] falha ao reverter alocação no Zen (não crítico):', erro?.response?.data || erro.message);
        return {
            status: 'erro',
            mensagem: 'Endereço movido no ZenERP, mas não consegui falar com o Zen pra reverter a alocação. Reverta manualmente (Reverter alocação) ou tente de novo.',
        };
    }
}

// MOVER O ENDEREÇO NO ZEN (14/10/2026, a pedido do Dhiefferton: "o processo que
// deve fazer sempre que transferir um item de depósito" - gravou a tela do Zen
// e a Assistência foi o primeiro caso). Até aqui o WMS só ALOCAVA uma linha de
// estoque da MAQ na reserva do depósito; a linha continuava no endereço MAQ e
// alguém tinha que abrir Reservas > Estoques > Alterar estoque e trocar o
// endereço na mão. Agora, depois de alocar, o WMS faz essa mesma ação.
//
// COMO O ZEN FAZ (lido do script da própria tela "Alterar estoque",
// /material/stockOpUpdate.js, e conferido num teste real de 14/10/2026 com o
// estoque 1473415 -> endereço ASSISTENCIA):
//     POST /material/stockOpUpdate/{idDaLinhaDeEstoque}
//     body: { addressId, qualityId, lotId, serialId, expirationDate,
//             handlingUnitId, tags, quantity }   (tudo igual ao da linha, só
//             o addressId muda - é o que a tela do Zen manda)
// ATENÇÃO: a linha NOVA ganha OUTRO id (1473415 -> 1473416) e continua na mesma
// reserva - por isso a conferência depois é pelo serial do Zen da própria linha,
// nunca pelo id antigo.
//
// QUAL LINHA MOVER: a mesma que acabou de ser alocada na reserva (linhaDisponivel
// em /bipar). Como o resto deste arquivo, as linhas do Zen são tratadas POR
// PRODUTO (a linha alocada não é a do serial bipado no WMS, é "qualquer linha livre
// do SKU na MAQ"). Na nova tentativa (rota /mover-endereco-zen) não há id da linha:
// pega uma linha do mesmo SKU que esteja na reserva do depósito e ainda NÃO esteja
// no endereço do depósito - equivalente, pelo mesmo motivo.
//
// O endereço de cada depósito é o ID numérico do endereço no Zen, configurável em
// Configurações ('endereco_zen_<depósito>'); 0 = não move esse depósito. Só a
// Assistência vem preenchida (4086 = ASSISTENCIA, TEK_SP).
//
// SEGURANÇA: roda DEPOIS de tudo já estar gravado no WMS e NUNCA derruba a
// bipagem - se o Zen recusar, a bipagem continua valendo (a unidade já está
// alocada na reserva certa) e a resposta traz `avisoZen` pra o colaborador mover
// na mão ou tentar de novo (POST /mover-endereco-zen). Só mexe numa linha que
// esteja na reserva esperada do depósito. Idempotente: se o endereço já é o
// certo, não faz nada. Kill switch: TRANSFERENCIA_ALTERAR_ENDERECO_ZEN_DESLIGADO=1
// na Vercel, ou a função 'transferencia_alterar_endereco_zen' no painel.
// NÃO usado na troca de depósito (serial já 'removido' pra outro depósito): lá o
// fluxo desfaz uma alocação antiga e escolhe outra linha da MAQ, e para onde a
// linha liberada do depósito antigo deve voltar ainda não foi decidido.
// Devolve { status: 'movido' | 'ja_estava' | 'desligado' | 'sem_endereco' | 'erro', mensagem? }.
async function moverEnderecoNoZen({ stockId, sku, destinoChave, reservaEsperada, req, semReverter = false }) {
    // semReverter (transferência por pallet em lote, 19/10/2026): move a linha e deixa a reversão pra quem chamou,
    // que reverte todas as linhas do lote de uma vez.
    const reverterAgora = semReverter ? async () => ({ status: 'adiado' }) : reverterAlocacaoNoZen;
    try {
        if (process.env.TRANSFERENCIA_ALTERAR_ENDERECO_ZEN_DESLIGADO === '1') return { status: 'desligado' };
        const ligado = await flagAtiva(pool, 'transferencia_alterar_endereco_zen', {
            colaboradorId: req?.usuario?.id,
            cargo: req?.usuario?.cargo,
        });
        if (!ligado) return { status: 'desligado' };

        const enderecoId = Number(await configuracoes.valor(pool, `endereco_zen_${destinoChave}`));
        if (!enderecoId) return { status: 'sem_endereco' };

        const consultar = async (q, max = 1) => {
            const r = await zenErpGet('/material/stock', { q, max });
            return Array.isArray(r.data) ? r.data : r.data?.data || [];
        };

        // 1. acha a linha a mover
        // Ao alocar 1 unidade de uma linha com mais de uma, o Zen DIVIDE a linha: a unidade alocada ganha
        // OUTRO id (na reserva) e o id antigo continua existindo, livre, com o resto (corrigido 15/10/2026 -
        // erro "a linha X está sem reserva" no #102204/SKU 99488). Por isso o id só vale se a linha achada
        // por ele estiver mesmo na reserva esperada; senão procura na reserva, por SKU.
        let linha = null;
        let linhaAntiga = null;
        if (stockId) {
            linha = (await consultar(`id==${stockId}`))[0] || null;
            if (linha && reservaEsperada && sku && Number(linha.reservation?.id) !== Number(reservaEsperada)) {
                console.log(`[transferencia-deposito] linha ${linha.id} não está na reserva ${reservaEsperada} (id mudou ao alocar) - procurando por SKU na reserva`);
                linhaAntiga = linha;
                linha = null;
            }
        }
        if (!linha && sku && reservaEsperada) {
            const naReserva = await consultar(`reservation.id==${reservaEsperada};productPacking.product.code=='${sku}'`, 200);
            if (naReserva.length === 0) {
                return { status: 'erro', mensagem: `Não achei no ZenERP nenhuma unidade do produto ${sku} na reserva ${reservaEsperada} - confira no Zen.` };
            }
            // a que ainda não está no endereço do depósito; entre elas, a que tem mais cara da linha antiga
            // (lote/qualidade/endereço) e, no empate, a de id mais novo (a recém-alocada)
            const pontos = (l) => (linhaAntiga
                ? (Number(l.lot?.id ?? 0) === Number(linhaAntiga.lot?.id ?? 0) ? 1 : 0)
                    + (Number(l.quality?.id ?? 0) === Number(linhaAntiga.quality?.id ?? 0) ? 1 : 0)
                    + (Number(l.address?.id ?? 0) === Number(linhaAntiga.address?.id ?? 0) ? 1 : 0)
                : 0);
            linha = naReserva
                .filter((l) => Number(l.address?.id) !== enderecoId)
                .sort((a, b) => pontos(b) - pontos(a) || Number(b.id) - Number(a.id))[0] || null;
            if (!linha) {
                // todas já no endereço do depósito: só falta (se falhou antes) reverter a alocação
                const reversao = await reverterAgora({ reservaId: reservaEsperada, enderecoId, sku, req });
                return { status: 'ja_estava', reversao };
            }
        }
        if (!linha) {
            return { status: 'erro', mensagem: 'Não achei a linha de estoque no ZenERP - mova o endereço manualmente (Alterar estoque).' };
        }
        if (Number(linha.address?.id) === enderecoId) {
            // endereço já certo (ex.: nova tentativa depois de falhar só a reversão): segue pro último passo
            const reversao = await reverterAgora({ reservaId: reservaEsperada, enderecoId, stockId: linha.id, sku, req });
            return { status: 'ja_estava', stockId: linha.id, reversao };
        }

        if (reservaEsperada && Number(linha.reservation?.id) !== Number(reservaEsperada)) {
            return {
                status: 'erro',
                mensagem: `No ZenERP a linha ${linha.id} está ${linha.reservation?.id ? `na reserva ${linha.reservation.id}` : 'sem reserva'} (esperado: ${reservaEsperada}) - não movi o endereço. Confira no Zen.`,
            };
        }

        // 2. mesmo corpo que a tela do Zen manda: tudo igual ao da linha, só o endereço muda
        // (JSON.stringify descarta o que for undefined, como a tela faz).
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
        // Linha sem serial no Zen: o id muda ao mover e não dá pra reconferir pelo serial - nesse caso a
        // linha nova é a do SKU, na reserva, no endereço do depósito, que não estava lá antes (corrigido
        // 14/10/2026, junto com o Estoque Devolução, que bateu nesse caso).
        const doSkuNaReserva = async () => {
            if (!reservaEsperada || !sku) return [];
            return (await consultar(`reservation.id==${reservaEsperada};productPacking.product.code=='${sku}'`, 200).catch(() => []))
                .filter((l) => Number(l.address?.id) === enderecoId);
        };
        // O Zen usa "-" (ou vazio) como "sem serial" em MUITAS linhas: isso nunca serve pra achar a linha
        // (corrigido 15/10/2026 - o Estoque Devolução concluiu "não movi" com a linha já movida).
        const codigoSerial = String(linha.serial?.code ?? '').trim();
        const serialDoZen = codigoSerial && codigoSerial !== '-' ? codigoSerial : null;
        const idsNoDestinoAntes = new Set((await doSkuNaReserva()).map((l) => Number(l.id)));
        let erroChamada = null;
        let respostaMover = null;
        try {
            respostaMover = await zenErpPost(`/material/stockOpUpdate/${linha.id}`, corpo);
        } catch (erro) {
            erroChamada = erro;
        }
        // o Zen responde com a linha NOVA (id novo): pista mais direta de onde ela foi parar
        const idNovo = respostaMover?.data?.id ?? null;

        // 3. nunca confia só no HTTP: reconsulta (o id da linha muda ao mover, então pelo serial do Zen)
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0 || erroChamada) await aguardar(1500);
            const certa = (l) => l && Number(l.address?.id) === enderecoId;
            let depois = null;
            if (idNovo) depois = (await consultar(`id==${idNovo}`).catch(() => []))[0] || null;
            if (!certa(depois) && serialDoZen) depois = (await consultar(`serial.code=='${serialDoZen}'`).catch(() => []))[0] || null;
            if (!certa(depois)) {
                depois = (await doSkuNaReserva()).filter((l) => !idsNoDestinoAntes.has(Number(l.id))).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
            }
            if (certa(depois)) {
                console.log(`[transferencia-deposito] endereço no Zen: linha ${linha.id} -> ${depois.id} (endereço ${enderecoId}, reserva ${depois.reservation?.id ?? '-'})`);
                // último passo do processo manual: reverter a alocação na reserva
                const reversao = await reverterAgora({ reservaId: reservaEsperada, enderecoId, stockId: depois.id, sku, req });
                return { status: 'movido', stockId: depois.id, reversao };
            }
        }

        const detalhe = erroChamada?.response?.data ? JSON.stringify(erroChamada.response.data) : erroChamada?.message;
        console.warn(`[transferencia-deposito] endereço no Zen NÃO movido (linha ${linha.id}): ${detalhe || 'sem erro, mas o endereço não mudou'} | resposta do Zen: ${JSON.stringify(respostaMover?.data ?? null)?.slice(0, 300)}`);
        return {
            status: 'erro',
            mensagem: `Alocado na reserva, mas NÃO consegui mover o endereço no ZenERP${erroChamada?.response?.status ? ` (HTTP ${erroChamada.response.status})` : ''}. Mova manualmente (Alterar estoque) ou toque em "Tentar mover no Zen de novo".`,
        };
    } catch (erro) {
        console.error('[transferencia-deposito] falha ao mover o endereço no Zen (não crítico):', erro?.response?.data || erro.message);
        return {
            status: 'erro',
            mensagem: 'Alocado na reserva, mas não consegui falar com o ZenERP pra mover o endereço. Mova manualmente (Alterar estoque) ou tente de novo.',
        };
    }
}

function avisoDoZen(resultado) {
    if (resultado.status === 'erro') return { avisoZen: resultado.mensagem };
    if (resultado.reversao?.status === 'erro') return { avisoZen: resultado.reversao.mensagem };
    return {};
}


// ============================================================
// TRANSFERIR PARA VERDE / AMARELO / VERMELHO / AVARIAS (15/10/2026, a pedido do Dhiefferton:
// "transferir para os depósitos verde, amarelo, vermelho, avarias vão seguir as mesmas regras da
// tela do Estoque Devolução - mas aqui o sistema precisa ver a primeira transferência que foi
// feita do serial para buscar a linha certa no depósito certo para depois fazer a alteração").
//
// Decisões confirmadas com ele (AskUserQuestion):
//   1. Depois de transferir, a unidade VOLTA pro picking do WMS com a marca do depósito
//      (unidades_serializadas.deposito_zen) - igual ao Estoque Devolução; nas próximas bipagens
//      (Separação/Transferência) o saldo vem do endereço desse depósito no Zen (lib/deposito-zen.js).
//   2. SÓ vale pra serial que já saiu por Transferência de Depósito (status 'removido', última
//      movimentação = transferencia_deposito). Serial em estoque no WMS que nunca saiu: bloqueia.
//
// COMO ACHA A LINHA NO ZEN: a última transferência do serial (movimentacoes) diz o depósito e a
// reserva do Zen por onde ele saiu:
//   a) a linha ainda está alocada na reserva dessa transferência (Mercado Livre, Showroom,
//      Almoxarifado, Engenharia - depósitos sem endereço configurado - ou uma transferência cujo
//      "mover/reverter" falhou): move o endereço DESSA linha pro endereço do depósito novo e reverte
//      a alocação na MESMA reserva;
//   b) senão, o depósito antigo tem endereço configurado (ex.: Assistência = ASSISTENCIA) e a linha
//      está livre lá: aloca 1 unidade dela na reserva de passagem 22919 (a mesma do Estoque Devolução),
//      move pro endereço novo e reverte.
//   Como em todo o resto do sistema, a linha do Zen é tratada POR PRODUTO (a linha do SKU naquele
//   depósito), não por serial: o serial nosso não existe no Zen.
//
// SEGURANÇA: valida tudo (unidade, última transferência, endereço do depósito, posição de picking)
// ANTES de mexer no Zen; se não achar a linha no Zen, nada muda. Mover/reverter roda DEPOIS do
// COMMIT no WMS e nunca derruba a bipagem (aviso `avisoZen`, mova na mão). Não existe nova tentativa
// automática (a unidade já está de volta no picking). Kill switch:
// TRANSFERENCIA_DEPOSITOS_PROPRIOS_DESLIGADO=1 na Vercel, ou a função
// 'transferencia_depositos_proprios' no painel. Os 5 destinos antigos não mudam.
// ============================================================
const DEPOSITOS_PROPRIOS = {
    verde: { deposito: 'Verde', label: 'Verde', destinoTipo: 'reserva_zen_devolucao_verde' },
    amarelo: { deposito: 'Amarelo', label: 'Amarelo', destinoTipo: 'reserva_zen_devolucao_amarelo' },
    vermelho: { deposito: 'Vermelho', label: 'Vermelho', destinoTipo: 'reserva_zen_devolucao_vermelho' },
    avarias: { deposito: 'Avarias', label: 'Avarias', destinoTipo: 'reserva_zen_devolucao_avarias' },
};
// Reserva de passagem quando a linha está livre num endereço (mesma do Estoque Devolução).
const RESERVA_PASSAGEM_DEPOSITOS_PROPRIOS = 22919;

async function transferirParaDepositoProprio(req, res, destinoChave) {
    const dest = DEPOSITOS_PROPRIOS[destinoChave];
    const serialDigitado = String(req.body?.serial || '').trim();
    const matchQrFabrica = serialDigitado.match(/P\d+(?:L\d+)?S(\d+)/i);
    const serialExtraido = matchQrFabrica ? `#${matchQrFabrica[1]}` : null;
    const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
    const tentativasDeSerial = serialExtraido && serialExtraido !== serialBruto ? [serialExtraido, serialBruto] : [serialBruto];

    try {
        if (
            process.env.TRANSFERENCIA_DEPOSITOS_PROPRIOS_DESLIGADO === '1' ||
            !(await flagAtiva(pool, 'transferencia_depositos_proprios', { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo }))
        ) {
            return res.status(409).json({ erro: `Transferir pro depósito ${dest.label} está desligado (função ou variável de emergência).` });
        }
        if (!(await garantirColunaDeposito(pool))) {
            return res.status(409).json({ erro: 'Não consegui preparar o campo de depósito no WMS - nada foi alterado. Fale com um admin.' });
        }
        const enderecoDestinoId = Number(await configuracoes.valor(pool, `endereco_zen_devolucao_${dest.deposito.toLowerCase()}`));
        if (!enderecoDestinoId) {
            return res.status(409).json({ erro: `O endereço do ${dest.label} no ZenERP não está configurado (Configurações > Endereço do ZenERP por depósito) - nada foi alterado.` });
        }

        // 1. A unidade (só serial com etiqueta do WMS) e a última transferência dela
        const { rows: unidadeRows } = await pool.query(
            `SELECT us.id, us.status, us.numero_serie, us.produto_id, pr.sku AS produto_sku
             FROM unidades_serializadas us
             JOIN produtos pr ON pr.id = us.produto_id
             WHERE us.numero_serie = ANY($1)
             LIMIT 1`,
            [tentativasDeSerial]
        );
        const unidade = unidadeRows[0];
        if (!unidade) {
            return res.status(404).json({ erro: `Serial não encontrado no WMS (bipado "${serialDigitado}") - pra ${dest.label} só vale serial com etiqueta do WMS que já saiu por Transferência de Depósito` });
        }
        if (unidade.status === 'em_estoque') {
            return res.status(409).json({
                erro: `Serial ${unidade.numero_serie} está em estoque no WMS e nunca saiu por Transferência de Depósito - pra ${dest.label} por essa tela o serial precisa já ter sido transferido antes pra outro depósito`,
            });
        }
        if (unidade.status !== 'removido') {
            return res.status(400).json({ erro: `Serial ${unidade.numero_serie} está com status "${unidade.status}", não pode ser transferido` });
        }
        const { rows: movRows } = await pool.query(
            `SELECT tipo, destino_tipo, reserva_zen_id FROM movimentacoes
             WHERE unidade_serializada_id = $1
             ORDER BY criado_em DESC LIMIT 1`,
            [unidade.id]
        );
        const ultima = movRows[0];
        const anterior = ultima && ultima.tipo === 'transferencia_deposito'
            ? Object.entries(DESTINOS).find(([, d]) => d.destinoTipo === ultima.destino_tipo)
            : null;
        if (!anterior) {
            return res.status(409).json({
                erro: `Serial ${unidade.numero_serie} não saiu por Transferência de Depósito (última movimentação: ${ultima?.tipo || 'nenhuma'}) - não dá pra transferir pra ${dest.label} por essa tela`,
            });
        }
        const [anteriorChave, anteriorDestino] = anterior;
        if (!ultima.reserva_zen_id) {
            return res.status(409).json({
                erro: `Não sei em qual reserva do Zen o serial ${unidade.numero_serie} está (movimentação antiga sem o número da reserva) - fale com um admin`,
            });
        }
        const reservaAnterior = Number(ultima.reserva_zen_id);
        const sku = unidade.produto_sku;

        // 2. A posição de picking que vai receber a unidade (só confere; o lock é na transação)
        const posicao = await pool.query(
            `SELECT e.id, e.codigo FROM enderecos e
             WHERE e.andar = 1 AND e.reservado_estoque_devolucao = false
               AND (
                   e.produto_reservado_id = $1
                   OR (e.multi_sku = true AND EXISTS (
                       SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1
                   ))
               )
             ORDER BY (EXISTS (SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1)) DESC, e.codigo
             LIMIT 1`,
            [unidade.produto_id]
        );
        if (posicao.rowCount === 0) {
            return res.status(409).json({ erro: `O produto ${sku} não tem posição de picking reservada - reserve pelo Mapa de ruas antes. Nada foi alterado.` });
        }

        // 3. A linha certa no Zen (ver comentário no topo)
        const consultar = async (q, max = 200) => {
            const r = await zenErpGet('/material/stock', { q, max });
            return Array.isArray(r.data) ? r.data : r.data?.data || [];
        };
        let linha = (await consultar(`reservation.id==${reservaAnterior};productPacking.product.code=='${sku}'`)).find(
            (l) => Number(l.reservation?.id) === reservaAnterior
        ) || null;
        let reservaDaLinha = reservaAnterior;
        let precisaAlocar = false;
        if (!linha) {
            const enderecoAnteriorId = Number(await configuracoes.valor(pool, `endereco_zen_${anteriorChave}`).catch(() => 0));
            if (enderecoAnteriorId) {
                linha = (await consultar(`reservation.id==0;address.id==${enderecoAnteriorId};type==REGULAR;productPacking.product.code=='${sku}'`, 1))[0] || null;
                reservaDaLinha = RESERVA_PASSAGEM_DEPOSITOS_PROPRIOS;
                precisaAlocar = !!linha;
            }
        }
        if (!linha) {
            return res.status(409).json({
                erro: `Não achei no ZenERP nenhuma unidade do produto ${sku} na reserva ${reservaAnterior} nem no endereço do depósito ${anteriorDestino.label} - confira no Zen. Nada foi alterado.`,
            });
        }
        if (precisaAlocar) {
            try {
                await chamarComVerificacao(
                    () => zenErpPost(`/material/reservationOpAllocateStock/${reservaDaLinha}?stockId=${linha.id}&quantity=1`, {}),
                    () => zenErpGet('/material/stock', { q: `id==${linha.id}`, max: 1 }).then((r) => r.data?.[0]?.reservation?.id ?? null),
                    reservaDaLinha
                );
            } catch (erro) {
                console.error('[transferencia-deposito] alocar na reserva de passagem falhou:', erro?.response?.data || erro.message);
                return res.status(502).json({ erro: `Não consegui alocar o produto ${sku} na reserva ${reservaDaLinha} do ZenERP. Nada foi alterado.` });
            }
        }

        // 4. WMS: a unidade volta pro picking, com a marca do depósito
        let enderecoPickingId;
        let enderecoPickingCodigo;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const travada = await client.query(`SELECT status FROM unidades_serializadas WHERE id = $1 FOR UPDATE`, [unidade.id]);
            if (travada.rows[0]?.status !== 'removido') {
                throw Object.assign(new Error(`Serial ${unidade.numero_serie} mudou de status enquanto processava - tente de novo`), { status: 409 });
            }
            const enderecoPicking = await client.query(
                `SELECT e.id, e.codigo FROM enderecos e
                 WHERE e.andar = 1 AND e.reservado_estoque_devolucao = false
                   AND (
                       e.produto_reservado_id = $1
                       OR (e.multi_sku = true AND EXISTS (
                           SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1
                       ))
                   )
                 ORDER BY (EXISTS (SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1)) DESC, e.codigo
                 LIMIT 1
                 FOR UPDATE OF e`,
                [unidade.produto_id]
            );
            if (enderecoPicking.rowCount === 0) {
                throw Object.assign(new Error(`O produto ${sku} perdeu a posição de picking reservada durante a bipagem`), { status: 409 });
            }
            enderecoPickingId = enderecoPicking.rows[0].id;
            enderecoPickingCodigo = enderecoPicking.rows[0].codigo;
            const existente = await client.query(`SELECT id, produto_id FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`, [enderecoPickingId]);
            if (existente.rowCount > 0 && existente.rows[0].produto_id !== unidade.produto_id) {
                // multi-SKU: a posição guarda uma linha por produto; só soma se for o mesmo produto
                const doProduto = await client.query(
                    `SELECT id FROM unidades_picking WHERE endereco_id = $1 AND produto_id = $2 FOR UPDATE`,
                    [enderecoPickingId, unidade.produto_id]
                );
                if (doProduto.rowCount > 0) {
                    await client.query(`UPDATE unidades_picking SET quantidade = quantidade + 1, atualizado_em = now() WHERE id = $1`, [doProduto.rows[0].id]);
                } else {
                    await client.query(`INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, 1)`, [unidade.produto_id, enderecoPickingId]);
                }
            } else if (existente.rowCount > 0) {
                await client.query(`UPDATE unidades_picking SET quantidade = quantidade + 1, atualizado_em = now() WHERE id = $1`, [existente.rows[0].id]);
            } else {
                await client.query(`INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, 1)`, [unidade.produto_id, enderecoPickingId]);
                await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
            }
            await client.query(
                `UPDATE unidades_serializadas SET status = 'em_estoque', pallet_id = NULL, endereco_id = NULL, deposito_zen = $2, atualizado_em = now() WHERE id = $1`,
                [unidade.id, dest.deposito]
            );
            await client.query('COMMIT');
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            // Se já alocou na reserva de passagem e o WMS não gravou, solta de volta (melhor esforço)
            if (precisaAlocar) {
                try {
                    await zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaDaLinha}?stockId=${linha.id}&quantity=1`, {});
                } catch (_) {
                    console.error(`[transferencia-deposito] ATENÇÃO: linha ${linha.id} ficou alocada na reserva ${reservaDaLinha} e o WMS não gravou - reverter no Zen`);
                }
            }
            if (erro.status) return res.status(erro.status).json({ erro: erro.message });
            throw erro;
        } finally {
            client.release();
        }

        await registrarMovimentacao({
            produtoId: unidade.produto_id,
            tipo: 'transferencia_deposito',
            quantidade: 1,
            origemTipo: 'externo',
            destinoTipo: dest.destinoTipo,
            reservaZenId: reservaDaLinha,
            operador: req.usuario.nome,
            unidadeSerializadaId: unidade.id,
            numeroSerieSnapshot: unidade.numero_serie,
            ...identidadeZen(linha),
        });
        await registrarMovimentacao({
            produtoId: unidade.produto_id,
            tipo: 'transferencia_deposito_retorno',
            quantidade: 1,
            origemTipo: 'externo',
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
            operador: req.usuario.nome,
            unidadeSerializadaId: unidade.id,
            numeroSerieSnapshot: unidade.numero_serie,
        });

        // 5. Zen: move o endereço da linha pro depósito novo e reverte a alocação (depois do COMMIT, nunca derruba)
        const zenEndereco = await moverEReverterLinha({
            stockId: linha.id,
            modelo: linha,
            sku,
            reservaId: reservaDaLinha,
            enderecoChave: `endereco_zen_devolucao_${dest.deposito.toLowerCase()}`,
            flagMover: 'transferencia_alterar_endereco_zen',
            envMover: 'TRANSFERENCIA_ALTERAR_ENDERECO_ZEN_DESLIGADO',
            flagReverter: 'transferencia_reverter_alocacao_zen',
            envReverter: 'TRANSFERENCIA_REVERTER_ALOCACAO_ZEN_DESLIGADO',
            tag: 'transferencia-deposito',
            req,
        });

        return res.json({
            status: 'transferido',
            produto: sku,
            numeroSerie: unidade.numero_serie,
            destino: dest.label,
            deDeposito: anteriorDestino.label,
            enderecoPickingCodigo,
            voltouPraPicking: true,
            enderecoZen: zenEndereco.status,
            alocacaoZen: zenEndereco.reversao?.status,
            ...avisoDoZen(zenEndereco),
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        return res.status(502).json({ erro: 'Falha ao processar transferência', detalhe: erro?.response?.data || erro.message });
    }
}

// POST /transferencia-deposito/bipar
// Body: { serial }
router.post('/bipar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const serialDigitado = String(req.body?.serial || '').trim();
    if (!serialDigitado) {
        return res.status(400).json({ erro: 'Informe o serial bipado' });
    }

    // Depósito de destino escolhido no dropdown do coletor. Padrão
    // "mercado_livre" caso não venha (comportamento de antes desse
    // dropdown existir, pra um app do coletor desatualizado não quebrar).
    const destinoChave = String(req.body?.destino || 'mercado_livre').trim();
    // Verde/Amarelo/Vermelho/Avarias têm fluxo próprio (ver transferirParaDepositoProprio acima).
    if (DEPOSITOS_PROPRIOS[destinoChave]) return transferirParaDepositoProprio(req, res, destinoChave);
    const destino = DESTINOS[destinoChave];
    if (!destino) {
        return res.status(400).json({ erro: `Depósito de destino inválido: "${destinoChave}"` });
    }

    // Mesma extração de código de fábrica usada em separacao-erp.js
    // (bipar-serial) - ver comentário lá pro raciocínio completo,
    // incluindo a correção de 16/09/2026 (exige o formato completo
    // "P<numero>L<numero>S<numero>", não só o "S" isolado, senão um
    // serial puro tipo "BXS1087347" casa errado com o "S" do meio) e
    // a de 17/09/2026 (o campo "L" é opcional - alguns QRs de fábrica
    // vêm sem ele, ex: "ZS-P5144S359899Q1").
    const matchQrFabrica = serialDigitado.match(/P\d+(?:L\d+)?S(\d+)/i);
    const serialExtraido = matchQrFabrica ? `#${matchQrFabrica[1]}` : null;
    const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
    const tentativasDeSerial = serialExtraido && serialExtraido !== serialBruto
        ? [serialExtraido, serialBruto]
        : [serialBruto];

    try {
        // 0. Acha a unidade na nossa tabela - caso normal, já que todo
        // item desse fluxo é serializado e passou pelo recebimento do
        // WMS (tem numero_serie próprio, formato "#NNNN").
        const { rows: unidadeRows } = await pool.query(
            `SELECT us.id, us.status, us.pallet_id, us.endereco_id, us.numero_serie, us.produto_id,
                    pr.sku AS produto_sku, pv.area_atual
             FROM unidades_serializadas us
             JOIN produtos pr ON pr.id = us.produto_id
             LEFT JOIN pallets_vertical pv ON pv.id = us.pallet_id
             WHERE us.numero_serie = ANY($1)
             LIMIT 1`,
            [tentativasDeSerial]
        );
        const unidadeLocal = unidadeRows[0] || null;

        let linhaSerial = null;
        let serialCode = tentativasDeSerial[0];
        let skuProduto;
        let produtoId;

        if (unidadeLocal && unidadeLocal.status === 'removido') {
            // Troca de depósito (ver validarTrocaDeDeposito acima). Só mexe no Zen
            // e grava a movimentação - a unidade já está 'removido' aqui.
            const validacao = await validarTrocaDeDeposito(unidadeLocal, destino, req);
            if (validacao.erro) return res.status(validacao.erro.status).json({ erro: validacao.erro.mensagem });

            const reservaNova = await reservaDoDestino(destinoChave, destino);
            try {
                await trocarReservaNoZen(unidadeLocal.produto_sku, validacao.origem.reservaZenId, reservaNova);
            } catch (erro) {
                console.error('[transferencia-deposito] troca de depósito falhou:', erro?.response?.data || erro.message);
                return res.status(erro.statusHttp || 502).json({ erro: erro.mensagemUsuario || 'Falha ao trocar a reserva no ZenERP' });
            }

            await registrarMovimentacao({
                produtoId: unidadeLocal.produto_id,
                tipo: 'transferencia_deposito',
                quantidade: 1,
                origemTipo: 'externo',
                destinoTipo: destino.destinoTipo,
                reservaZenId: reservaNova,
                operador: req.usuario.nome,
                unidadeSerializadaId: unidadeLocal.id,
                numeroSerieSnapshot: unidadeLocal.numero_serie,
            });
            return res.json({
                status: 'transferido',
                produto: unidadeLocal.produto_sku,
                numeroSerie: unidadeLocal.numero_serie,
                destino: destino.label,
                deDeposito: validacao.origem.label,
            });
        }

        if (unidadeLocal) {
            if (unidadeLocal.status !== 'em_estoque') {
                return res.status(400).json({
                    erro: `Serial ${unidadeLocal.numero_serie} já está com status "${unidadeLocal.status}", não pode ser transferido de novo`,
                });
            }
            skuProduto = unidadeLocal.produto_sku;
            serialCode = unidadeLocal.numero_serie;
            produtoId = unidadeLocal.produto_id;
        } else {
            // Serial não é nosso (não está na nossa tabela) - tenta
            // achar a linha exata no ZenERP, igual separacao-erp.js faz
            // pro serial de fábrica/legado.
            for (const tentativa of tentativasDeSerial) {
                const respostaSerial = await zenErpGet('/material/stock', {
                    q: `serial.code=='${tentativa}'`,
                    max: 1,
                });
                if (respostaSerial.data?.[0]) {
                    linhaSerial = respostaSerial.data[0];
                    serialCode = tentativa;
                    break;
                }
            }
            if (!linhaSerial) {
                return res.status(404).json({
                    erro: `Serial não encontrado (bipado "${serialDigitado}", tentei buscar como ${tentativasDeSerial.join(' e ')})`,
                });
            }
            if (linhaSerial.reservation?.id) {
                return res.status(409).json({ erro: `Serial ${serialCode} já está reservado/alocado no ZenERP` });
            }
            skuProduto = linhaSerial.productPacking?.product?.code;
            const produtoResp = await pool.query(`SELECT id FROM produtos WHERE sku = $1`, [skuProduto]);
            if (produtoResp.rows.length === 0) {
                return res.status(400).json({ erro: `Produto ${skuProduto} (do serial bipado) não está cadastrado no WMS` });
            }
            produtoId = produtoResp.rows[0].id;
        }

        // 1. Escolhe a linha de estoque a alocar - mesma lógica de
        // separacao-erp.js: serial nosso pega qualquer linha livre do
        // produto na área MAQ; serial do Zen usa a linha exata já achada.
        const ehSerialNosso = !!unidadeLocal;
        let linhaDisponivel;
        if (ehSerialNosso) {
            // 15/10/2026: unidade que voltou do Estoque Devolução por Verde/Amarelo/Vermelho/Avarias puxa o
            // saldo do endereço desse depósito no Zen, não do MAQ (ver lib/deposito-zen.js).
            const origemSaldo = await origemDoSaldo(pool, unidadeLocal.id, req);
            if (origemSaldo.bloqueio) {
                return res.status(409).json({ erro: origemSaldo.bloqueio });
            }
            const respostaEstoque = await zenErpGet('/material/stock', {
                q: `reservation.id==0;${origemSaldo.filtro};type==REGULAR;productPacking.product.code=='${skuProduto}'`,
                max: 1,
            });
            linhaDisponivel = respostaEstoque.data?.[0];
            if (!linhaDisponivel) {
                return res.status(409).json({ erro: mensagemSemSaldo(origemSaldo, skuProduto) });
            }
        } else {
            linhaDisponivel = linhaSerial;
        }

        // Número da reserva (configurável - ver reservaDoDestino acima).
        const reservationId = await reservaDoDestino(destinoChave, destino);

        // 2. Aloca 1 unidade dessa linha na reserva fixa de transferência
        // (uma por depósito, ver mapa DESTINOS acima).
        await chamarComVerificacao(
            () => zenErpPost(
                `/material/reservationOpAllocateStock/${reservationId}?stockId=${linhaDisponivel.id}&quantity=1`,
                {}
            ),
            () => zenErpGet('/material/stock', { q: `id==${linhaDisponivel.id}`, max: 1 })
                .then((r) => r.data?.[0]?.reservation?.id ?? null),
            reservationId
        );

        // 3. Já alocado de verdade no Zen - agora dá baixa aqui no WMS.
        // A unidade sai do estoque (removido), mesma representação de
        // DELETE /unidades-serializadas/:id, só que como fluxo normal.
        let origemTipo = 'externo';
        // origemId fica null pro caso 'pulmao' (mesma convencao de
        // pulmao.js: "Pulmao nao tem endereco de origem pra
        // registrar") e pro caso 'externo' (serial que nao e nosso,
        // sem endereco no WMS pra apontar).
        let origemId = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (unidadeLocal) {
                const atual = await client.query(
                    `SELECT status, pallet_id, endereco_id FROM unidades_serializadas WHERE id = $1 FOR UPDATE`,
                    [unidadeLocal.id]
                );
                if (atual.rows[0]?.status !== 'em_estoque') {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        erro: `Serial ${unidadeLocal.numero_serie} mudou de status enquanto processava (já foi alocado no Zen - avise um admin pra conferir manualmente essa unidade).`,
                    });
                }

                await client.query(
                    `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now() WHERE id = $1`,
                    [unidadeLocal.id]
                );

                if (unidadeLocal.pallet_id) {
                    origemTipo = unidadeLocal.area_atual === 'pulmao' ? 'pulmao' : 'vertical';
                    // So registra o endereco fisico pro caso 'vertical' -
                    // 'pulmao' fica sem endereco de origem de proposito
                    // (ver comentario acima e pulmao.js).
                    if (origemTipo === 'vertical') {
                        origemId = unidadeLocal.endereco_id ?? null;
                    }
                    const pallet = await client.query(
                        `SELECT id, quantidade, endereco_id, area_atual FROM pallets_vertical WHERE id = $1 FOR UPDATE`,
                        [unidadeLocal.pallet_id]
                    );
                    if (pallet.rows[0]) {
                        const restante = Number(pallet.rows[0].quantidade) - 1;
                        if (restante > 0) {
                            await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [pallet.rows[0].id, restante]);
                            // CORRECAO 24/09/2026 (mesmo raciocinio de
                            // picking.js /repor): uma transferência avulsa
                            // repetida pode ir corroendo um pallet até
                            // sobrar menos do que uma tarefa automática/
                            // Pulmão pendente pra ele precisa - sem isso
                            // aquela tarefa ficava pendurada na fila pra
                            // sempre (ver lib/reposicao.js).
                            await cancelarTarefasSemEstoqueSuficiente(client, pallet.rows[0].id, restante);
                        } else {
                            // Mesmo cuidado de picking.js (/repor): cancela
                            // tarefa pendente que aponte pra esse pallet
                            // antes de apagar, senão o DELETE falha por FK.
                            await cancelarTarefasSemEstoqueSuficiente(client, pallet.rows[0].id, 0);
                            // Guarda o etiqueta_codigo (e o resto) desse
                            // pallet num arquivo histórico ANTES de apagar -
                            // sem isso, o código da etiqueta impressa fica
                            // impossível de achar de novo (ver relatório
                            // "Seriais por pallet" em lib/relatorios/catalogo.js).
                            await client.query(
                                `INSERT INTO pallets_vertical_historico
                                    (id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual, criado_em)
                                 SELECT id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual, criado_em
                                 FROM pallets_vertical WHERE id = $1
                                 ON CONFLICT (id) DO NOTHING`,
                                [pallet.rows[0].id]
                            );
                            await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [pallet.rows[0].id]);
                            if (pallet.rows[0].area_atual === 'vertical' && pallet.rows[0].endereco_id) {
                                await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [pallet.rows[0].endereco_id]);
                                await reavaliarPulmaoBestEffort(client);
                            }
                        }
                    }
                } else {
                    origemTipo = 'picking';
                    origemId = unidadeLocal.endereco_id ?? null;
                }
            }

            await client.query('COMMIT');
        } catch (erro) {
            await client.query('ROLLBACK');
            throw erro;
        } finally {
            client.release();
        }

        await registrarMovimentacao({
            produtoId,
            tipo: 'transferencia_deposito',
            quantidade: 1,
            origemTipo,
            origemId,
            // Destino sempre e uma reserva fixa do Zen (nunca um
            // endereco/pedido nosso) - usa um tipo proprio por depósito
            // ('reserva_zen', 'reserva_zen_showroom',
            // 'reserva_zen_assistencia_tecnica' - ver DESTINOS acima) em
            // vez de reaproveitar o 'externo' generico (usado em remocao
            // manual em enderecos.js e unidades-serializadas.js), pra a
            // tela de Historico poder mostrar pra qual depósito foi (em
            // vez de um "Externo" mudo) mesmo os três caindo na mesma
            // reserva do Zen hoje.
            // destino_id NAO leva o id da reserva: essa coluna e uuid
            // (referencia enderecos/pedidos/etc do proprio WMS), e o id
            // da reserva e um inteiro do ZenERP - tipos incompativeis. O
            // numero da reserva usada de fato nesta bipagem vai em
            // reserva_zen_id (CORREÇÃO 28/09/2026) - é o que a tela de
            // Histórico usa hoje pra montar o rótulo, em vez de um
            // número fixo no frontend (que ficaria errado assim que um
            // depósito trocasse de reserva, como aconteceu agora).
            destinoTipo: destino.destinoTipo,
            reservaZenId: reservationId,
            operador: req.usuario.nome,
            unidadeSerializadaId: unidadeLocal?.id ?? null,
            // Mantem o "#" na frente (mesmo formato usado por
            // recebimento.js, enderecos.js, unidades-serializadas.js e
            // pulmao.js pro numero_serie_snapshot) - antes essa linha
            // gravava sem o "#" (numeroSerieLimpo), o que fazia a busca
            // da tela de Historico (que inclui o "#" digitado) nunca
            // achar essa movimentacao na tabela de baixo.
            numeroSerieSnapshot: serialCode,
        });

        const zenEndereco = await moverEnderecoNoZen({
            stockId: linhaDisponivel.id,
            sku: skuProduto,
            destinoChave,
            reservaEsperada: reservationId,
            req,
        });

        res.json({
            status: 'transferido',
            produto: skuProduto,
            numeroSerie: serialCode,
            destino: destino.label,
            enderecoZen: zenEndereco.status,
            alocacaoZen: zenEndereco.reversao?.status,
            ...avisoDoZen(zenEndereco),
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao processar transferência', detalhe: erro?.response?.data || erro.message });
    }
});

// GET /transferencia-deposito/pallet/:etiquetaCodigo   (19/10/2026)
// Transferência por pallet: só CONSULTA o pallet (nada é gravado aqui) e devolve as
// unidades serializadas dele que ainda estão em estoque. Quem transfere é o coletor,
// chamando POST /bipar uma vez por unidade (mesmo caminho, mesmas validações e mesmos
// avisos da bipagem normal) - assim cada unidade é uma transação independente, um erro
// no meio não desfaz as já transferidas e não existe uma requisição longa que estoure o
// tempo da função. Kill switch: TRANSFERENCIA_POR_PALLET_DESLIGADO=1 (ou a função
// `transferencia_por_pallet`).
router.get('/pallet/:etiquetaCodigo', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const etiqueta = String(req.params.etiquetaCodigo || '').trim();
    if (!etiqueta) return res.status(400).json({ erro: 'Informe o código da etiqueta do pallet' });
    try {
        if (process.env.TRANSFERENCIA_POR_PALLET_DESLIGADO === '1'
            || !(await flagAtiva(pool, 'transferencia_por_pallet', { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo }))) {
            return res.status(409).json({ erro: 'Transferência por pallet está desligada (função ou variável de emergência). Use a bipagem por serial.' });
        }
        const { rows: pallets } = await pool.query(
            `SELECT pv.id, pv.etiqueta_codigo, pv.quantidade, pv.deposito, pv.area_atual,
                    e.codigo AS endereco_codigo, pr.sku, pr.descricao
             FROM pallets_vertical pv
             JOIN produtos pr ON pr.id = pv.produto_id
             LEFT JOIN enderecos e ON e.id = pv.endereco_id
             WHERE pv.etiqueta_codigo = $1
             LIMIT 1`,
            [etiqueta]
        );
        const pallet = pallets[0];
        if (!pallet) {
            // Pallet que já zerou vai pro arquivo histórico (ver /bipar): diz isso em vez de "não existe".
            let jaEsvaziado = false;
            try {
                const h = await pool.query(`SELECT 1 FROM pallets_vertical_historico WHERE etiqueta_codigo = $1 LIMIT 1`, [etiqueta]);
                jaEsvaziado = h.rowCount > 0;
            } catch (_) { /* histórico é só pra mensagem */ }
            return res.status(404).json({
                erro: jaEsvaziado
                    ? 'Esse pallet já foi esvaziado (todas as unidades já saíram) - não há o que transferir.'
                    : 'Pallet não encontrado (confira o código da etiqueta)',
            });
        }
        const { rows: unidades } = await pool.query(
            `SELECT numero_serie FROM unidades_serializadas
             WHERE pallet_id = $1 AND status = 'em_estoque'
             ORDER BY numero_serie`,
            [pallet.id]
        );
        res.json({
            etiquetaCodigo: pallet.etiqueta_codigo,
            sku: pallet.sku,
            descricao: pallet.descricao,
            deposito: pallet.deposito,
            areaAtual: pallet.area_atual,
            enderecoCodigo: pallet.endereco_codigo || null,
            quantidade: Number(pallet.quantidade),
            unidades: unidades.map((u) => u.numero_serie),
            // unidades que o pallet conta mas não têm serial no WMS: não entram na transferência por pallet
            semSerial: Math.max(0, Number(pallet.quantidade) - unidades.length),
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(500).json({ erro: 'Falha ao consultar o pallet' });
    }
});

// POST /transferencia-deposito/pallet/transferir   (19/10/2026)
// Body: { etiquetaCodigo, destino: 'mercado_livre' }
// Transferência do pallet INTEIRO em lote (pedido do Dhiefferton: "pra ir mais rápido"). Em vez de
// repetir o fluxo da bipagem unidade por unidade (~10 chamadas ao Zen cada), faz o mesmo POR QUANTIDADE:
//   1. confere tudo ANTES de mexer em qualquer coisa (pallet, unidades em estoque, origem do saldo de
//      cada unidade, saldo livre suficiente no Zen);
//   2. aloca na reserva do depósito a quantidade necessária (uma chamada por linha livre do Zen, com
//      quantity=N - o Zen divide a linha, como já faz com quantity=1); confere cada alocação pelo que
//      apareceu na reserva e guarda exatamente as linhas criadas;
//   3. dá baixa em TODAS as unidades no WMS numa transação só; se isso falhar (ex.: alguém mexeu numa
//      unidade no meio), DESFAZ as alocações do passo 2 e nada muda;
//   4. move o endereço de cada linha alocada (linha inteira, quantity = quantidade da linha) e reverte
//      a alocação uma vez no fim (mesma lógica de modo da bipagem normal).
// Mesma ordem de segurança da bipagem: Zen aloca -> WMS grava -> Zen move/reverte (este último nunca
// derruba, devolve `avisoZen`). A bipagem uma a uma continua existindo como alternativa. Kill switch:
// TRANSFERENCIA_PALLET_EM_LOTE_DESLIGADO=1 ou a função `transferencia_pallet_em_lote`.
const PALLET_LOTE_MAX = 300;

async function moverEReverterLote({ linhas, sku, destinoChave, reservaId, req }) {
    let movidas = 0;
    const erros = [];
    for (const l of linhas) {
        const r = await moverEnderecoNoZen({ stockId: l.id, sku, destinoChave, reservaEsperada: reservaId, req, semReverter: true });
        if (r.status === 'desligado' || r.status === 'sem_endereco') return { status: r.status };
        if (r.status === 'erro') erros.push(r.mensagem);
        else movidas += 1;
    }
    let reversao = { status: 'nada' };
    if (movidas > 0) {
        const enderecoId = Number(await configuracoes.valor(pool, `endereco_zen_${destinoChave}`));
        reversao = await reverterAlocacaoNoZen({ reservaId, enderecoId, sku, req });
    }
    if (erros.length > 0) {
        return {
            status: 'erro',
            mensagem: `${erros.length} de ${linhas.length} linha(s) do lote NÃO foram movidas no ZenERP (${movidas} movida(s)). ${erros[0]} Use "Reprocessar endereço no Zen" com o serial de uma unidade do pallet, e repita até avisar que já estava.`,
            reversao,
        };
    }
    return { status: 'movido', reversao, linhas: linhas.length };
}

router.post('/pallet/transferir', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const etiqueta = String(req.body?.etiquetaCodigo || '').trim();
    const destinoChave = String(req.body?.destino || '').trim();
    if (!etiqueta) return res.status(400).json({ erro: 'Informe o código da etiqueta do pallet' });
    if (destinoChave !== 'mercado_livre') {
        return res.status(400).json({ erro: 'A transferência por pallet só está liberada pro Mercado Livre' });
    }
    const destino = DESTINOS[destinoChave];

    let reservaId = null;
    let sku = null;
    let wmsGravado = null; // { total, seriais } depois do COMMIT: dali em diante NUNCA desfaz o Zen
    const alocadas = []; // linhas que ESTA chamada alocou no Zen: { id, quantity }
    const consultar = async (q, max = 500) => {
        const r = await zenErpGet('/material/stock', { q, max });
        return Array.isArray(r.data) ? r.data : r.data?.data || [];
    };
    const quantidadeDe = (l) => Number(l.quantity ?? 1) || 1;
    // desfaz (melhor esforço) o que esta chamada alocou - só as linhas que ela mesma criou
    const desfazerAlocacoes = async () => {
        for (const l of alocadas) {
            try {
                await zenErpPost(`/material/reservationOpAllocateStockRevert/${reservaId}?stockId=${l.id}&quantity=${l.quantity}`, {});
            } catch (erro) {
                console.error(`[transferencia-deposito] lote: falha ao desfazer a alocação da linha ${l.id}:`, erro?.response?.data || erro.message);
            }
        }
    };

    try {
        if (process.env.TRANSFERENCIA_PALLET_EM_LOTE_DESLIGADO === '1'
            || !(await flagAtiva(pool, 'transferencia_pallet_em_lote', { colaboradorId: req.usuario?.id, cargo: req.usuario?.cargo }))) {
            return res.status(409).json({ erro: 'Transferência do pallet em lote está desligada (função ou variável de emergência). Use "Uma a uma".' });
        }

        // 1. pallet e unidades
        const { rows: pallets } = await pool.query(
            `SELECT pv.id, pv.produto_id, pv.endereco_id, pv.quantidade, pv.area_atual, pr.sku
             FROM pallets_vertical pv JOIN produtos pr ON pr.id = pv.produto_id
             WHERE pv.etiqueta_codigo = $1 LIMIT 1`,
            [etiqueta]
        );
        const pallet = pallets[0];
        if (!pallet) return res.status(404).json({ erro: 'Pallet não encontrado (confira o código da etiqueta)' });
        sku = pallet.sku;
        const { rows: unidades } = await pool.query(
            `SELECT id, numero_serie, endereco_id FROM unidades_serializadas
             WHERE pallet_id = $1 AND status = 'em_estoque' ORDER BY numero_serie`,
            [pallet.id]
        );
        if (unidades.length === 0) return res.status(409).json({ erro: 'Esse pallet não tem unidade serializada em estoque pra transferir.' });
        if (unidades.length > PALLET_LOTE_MAX) {
            return res.status(409).json({ erro: `Pallet com ${unidades.length} unidades: o lote aceita até ${PALLET_LOTE_MAX}. Use "Uma a uma".` });
        }

        // 2. origem do saldo de cada unidade (MAQ, ou o depósito Verde/Amarelo/... dela) e saldo livre no Zen
        reservaId = await reservaDoDestino(destinoChave, destino);
        const grupos = new Map();
        for (const u of unidades) {
            const origem = await origemDoSaldo(pool, u.id, req);
            if (origem.bloqueio) return res.status(409).json({ erro: `${u.numero_serie}: ${origem.bloqueio}` });
            if (!grupos.has(origem.filtro)) grupos.set(origem.filtro, { origem, unidades: [], livres: [] });
            grupos.get(origem.filtro).unidades.push(u);
        }
        for (const g of grupos.values()) {
            g.livres = await consultar(`reservation.id==0;${g.origem.filtro};type==REGULAR;productPacking.product.code=='${sku}'`);
            const livre = g.livres.reduce((soma, l) => soma + quantidadeDe(l), 0);
            if (livre < g.unidades.length) {
                return res.status(409).json({
                    erro: `${mensagemSemSaldo(g.origem, sku)} Precisa de ${g.unidades.length} e o Zen tem ${livre} livre(s). Nada foi alocado.`,
                });
            }
        }

        // 3. aloca por quantidade, conferindo o que apareceu na reserva a cada chamada
        const listarReserva = () => consultar(`reservation.id==${reservaId};productPacking.product.code=='${sku}'`);
        const conhecidas = new Set((await listarReserva()).map((l) => Number(l.id)));
        for (const g of grupos.values()) {
            let falta = g.unidades.length;
            for (const linha of g.livres) {
                if (falta <= 0) break;
                const take = Math.min(falta, quantidadeDe(linha));
                let erroAloca = null;
                try {
                    await zenErpPost(`/material/reservationOpAllocateStock/${reservaId}?stockId=${linha.id}&quantity=${take}`, {});
                } catch (erro) {
                    erroAloca = erro;
                    await aguardar(1500);
                }
                const depois = await listarReserva().catch(() => null);
                const novas = depois ? depois.filter((l) => !conhecidas.has(Number(l.id))) : [];
                const soma = novas.reduce((s, l) => s + quantidadeDe(l), 0);
                if (soma <= take) {
                    // o que apareceu (mesmo parcial) é desta chamada: entra na lista pra poder ser desfeito
                    for (const l of novas) {
                        conhecidas.add(Number(l.id));
                        alocadas.push({ id: Number(l.id), quantity: quantidadeDe(l) });
                    }
                }
                if (!depois || soma !== take) {
                    const detalhe = erroAloca?.response?.data ? JSON.stringify(erroAloca.response.data) : erroAloca?.message;
                    console.error(`[transferencia-deposito] lote: alocação da linha ${linha.id} (${take}) não confirmou: ${detalhe || 'sem erro, mas a reserva não mudou como esperado'}`);
                    await desfazerAlocacoes();
                    return res.status(502).json({
                        erro: `Não consegui alocar ${take} unidade(s) no ZenERP${erroAloca?.response?.status ? ` (HTTP ${erroAloca.response.status})` : ''}. O que já tinha sido alocado foi desfeito e nada mudou no sistema. Tente de novo ou use "Uma a uma".`,
                    });
                }
                falta -= take;
            }
        }

        // 4. dá baixa em todas as unidades numa transação só (se falhar, desfaz as alocações do Zen)
        const ids = unidades.map((u) => u.id);
        const origemTipo = pallet.area_atual === 'pulmao' ? 'pulmao' : 'vertical';
        const client = await pool.connect();
        let motivo = null;
        try {
            await client.query('BEGIN');
            const atual = await client.query(
                `SELECT id, status, pallet_id FROM unidades_serializadas WHERE id = ANY($1) FOR UPDATE`,
                [ids]
            );
            const mudou = atual.rows.filter((r) => r.status !== 'em_estoque' || String(r.pallet_id) !== String(pallet.id));
            if (atual.rowCount !== ids.length || mudou.length > 0) {
                await client.query('ROLLBACK');
                motivo = 'Alguma unidade do pallet mudou de situação enquanto o lote processava.';
            } else {
                await client.query(
                    `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now() WHERE id = ANY($1)`,
                    [ids]
                );
                const pal = await client.query(
                    `SELECT id, quantidade, endereco_id, area_atual FROM pallets_vertical WHERE id = $1 FOR UPDATE`,
                    [pallet.id]
                );
                if (pal.rows[0]) {
                    const restante = Number(pal.rows[0].quantidade) - ids.length;
                    if (restante > 0) {
                        await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [pal.rows[0].id, restante]);
                        await cancelarTarefasSemEstoqueSuficiente(client, pal.rows[0].id, restante);
                    } else {
                        await cancelarTarefasSemEstoqueSuficiente(client, pal.rows[0].id, 0);
                        await client.query(
                            `INSERT INTO pallets_vertical_historico
                                (id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual, criado_em)
                             SELECT id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual, criado_em
                             FROM pallets_vertical WHERE id = $1
                             ON CONFLICT (id) DO NOTHING`,
                            [pal.rows[0].id]
                        );
                        await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [pal.rows[0].id]);
                        if (pal.rows[0].area_atual === 'vertical' && pal.rows[0].endereco_id) {
                            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [pal.rows[0].endereco_id]);
                            await reavaliarPulmaoBestEffort(client);
                        }
                    }
                }
                await client.query('COMMIT');
            }
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[transferencia-deposito] lote: falha ao gravar no WMS (desfazendo no Zen):', erro);
            motivo = 'Falha ao gravar a transferência no sistema.';
        } finally {
            client.release();
        }
        if (motivo) {
            await desfazerAlocacoes();
            return res.status(409).json({ erro: `${motivo} As alocações no ZenERP foram desfeitas e nada mudou. Bipe o pallet de novo.` });
        }
        wmsGravado = { total: unidades.length, seriais: unidades.map((u) => u.numero_serie) };

        // histórico: uma movimentação por unidade, igual à bipagem (em grupos pra não esgotar o pool)
        for (let i = 0; i < unidades.length; i += 10) {
            await Promise.all(unidades.slice(i, i + 10).map((u) => registrarMovimentacao({
                produtoId: pallet.produto_id,
                tipo: 'transferencia_deposito',
                quantidade: 1,
                origemTipo,
                origemId: origemTipo === 'vertical' ? (u.endereco_id ?? pallet.endereco_id ?? null) : null,
                destinoTipo: destino.destinoTipo,
                reservaZenId: reservaId,
                operador: req.usuario.nome,
                unidadeSerializadaId: u.id,
                numeroSerieSnapshot: u.numero_serie,
            })));
        }

        // 5. Zen: move o endereço de cada linha alocada e reverte uma vez (nunca derruba)
        const zenEndereco = await moverEReverterLote({ linhas: alocadas, sku, destinoChave, reservaId, req });
        res.json({
            status: 'transferido',
            total: unidades.length,
            produto: sku,
            destino: destino.label,
            etiquetaCodigo: etiqueta,
            unidades: unidades.map((u) => u.numero_serie),
            linhasZen: alocadas.length,
            enderecoZen: zenEndereco.status,
            alocacaoZen: zenEndereco.reversao?.status,
            ...avisoDoZen(zenEndereco),
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        if (wmsGravado) {
            // já gravou no WMS: o que sobrou é só o Zen (mover/reverter) - nunca desfaz a alocação aqui
            return res.json({
                status: 'transferido',
                total: wmsGravado.total,
                produto: sku,
                destino: destino.label,
                etiquetaCodigo: etiqueta,
                unidades: wmsGravado.seriais,
                enderecoZen: 'erro',
                avisoZen: 'Transferido no sistema, mas houve uma falha ao mexer no ZenERP (mover o endereço e reverter a alocação). Use "Reprocessar endereço no Zen" com o serial de uma unidade do pallet, e repita até avisar que já estava.',
            });
        }
        // falha inesperada ANTES da baixa no WMS: não deixa alocação pendurada no Zen
        if (alocadas.length > 0) await desfazerAlocacoes();
        res.status(502).json({ erro: 'Falha ao processar o lote. Se alocou algo no ZenERP, foi desfeito; confira bipando o pallet de novo.', detalhe: erro?.response?.data || erro.message });
    }
});

// POST /transferencia-deposito/mover-endereco-zen
// Body: { serial, destino }
// Nova tentativa (e reprocesso) SÓ do passo "mover o endereço no ZenERP" - não
// mexe no WMS nem na reserva. Usada quando /bipar respondeu com `avisoZen`.
// Idempotente: se as linhas do produto na reserva do depósito já estão no endereço
// dele, responde "já estava". Só move linha que esteja na reserva atual do depósito.
router.post('/mover-endereco-zen', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const serialDigitado = String(req.body?.serial || '').trim();
    if (!serialDigitado) return res.status(400).json({ erro: 'Informe o serial' });
    const destinoChave = String(req.body?.destino || '').trim();
    const destino = DESTINOS[destinoChave];
    if (!destino) return res.status(400).json({ erro: `Depósito de destino inválido: "${destinoChave}"` });

    const matchQrFabrica = serialDigitado.match(/P\d+(?:L\d+)?S(\d+)/i);
    const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
    const numeroSerie = matchQrFabrica ? `#${matchQrFabrica[1]}` : serialBruto;

    try {
        // O SKU vem da unidade no WMS; serial que só existe no Zen, do próprio Zen.
        let sku = null;
        const local = await pool.query(
            `SELECT pr.sku FROM unidades_serializadas us JOIN produtos pr ON pr.id = us.produto_id WHERE us.numero_serie = $1 LIMIT 1`,
            [numeroSerie]
        );
        sku = local.rows[0]?.sku || null;
        if (!sku) {
            const z = await zenErpGet('/material/stock', { q: `serial.code=='${numeroSerie}'`, max: 1 });
            sku = z.data?.[0]?.productPacking?.product?.code || null;
        }
        if (!sku) return res.status(404).json({ erro: `Serial ${numeroSerie} não encontrado` });

        const reservaEsperada = await reservaDoDestino(destinoChave, destino);
        const resultado = await moverEnderecoNoZen({ sku, destinoChave, reservaEsperada, req });
        if (resultado.status === 'desligado') {
            return res.status(409).json({ erro: 'Mover o endereço no ZenERP está desligado (função ou variável de emergência).' });
        }
        if (resultado.status === 'sem_endereco') {
            return res.status(409).json({ erro: `O depósito ${destino.label} não tem endereço do Zen configurado (Configurações) - nada a mover.` });
        }
        if (resultado.status === 'erro') {
            return res.status(502).json({ erro: resultado.mensagem });
        }
        if (resultado.reversao?.status === 'erro') {
            return res.status(502).json({ erro: resultado.reversao.mensagem });
        }
        res.json({ status: resultado.status, alocacaoZen: resultado.reversao?.status, numeroSerie, destino: destino.label });
    } catch (erro) {
        console.error('[transferencia-deposito] mover-endereco-zen:', erro?.response?.data || erro.message);
        res.status(502).json({ erro: 'Falha ao mover o endereço no ZenERP' });
    }
});

// POST /transferencia-deposito/retornar
// Body: { serial }
//
// Mecanismo de retorno (27/09/2026, a pedido do Dhiefferton: "criar o
// mecanismo de voltar o item para o local de onde saiu lá do picking
// e de onde seja"). Quando um item que tinha saído por /bipar (pra
// qualquer um dos depósitos do mapa DESTINOS acima) volta fisicamente,
// essa rota reativa a unidade e devolve ela pro estoque do WMS.
//
// DECISÕES CONFIRMADAS COM O USUÁRIO antes de implementar (3
// perguntas, AskUserQuestion):
// 1. Destino do retorno: SEMPRE a posição de picking (flutuante) fixa
// reservada pro SKU no Mapa de ruas (enderecos.produto_reservado_id) -
// nunca tenta reconstituir o pallet/endereço exato de onde saiu, que
// pode nem existir mais (mesmo pallet pode ter sido zerado/apagado
// entre a saída e o retorno). Mesmo padrão/mecânica já usado na
// Devolução (enviarParaPickingDevolucao, nf-devolucao.js).
// 2. A reserva fixa 22919 do ZenERP NÃO é desalocada por aqui - esse
// ajuste no Zen fica manual, por conta do usuário. Automatizar isso
// exigiria confirmar ao vivo com ele qual endpoint do Zen desaloca uma
// unidade de uma reserva (este ambiente não tem acesso à API do
// ZenERP), o que não foi feito ainda.
// 3. Mesmo cargo de quem bipa a saída (recebimento_reposicao).
//
// Só aceita devolver uma unidade cuja ÚLTIMA movimentação tenha sido
// uma saída por ESTA tela (tipo='transferencia_deposito', destino_tipo
// batendo com um dos DESTINOS acima) - evita reativar por engano uma
// unidade removida por outro caminho (exclusão manual em
// unidades-serializadas.js/enderecos.js, ou o Estoque Devolução, que
// usa reservas reserva_zen_devolucao_* diferentes e tem seu próprio
// fluxo de retorno).
//
// LIMITAÇÃO, de propósito: só cobre serial que já estava na nossa
// tabela unidades_serializadas no momento da saída (o caso comum). Um
// serial que só existia no ZenERP ("serial não é nosso", ver /bipar
// acima) não tem registro aqui pra reativar - se isso acontecer na
// prática, avisar pra decidir como tratar.
router.post('/retornar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const serialDigitado = String(req.body?.serial || '').trim();
    if (!serialDigitado) {
        return res.status(400).json({ erro: 'Informe o serial bipado' });
    }

    // Mesma extração de código de fábrica usada em /bipar acima.
    const matchQrFabrica = serialDigitado.match(/P\d+(?:L\d+)?S(\d+)/i);
    const serialExtraido = matchQrFabrica ? `#${matchQrFabrica[1]}` : null;
    const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
    const tentativasDeSerial = serialExtraido && serialExtraido !== serialBruto
        ? [serialExtraido, serialBruto]
        : [serialBruto];

    const destinosValidos = Object.values(DESTINOS).map((d) => d.destinoTipo);

    try {
        const { rows: unidadeRows } = await pool.query(
            `SELECT us.id, us.status, us.numero_serie, us.produto_id, pr.sku AS produto_sku
             FROM unidades_serializadas us
             JOIN produtos pr ON pr.id = us.produto_id
             WHERE us.numero_serie = ANY($1)
             LIMIT 1`,
            [tentativasDeSerial]
        );
        const unidade = unidadeRows[0];
        if (!unidade) {
            return res.status(404).json({
                erro: `Serial não encontrado (bipado "${serialDigitado}", tentei buscar como ${tentativasDeSerial.join(' e ')})`,
            });
        }
        if (unidade.status !== 'removido') {
            return res.status(409).json({
                erro: `Serial ${unidade.numero_serie} está com status "${unidade.status}" (não "removido") - só dá pra devolver uma unidade que saiu por essa tela`,
            });
        }

        const { rows: ultimaMovRows } = await pool.query(
            `SELECT tipo, destino_tipo FROM movimentacoes
             WHERE unidade_serializada_id = $1
             ORDER BY criado_em DESC LIMIT 1`,
            [unidade.id]
        );
        const ultimaMov = ultimaMovRows[0];
        if (!ultimaMov || ultimaMov.tipo !== 'transferencia_deposito' || !destinosValidos.includes(ultimaMov.destino_tipo)) {
            return res.status(409).json({
                erro: `Serial ${unidade.numero_serie} não saiu pela Transferência de Depósito (última movimentação registrada: ${ultimaMov?.tipo || 'nenhuma'}) - não dá pra devolver por essa tela; fale com um admin se precisar reativar manualmente`,
            });
        }

        const client = await pool.connect();
        let enderecoPickingId;
        let enderecoPickingCodigo;
        try {
            await client.query('BEGIN');

            const travada = await client.query(
                `SELECT status FROM unidades_serializadas WHERE id = $1 FOR UPDATE`,
                [unidade.id]
            );
            if (travada.rows[0]?.status !== 'removido') {
                await client.query('ROLLBACK');
                return res.status(409).json({ erro: `Serial ${unidade.numero_serie} mudou de status enquanto processava - tente de novo` });
            }

            // Mesma lógica de enviarParaPickingDevolucao (nf-devolucao.js):
            // pode existir mais de uma posição reservada pro mesmo
            // produto - prioriza a que já tem esse produto guardado,
            // senão pega a primeira por código.
            const enderecoPicking = await client.query(
                `SELECT e.id, e.codigo FROM enderecos e
                 WHERE e.andar = 1 AND e.produto_reservado_id = $1
                 ORDER BY (EXISTS (
                     SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1
                 )) DESC, e.codigo
                 LIMIT 1
                 FOR UPDATE OF e`,
                [unidade.produto_id]
            );
            if (enderecoPicking.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    erro: `Produto ${unidade.produto_sku} ainda não tem posição de picking (flutuante) reservada pra ele - reserve pelo Mapa de ruas antes de devolver`,
                });
            }
            enderecoPickingId = enderecoPicking.rows[0].id;
            enderecoPickingCodigo = enderecoPicking.rows[0].codigo;

            const existente = await client.query(
                `SELECT id, produto_id FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
                [enderecoPickingId]
            );
            if (existente.rowCount > 0 && existente.rows[0].produto_id !== unidade.produto_id) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    erro: `A posição de picking reservada (${enderecoPickingCodigo}) já tem outro produto guardado - confira o Mapa de ruas`,
                });
            }
            if (existente.rowCount > 0) {
                await client.query(
                    `UPDATE unidades_picking SET quantidade = quantidade + 1, atualizado_em = now() WHERE id = $1`,
                    [existente.rows[0].id]
                );
            } else {
                await client.query(
                    `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, 1)`,
                    [unidade.produto_id, enderecoPickingId]
                );
                await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
            }

            // Unidade solta no picking (sem pallet/endereço individual) -
            // mesma convenção já usada em toda unidade serializada solta
            // no picking (ver enviarParaPickingDevolucao acima).
            await client.query(
                `UPDATE unidades_serializadas SET status = 'em_estoque', pallet_id = NULL, endereco_id = NULL, atualizado_em = now() WHERE id = $1`,
                [unidade.id]
            );

            await client.query('COMMIT');
        } catch (erro) {
            await client.query('ROLLBACK');
            throw erro;
        } finally {
            client.release();
        }

        await registrarMovimentacao({
            produtoId: unidade.produto_id,
            tipo: 'transferencia_deposito_retorno',
            quantidade: 1,
            origemTipo: 'externo',
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
            operador: req.usuario.nome,
            unidadeSerializadaId: unidade.id,
            numeroSerieSnapshot: unidade.numero_serie,
        });

        res.json({
            status: 'retornado',
            produto: unidade.produto_sku,
            numeroSerie: unidade.numero_serie,
            enderecoPickingCodigo,
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(500).json({ erro: 'Falha ao processar retorno', detalhe: erro.message });
    }
});

module.exports = router;
