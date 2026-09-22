// ============================================================
// Polling do ZenERP - roda dentro do mesmo processo da API,
// pra não precisar de um segundo serviço no Railway.
//
// O que faz, em português simples:
// 1. Faz login no ZenERP e guarda o token por ~23h.
// 2. De tempos em tempos, busca pedidos abertos e os itens
// de cada um.
// 3. Grava pedido novo no banco - isso dispara sozinho o
// motor de alocação (gatilho já existente no banco).
//
// Só inicia se as variáveis ZENERP_* estiverem configuradas -
// se não estiverem, a API funciona normalmente sem o polling.
// ============================================================
const axios = require('axios');
const pool = require('./db');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MINUTES || 3) * 60 * 1000;

let tokenCache = { valor: null, expiraEm: 0 };

async function obterToken() {
    if (tokenCache.valor && Date.now() < tokenCache.expiraEm) {
        return tokenCache.valor;
    }

    const resposta = await axios.post(
        `${process.env.ZENERP_AUTH_BASE_URL}/auth/login`,
        {
            username: process.env.ZENERP_USERNAME,
            password: process.env.ZENERP_PASSWORD,
            properties: {},
        },
        { headers: { tenant: process.env.ZENERP_TENANT, Accept: 'application/json' } }
    );

    tokenCache = {
        valor: resposta.data.accessToken,
        expiraEm: Date.now() + 23 * 60 * 60 * 1000,
    };

    console.log('[zenerp] Login renovado.');
    return tokenCache.valor;
}

async function zenErpGet(path, params) {
    const token = await obterToken();
    return axios.get(`${process.env.ZENERP_BASE_URL}${path}`, {
        params,
        timeout: 15000,
        headers: {
            Authorization: `Bearer ${token}`,
            tenant: process.env.ZENERP_TENANT,
            Accept: 'application/json',
        },
    });
}

