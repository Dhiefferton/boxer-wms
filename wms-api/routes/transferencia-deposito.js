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
        await pool.query(
            `INSERT INTO movimentacoes
                (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot, reserva_zen_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
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
            ]
        );
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
            const respostaEstoque = await zenErpGet('/material/stock', {
                q: `reservation.id==0;address.code=='MAQ';type==REGULAR;productPacking.product.code=='${skuProduto}'`,
                max: 1,
            });
            linhaDisponivel = respostaEstoque.data?.[0];
            if (!linhaDisponivel) {
                return res.status(409).json({ erro: `Sem estoque disponível na área MAQ para o produto ${skuProduto}` });
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

        res.json({
            status: 'transferido',
            produto: skuProduto,
            numeroSerie: serialCode,
            destino: destino.label,
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao processar transferência', detalhe: erro?.response?.data || erro.message });
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