async function zenErpPost(path, body, metodo) {
    const token = await obterToken();
    return axios({ method: metodo || 'POST', url: `${process.env.ZENERP_BASE_URL}${path}`, data: body,
        timeout: 20000,
        headers: {
            Authorization: `Bearer ${token}`,
            tenant: process.env.ZENERP_TENANT,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
    });
}

// Busca TODOS os pickingOrders que casam com o filtro, paginando
// ate a API nao devolver mais nenhum resultado. Antes essa funcao
// so fazia uma chamada sem "max"/"offset" - se a API do ZenERP
// aplicasse um limite padrao de resultados por pagina (comum em
// APIs REST), pedidos mais recentes podiam ficar de fora sem
// nenhum erro aparente. Agora sempre varre tudo.
async function buscarPickingOrders() {
    const TAMANHO_PAGINA = 100;
    let todos = [];
    let offset = 0;

    while (true) {
        const resposta = await zenErpGet('/material/pickingOrder', {
            q: 'reservation.status==APPROVED;pickingProfile.code==EXPEDICAO',
            max: TAMANHO_PAGINA,
            offset,
        });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        todos = todos.concat(lista);

        if (lista.length < TAMANHO_PAGINA) {
            break;
        }
        offset += TAMANHO_PAGINA;
    }

    return todos;
}

async function buscarItensDoPedido(pickingOrderId) {
    const resposta = await zenErpGet('/material/pickingOrderItem', {
        pickingOrder: pickingOrderId,
        q: `pickingOrder.id==${pickingOrderId}`,
    });
    const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
    return lista
        .map((item) => ({
            sku: item.productPacking?.product?.code,
            descricao: item.productPacking?.product?.description ?? null,
            quantidade: Number(item.quantity),
        }))
        .filter((item) => item.sku && item.quantidade > 0);
}

async function montarPedidoCompleto(pickingOrder) {
    const itens = await buscarItensDoPedido(pickingOrder.id);
    return {
        numeroErp: String(pickingOrder.id), reservationId: pickingOrder.reservation?.id ?? null, outgoingListId: pickingOrder.outgoingList?.id ?? null, perfilSeparacaoCodigo: pickingOrder.pickingProfile?.code ?? null,
        criadoEm: pickingOrder.date ?? new Date().toISOString(),
        itens,
    };
}

async function gravarPedido(pedido) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existente = await client.query(
            `SELECT id FROM pedidos WHERE numero_erp = $1`,
            [pedido.numeroErp]
        );

        if (existente.rowCount > 0) {
            await client.query('ROLLBACK');
            return { status: 'ja_existia', numeroErp: pedido.numeroErp };
        }

        if (pedido.itens.length === 0) {
            await client.query('ROLLBACK');
            return { status: 'sem_itens', numeroErp: pedido.numeroErp };
        }

        const { rows } = await client.query(
            `INSERT INTO pedidos (numero_erp, criado_em, reservation_id, outgoing_list_id, perfil_separacao_codigo) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [pedido.numeroErp, pedido.criadoEm, pedido.reservationId, pedido.outgoingListId, pedido.perfilSeparacaoCodigo]
        );
        const pedidoId = rows[0].id;

        let itensGravados = 0;
        let itensExternos = 0;
        for (const item of pedido.itens) {
            const produto = await client.query(`SELECT id, separado_pelo_almoxarifado FROM produtos WHERE sku = $1`, [item.sku]);

            if (produto.rowCount === 0) {
                // SKU nao cadastrado no WMS - decisao do usuario
                // (09/09/2026): trata como peca do almoxarifado,
                // separada por fora do nosso fluxo. Grava mesmo
                // assim, como item "externo" (sem produto_id, ja
                // 'completo'), so pra nao sumir da tela de Separacao -
                // ver comentario da migracao
                // itens_pedido_permite_item_externo_almoxarifado.
                console.warn(
                    `[zenerp] Produto com SKU "${item.sku}" não está cadastrado - ` +
                    `item do pedido ${pedido.numeroErp} gravado como separado por fora (almoxarifado).`
                );
                await client.query(
                    `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x, quantidade_separada, status, sku_zenerp, descricao_zenerp)
                     VALUES ($1, NULL, $2, $2, 'completo', $3, $4)`,
                    [pedidoId, item.quantidade, item.sku, item.descricao]
                );
                itensExternos += 1;
                continue;
            }

            if (produto.rows[0].separado_pelo_almoxarifado) {
                // CORRECAO 22/09/2026 (pedido 43935, SKU 99079): produto
                // CADASTRADO (as vezes ate serializado), mas marcado no
                // cadastro como "separado pelo Almoxarifado" - o
                // Almoxarifado tem o estoque fisico por fora do vertical/
                // picking do WMS e aloca direto na reserva do ZenERP, sem
                // nunca passar pelo coletor. Antes desse SKU virar "todo
                // Almoxarifado" (ex.: depois de uma Transferencia de
                // Deposito em lote que zerou o estoque serializado daqui),
                // o item ficava preso pra sempre em "0/X": nao tinha
                // unidade fisica pra bipar, e sincronizarAlocacaoJaFeita
                // (mais abaixo) de proposito NAO cobre produto serializado
                // (ver comentario dela). Mesmo tratamento do item
                // "externo" acima (completo direto ao gravar), so que
                // mantendo o produto_id (continua rastreavel/visivel como
                // o produto certo, nao "sem cadastro").
                console.warn(
                    `[zenerp] Produto SKU "${item.sku}" marcado como separado pelo Almoxarifado - ` +
                    `item do pedido ${pedido.numeroErp} gravado direto como completo.`
                );
                await client.query(
                    `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x, quantidade_separada, status)
                     VALUES ($1, $2, $3, $3, 'completo')`,
                    [pedidoId, produto.rows[0].id, item.quantidade]
                );
                itensExternos += 1;
                continue;
            }

            await client.query(
                `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x) VALUES ($1, $2, $3)`,
                [pedidoId, produto.rows[0].id, item.quantidade]
            );
            itensGravados += 1;
        }

        await client.query('COMMIT');
        return { status: 'gravado', numeroErp: pedido.numeroErp, itensGravados, itensExternos, pedidoId };
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
}

// Verifica quanto de cada item do pedido já está alocado na reserva
// no ZenERP (GET /material/stock?q=reservation.id==X) e atualiza
// itens_pedido.quantidade_separada pra refletir isso. Existe porque
// pedido com peça do almoxarifado chega do ZenERP com esses itens
// já alocados direto na reserva (o time de lá separa antes de
// mandar pra expedição, sem passar pela bipagem do coletor) - sem
// essa checagem, esses itens ficavam presos em "0/X" pra sempre,
// já que ninguém tem serial físico pra bipar de uma peça que nunca
// passa pelo coletor.
//
// CORREÇÃO 10/09/2026: essa consulta ao ZenERP só prova que existe
// estoque "linkado" à reserva no sistema deles - não prova que
// alguém realmente separou/pegou a peça na mão. O próprio ZenERP
// religa estoque disponível numa reserva sozinho (assim que a peça
// existe em alguma posição, vertical ou picking), independente de
// qualquer ação da nossa equipe. Isso gerava alocação falsa pra
// SKU serializado (ex.: 2005026) - o pedido aparecia "completo"
// sem nenhuma bipagem real (confirmado no banco: 11 de 14 pedidos
// desse SKU tinham status completo com ZERO movimentação de
// separação, alguns ainda com etapa_separacao='pendente', o que é
// fisicamente impossível). Fez efeito só depois da movimentação do
// estoque flutuante (09/09) porque foi quando esse SKU passou a ter
// estoque numa posição que o ZenERP linka automaticamente - mas o
// mesmo problema já existia antes pra outros pedidos (a causa é a
// consulta em si, não aquela movimentação específica).
//
// Por isso agora só aplica pra produto SEM serial (pr.serializado =
// false) - exatamente o caso original que essa função foi feita pra
// resolver (almoxarifado sem serial físico pra bipar). Produto
// serializado sempre precisa da bipagem de verdade no coletor -
// "estar linkado na reserva" não prova qual unidade física foi
// separada.
//
// Chamada em 2 momentos: quando o pedido é sincronizado a primeira
// vez (pedido.itens ainda tudo 0/X) e de novo logo depois de
// "iniciar reserva" (cobre o pedido 100% almoxarifado, sem nenhuma
// máquina pra bipar - senão ficaria parado em "reserva_iniciada"
// sem nenhuma ação possível pro operador fazer avançar). Também
// reaproveitada numa correção manual (ver
// POST /separacao-erp/corrigir-alocacao-almoxarifado) pra pedido
// que já estava parado na fila antes dessa checagem existir.
//
// SÓ AUMENTA quantidade_separada, nunca diminui - usa o maior valor
// entre o que já estava gravado (pode já ter máquina bipada pelo
// coletor, que também fica alocada nessa mesma reserva) e o que a
// reserva mostra alocado pra aquele SKU. "Best effort": se a
// consulta falhar ou vier vazia/formato inesperado, não muda nada -
// os itens continuam precisando ser bipados normalmente, como
// sempre foi.
async function sincronizarAlocacaoJaFeita(pedidoId, reservationId) {
    if (!reservationId) return { atualizados: 0 };
    try {
        const resposta = await zenErpGet('/material/stock', { q: `reservation.id==${reservationId}` });
        const linhas = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        const quantidadePorSku = new Map();
        for (const linha of linhas) {
            const sku = linha.productPacking?.product?.code;
            const quantidade = Number(linha.quantity) || 0;
            if (!sku || quantidade <= 0) continue;
            quantidadePorSku.set(sku, (quantidadePorSku.get(sku) || 0) + quantidade);
        }
        if (quantidadePorSku.size === 0) return { atualizados: 0 };

        const { rows: itens } = await pool.query(
            `SELECT ip.id, ip.quantidade_x, ip.quantidade_separada, pr.sku
             FROM itens_pedido ip
             JOIN produtos pr ON pr.id = ip.produto_id
             WHERE ip.pedido_id = $1 AND pr.serializado = false`,
            [pedidoId]
        );

        let atualizados = 0;
        for (const item of itens) {
            const alocadoNaReserva = quantidadePorSku.get(item.sku);
            if (!alocadoNaReserva) continue;
            const novaQuantidade = Math.min(Math.max(item.quantidade_separada, alocadoNaReserva), item.quantidade_x);
            if (novaQuantidade <= item.quantidade_separada) continue;

            await pool.query(
                `UPDATE itens_pedido
                 SET quantidade_separada = $2, status = CASE WHEN $2 >= quantidade_x THEN 'completo' ELSE 'parcial' END
                 WHERE id = $1`,
                [item.id, novaQuantidade]
            );
            console.log(
                `[zenerp] Pedido ${pedidoId}: item ${item.sku} já tinha ${novaQuantidade}/${item.quantidade_x} ` +
                `alocado na reserva ${reservationId} (provavelmente almoxarifado) - atualizado sem precisar bipar.`
            );
            atualizados += 1;
        }

        if (atualizados > 0) {
            // CORRECAO 17/09/2026 (pedido 43488, ver comentario do passo 6
            // em separacao-erp.js pro caso completo): trocado o
            // SELECT+UPDATE separados por 1 UPDATE atomico so, com o
            // "todos completos" resolvido dentro do proprio WHERE (NOT
            // EXISTS) - fecha a janela em que esse ciclo do poller podia
            // ler um item de OUTRO pedido/bipagem transitoriamente
            // 'completo' (ainda nao confirmado no Zen) e avancar a etapa
            // por engano.
            await pool.query(
                `UPDATE pedidos SET etapa_separacao = 'estoque_alocado'
                 WHERE id = $1 AND etapa_separacao = 'reserva_iniciada'
                 AND NOT EXISTS (SELECT 1 FROM itens_pedido WHERE pedido_id = $1 AND status <> 'completo')`,
                [pedidoId]
            );
        }

        return { atualizados };
    } catch (erro) {
        console.warn(
            `[zenerp] Falha ao sincronizar alocação já feita pro pedido ${pedidoId} (reserva ${reservationId}) - segue sem mudar nada:`,
            erro?.response?.data || erro.message
        );
        return { atualizados: 0, erro: true };
    }
}

// Confere de verdade, direto no pickingOrder (nao na reserva), se um
// pedido que sumiu da lista de "abertos" esta REALMENTE encerrado.
// Existe (09/09/2026) porque a reserva pode sair do status APPROVED
// por um motivo que nao tem nada a ver com o pedido estar concluido -
// confirmado pelo usuario: pedido com peca do almoxarifado, onde o
// time de la mexe na propria reserva no Zen antes da gente sequer
// abrir o pedido aqui, tambem tira a reserva de APPROVED, mesmo o
// pedido continuando 'pendente' (nunca tocado) aqui e ainda
// precisando ser separado/finalizado. O pickingOrder tem um status
// proprio, independente da reserva - confirmado na propria tela do
// Zen (`material/pickingOrder?iq=status!=FINISHED`, o filtro que a
// grade de "pedidos em aberto" usa). So considera genuinamente
// encerrado se esse status vier como 'FINISHED'; se vier qualquer
// outra coisa, ou se a chamada falhar, trata como "ainda aberto" -
// mais seguro sumir tarde da fila (o operador so vai reparar que
// nao precisava mais) do que sumir cedo demais (o operador nunca
// mais acha o pedido pra finalizar).
async function pickingOrderRealmenteEncerrado(numeroErp) {
    try {
        const resposta = await zenErpGet('/material/pickingOrder', { q: `id==${numeroErp}` });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        const status = lista[0]?.status;
        return status === 'FINISHED';
    } catch (erro) {
        console.warn(
            `[zenerp] Falha ao confirmar status real do pedido ${numeroErp} antes de marcar como processado externamente - mantendo na fila por precaucao:`,
            erro?.response?.data || erro.message
        );
        return false;
    }
}

// Reconcilia a fila local com o que o ZenERP diz que está aberto
// agora. O polling sempre foi só de inserção (nunca removia nada),
// então um pedido que é finalizado/cancelado direto no ZenERP -
// fora do fluxo do coletor - ficava pra sempre na fila de
// "Aguardando iniciar reserva", mesmo não existindo mais como
// pedido aberto no ERP. Aqui reaproveitamos a lista de
// pickingOrders já buscada nesse mesmo ciclo (sem chamada extra
// nenhuma ao ZenERP) pra achar os CANDIDATOS a "processado_externamente"
// - pedido local, ainda não finalizado por aqui, cujo número não
// aparece mais entre os pedidos abertos do ERP - e so confirma de
// verdade (ver pickingOrderRealmenteEncerrado acima) antes de marcar.
//
// IMPORTANTE: só faz esse cruzamento pra pedidos em 'pendente' (ou
// seja, que a GENTE ainda nao tocou). A consulta ao ZenERP que gera
// "pickingOrders" so traz reservas com status APPROVED - assim que
// o proprio coletor inicia a reserva (iniciar-reserva), o status no
// ZenERP vira STARTED e o pedido some dessa lista naturalmente, sem
// ter sido cancelado nem finalizado por ninguem. Antes essa funcao
// comparava TODOS os pedidos ainda nao concluidos (incluindo
// reserva_iniciada, estoque_alocado etc.) contra essa lista, e
// acabava marcando como "processado_externamente" - sumindo da fila -
// pedidos que estavam ativamente sendo separados aqui mesmo.
async function limparPedidosEncerradosNoErp(pickingOrders) {
    const numerosAbertosNoErp = new Set(pickingOrders.map((p) => String(p.id)));

    const { rows: pendentesLocais } = await pool.query(
        `SELECT id, numero_erp FROM pedidos
         WHERE etapa_separacao = 'pendente'
         AND reservation_id IS NOT NULL
         AND outgoing_list_id IS NOT NULL
         AND perfil_separacao_codigo = 'EXPEDICAO'`
    );

    const candidatos = pendentesLocais.filter((p) => !numerosAbertosNoErp.has(String(p.numero_erp)));
    if (candidatos.length === 0) {
        return 0;
    }

    const encerrados = [];
    for (const candidato of candidatos) {
        if (await pickingOrderRealmenteEncerrado(candidato.numero_erp)) {
            encerrados.push(candidato);
        }
    }
    if (encerrados.length === 0) {
        return 0;
    }

    await pool.query(
        `UPDATE pedidos SET etapa_separacao = 'processado_externamente' WHERE id = ANY($1)`,
        [encerrados.map((p) => p.id)]
    );
    console.log(
        `[zenerp] ${encerrados.length} pedido(s) não aparecem mais como abertos no ZenERP - ` +
        `removido(s) da fila de separação (${encerrados.map((p) => p.numero_erp).join(', ')}).`
    );
    return encerrados.length;
}

// ------------------------------------------------------------
// Detecta pedido REVERTIDO no ZenERP (reserva cancelada, excluída
// ou "voltada pra trás" por alguém mexendo direto lá) que continua
// em andamento aqui - fechando o buraco pedido pelo usuário em
// 22/09/2026: "O sistema está trazendo na lista de ordem de
// separação, pedidos que foram revertidos no zen e não existe
// mais."
//
// Por que isso não era coberto por nada que já existia:
// - limparPedidosEncerradosNoErp (acima) só cobre etapa='pendente'
//   (pedido nunca tocado aqui) DE PROPÓSITO - ver o comentário
//   dela: pedido já em andamento sai naturalmente da lista de
//   pickingOrders (que só traz reserva APPROVED) assim que o
//   próprio coletor avança a reserva pra STARTED, e isso não é
//   reversão nenhuma.
// - Só que isso também significa que pedido em reserva_iniciada em
//   diante nunca tinha NENHUMA verificação de reversão - se
//   alguém cancelasse/revertesse a reserva no Zen no meio do
//   processo, o pedido ficava preso pra sempre na fila daqui.
//
// Decisão confirmada com o usuário: roda dentro do ciclo automático
// de 5 em 5 min (executarCiclo, chamado pelo cron do Supabase em
// /erp/cron), em vez de a cada "atualizar" do colaborador no
// coletor - pra não multiplicar chamada ao ZenERP por refresh
// (mesmo motivo do incidente de esgotamento do pool de conexão
// desta semana).
//
// Como decide se foi revertido: a reserva no Zen só anda pra frente
// (APPROVED -> STARTED -> FINISHED). Se o pedido aqui já está numa
// etapa que exige um status mínimo (ex: reserva_iniciada exige pelo
// menos STARTED) e o status real lá voltou pra trás, OU a própria
// reserva não existe mais (404 - foi excluída), OU o status vier um
// valor desconhecido (o Zen pode ter algum status de
// cancelamento/reversão que a gente nunca viu ainda) - trata como
// revertido. Prefere marcar demais a arriscar deixar pedido morto
// preso na fila pra sempre; existe a rota de admin
// "POST /separacao-erp/reabrir-revertidos" pra desfazer um falso
// positivo (ver separacao-erp.js), restaurando a etapa que o pedido
// tinha antes (guardada em etapa_antes_reversao).
const RANK_STATUS_RESERVA = { APPROVED: 1, STARTED: 2, FINISHED: 3 };

// Só cobre as etapas em andamento que NENHUMA outra verificação
// cobre hoje - 'pendente' fica de fora de propósito (já tratado por
// limparPedidosEncerradosNoErp acima).
const RANK_MINIMO_POR_ETAPA = {
    reserva_iniciada: RANK_STATUS_RESERVA.STARTED,
    estoque_alocado: RANK_STATUS_RESERVA.STARTED,
    reserva_finalizada: RANK_STATUS_RESERVA.FINISHED,
    romaneio_finalizado: RANK_STATUS_RESERVA.FINISHED,
    volume_definido: RANK_STATUS_RESERVA.FINISHED,
};

async function reservaRevertidaNoZen(reservationId, etapaAtual) {
    const minimoEsperado = RANK_MINIMO_POR_ETAPA[etapaAtual];
    if (!minimoEsperado) return false;

    try {
        const resposta = await zenErpGet(`/material/reservation/${reservationId}`);
        const statusReal = resposta.data?.status;
        const rankReal = RANK_STATUS_RESERVA[statusReal];

        if (!rankReal) {
            console.warn(
                `[zenerp] Reserva ${reservationId} voltou status desconhecido ('${statusReal}') - tratando como revertida por precaução.`
            );
            return true;
        }
        return rankReal < minimoEsperado;
    } catch (erro) {
        if (erro?.response?.status === 404) {
            return true; // reserva não existe mais no Zen - foi excluída/revertida
        }
        console.warn(
            `[zenerp] Falha ao verificar reversão da reserva ${reservationId} - mantendo na fila por precaução:`,
            erro?.response?.data || erro.message
        );
        return false;
    }
}

async function verificarPedidosRevertidosNoZen() {
    const etapas = Object.keys(RANK_MINIMO_POR_ETAPA);
    const { rows } = await pool.query(
        `SELECT id, numero_erp, reservation_id, etapa_separacao FROM pedidos
         WHERE etapa_separacao = ANY($1)
         AND reservation_id IS NOT NULL
         AND perfil_separacao_codigo = 'EXPEDICAO'`,
        [etapas]
    );

    let marcados = 0;
    for (const pedido of rows) {
        const revertido = await reservaRevertidaNoZen(pedido.reservation_id, pedido.etapa_separacao);
        if (!revertido) continue;

        const resultado = await pool.query(
            `UPDATE pedidos SET etapa_separacao = 'revertido_no_zen', etapa_antes_reversao = etapa_separacao
             WHERE id = $1 AND etapa_separacao = $2`,
            [pedido.id, pedido.etapa_separacao]
        );
        if (resultado.rowCount > 0) {
            marcados++;
            console.log(
                `[zenerp] Pedido ${pedido.numero_erp} marcado como revertido no Zen (estava em '${pedido.etapa_separacao}', reserva ${pedido.reservation_id} não confirma mais essa etapa) - removido da fila de separação.`
            );
        }
    }
    return marcados;
}

async function executarCiclo() {
    console.log(`[zenerp] Consultando pedidos abertos...`);
    try {
        const pickingOrders = await buscarPickingOrders();

        if (pickingOrders.length === 0) {
            console.log('[zenerp] Nenhum pedido aberto encontrado.');
        } else {
            console.log(`[zenerp] ${pickingOrders.length} pedido(s) aberto(s) encontrado(s).`); const numerosExistentes = new Set((await pool.query(`SELECT numero_erp FROM pedidos WHERE numero_erp = ANY($1)`, [pickingOrders.map((p) => String(p.id))])).rows.map((r) => r.numero_erp)); const pickingOrdersNovos = pickingOrders.filter((p) => !numerosExistentes.has(String(p.id))); console.log(`[zenerp] ${pickingOrdersNovos.length} pedido(s) novo(s) pra processar (${pickingOrders.length - pickingOrdersNovos.length} ja existiam).`);

            for (const pickingOrder of pickingOrdersNovos) {
                const pedido = await montarPedidoCompleto(pickingOrder);
                const resultado = await gravarPedido(pedido);

                if (resultado.status === 'gravado') {
                    const sufixoExternos = resultado.itensExternos > 0
                        ? ` (${resultado.itensExternos} deles separado(s) por fora - almoxarifado)`
                        : '';
                    console.log(
                        `[zenerp] pedido ${resultado.numeroErp} gravado com ${resultado.itensGravados + resultado.itensExternos} item(ns)${sufixoExternos}.`
                    );
                    await sincronizarAlocacaoJaFeita(resultado.pedidoId, pedido.reservationId);
                } else if (resultado.status === 'sem_itens') {
                    console.log(`[zenerp] pedido ${resultado.numeroErp} sem itens válidos, ignorado.`);
                } else {
                    console.log(`[zenerp] pedido ${resultado.numeroErp} já existia, ignorado.`);
                }
            }
        }

        // Roda sempre - mesmo quando pickingOrders veio vazio, já que
        // uma resposta vazia do ZenERP é tão confiável quanto uma
        // resposta com itens (significa "nenhum pedido aberto mesmo").
        await limparPedidosEncerradosNoErp(pickingOrders);

        // Idem: verifica reversão de pedido já em andamento,
        // independente do que veio (ou não) em pickingOrders - essa
        // verificação consulta a reserva de cada pedido diretamente,
        // não depende da lista de pickingOrders buscada acima.
        await verificarPedidosRevertidosNoZen();
    } catch (erro) {
        console.error('[zenerp] Erro no ciclo de polling:', erro.response?.data || erro.message);
    }
}

// ------------------------------------------------------------
// Ponto de entrada chamado pelo index.js no boot da API.
// Só liga o polling se as variáveis do ZenERP estiverem
// configuradas - senão a API sobe normal, sem essa parte.
// ------------------------------------------------------------
function iniciarPollingZenErp() {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);

    if (faltando.length > 0) {
        console.log(`[zenerp] Polling desligado - faltam variáveis: ${faltando.join(', ')}`);
        return;
    }

    console.log(`[zenerp] Polling ligado, a cada ${process.env.POLL_INTERVAL_MINUTES || 3} minuto(s).`);
    executarCiclo();
    setInterval(executarCiclo, POLL_INTERVAL_MS);
}

module.exports = {
    iniciarPollingZenErp, zenErpGet, zenErpPost, executarCiclo, buscarItensDoPedido,
    limparPedidosEncerradosNoErp, sincronizarAlocacaoJaFeita, verificarPedidosRevertidosNoZen,
    reservaRevertidaNoZen, RANK_MINIMO_POR_ETAPA,
};
