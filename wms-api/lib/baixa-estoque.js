// ============================================================
// BAIXA DE ESTOQUE AUTOMÁTICA (21/10/2026, pedido do Dhiefferton: "vamos automatizar o restante do
// processo das ordens de separação quando for baixa de estoque").
//
// Ordens de separação do perfil BAIXA_ESTOQUE (perfis_separacao.termina_ao_finalizar_reserva = true)
// não passam por volume/romaneio/nota/conferência na tela. Depois que a reserva é finalizada, o WMS
// faz sozinho, no Zen, o que antes era na mão (prints do Dhiefferton, ordem 47909 / romaneio 51595 /
// nota 73494):
//   1. Finalizar romaneio  -> POST /material/outgoingListOpPacked/{romaneio}            (status PACKED)
//   2. Criar volumes       -> POST /material/outgoingListOpVolumeCreateAuto/{romaneio}  (quantity = total de unidades)
//   3. Criar a nota        -> POST /material/outgoingListOpOutgoingInvoiceCreate/{romaneio}
//                             { fiscalProfileOperationId: 1003 (BaixaEstoque), invoiceSeriesId: 1007 (CONTROLE/INTERNO) }
//   4. Observação da nota  -> PUT /fiscal/outgoingInvoice  properties.comments = texto fixo
// Depois disso a ordem vira 'concluido_no_erp' (etapa terminal, some das filas). A nota NÃO é aprovada/emitida
// por aqui (decisão do Dhiefferton): isso continua no Zen.
//
// SEGURANÇA
//  - Idempotente: cada passo confere o estado real no Zen antes de agir (nota já existe? romaneio já PACKED?
//    volumes já existem?). Pode ser chamada de novo sem duplicar nada.
//  - Nunca lança erro: devolve { status, passo?, mensagem? }. Se um passo falha, a ordem fica na etapa onde
//    parou (reserva_finalizada / romaneio_finalizado / volume_definido) e é retomada pelo botão "Concluir no Zen"
//    do coletor ou pelo ciclo do poller.
//  - Trava por ordem (pedidos.baixa_processando_ate, lease de 90s): finalizar-reserva, botão e poller não
//    rodam juntos na mesma ordem. Sem a coluna, roda sem trava (como qualquer rota do sistema).
//  - Confere o perfil fiscal e a série da nota criada; se não forem os de baixa, NÃO conclui (nota criada
//    errada exige conferência humana) e avisa.
//  - Desligar: variável BAIXA_ESTOQUE_AUTOMATICA_DESLIGADO=1 na Vercel, ou a função 'baixa_estoque_automatica'
//    no painel (desligado = a ordem termina na reserva finalizada, como antes desta automação).
//  - Ids/texto podem ser trocados sem deploy de código pelas variáveis BAIXA_ESTOQUE_PERFIL_FISCAL_ID,
//    BAIXA_ESTOQUE_SERIE_ID e BAIXA_ESTOQUE_OBSERVACAO.
// ============================================================
const { flagAtiva } = require('./feature-flags');

const PERFIL_FISCAL_BAIXA_ID = Number(process.env.BAIXA_ESTOQUE_PERFIL_FISCAL_ID) || 1003; // fiscalProfileOperation "BaixaEstoque"
const SERIE_BAIXA_ID = Number(process.env.BAIXA_ESTOQUE_SERIE_ID) || 1007; // invoiceSeries CONTROLE/INTERNO (modelo 99)
const OBSERVACAO_BAIXA = process.env.BAIXA_ESTOQUE_OBSERVACAO || 'Baixa de estoque, para reposição de peças no Almoxarifado';
const ETAPAS_PENDENTES = ['reserva_finalizada', 'romaneio_finalizado', 'volume_definido'];
const LEASE_SEGUNDOS = 90;

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function automacaoLigada(pool, req) {
    if (process.env.BAIXA_ESTOQUE_AUTOMATICA_DESLIGADO === '1') return false;
    try {
        return await flagAtiva(pool, 'baixa_estoque_automatica', { colaboradorId: req?.usuario?.id, cargo: req?.usuario?.cargo });
    } catch (erro) {
        console.error('[baixa-estoque] falha ao ler a função (assumindo ligada):', erro.message);
        return true;
    }
}

// Chama o Zen; se der erro de resposta/timeout, confere o estado real antes de desistir (a operação pode
// ter acontecido mesmo assim - mesmo padrão das rotas da Separação).
async function chamarComVerificacao(chamada, conferir) {
    try {
        await chamada();
        return;
    } catch (erroChamada) {
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0) await aguardar(2000);
            if (await conferir().catch(() => false)) return;
        }
        throw erroChamada;
    }
}

function textoDoErro(erro) {
    const detalhe = erro?.response?.data;
    const msg = detalhe?.message || detalhe?.errors?.[0]?.message || (typeof detalhe === 'string' ? detalhe : null) || erro?.message || 'erro desconhecido';
    return String(msg).slice(0, 300);
}

async function pegarLease(pool, pedidoId) {
    try {
        const r = await pool.query(
            `UPDATE pedidos SET baixa_processando_ate = now() + ($2 || ' seconds')::interval
             WHERE id = $1 AND (baixa_processando_ate IS NULL OR baixa_processando_ate < now())
             RETURNING id`,
            [pedidoId, String(LEASE_SEGUNDOS)]
        );
        return r.rowCount > 0;
    } catch (erro) {
        if (erro?.code === '42703') return true; // coluna ainda não existe: segue sem trava
        throw erro;
    }
}

async function soltarLease(pool, pedidoId) {
    try {
        await pool.query(`UPDATE pedidos SET baixa_processando_ate = NULL WHERE id = $1`, [pedidoId]);
    } catch (_) {
        /* sem a coluna ou erro de rede: o lease expira sozinho */
    }
}

// Quantas unidades a ordem tem (1 volume por unidade, como no exemplo do Dhiefferton: 7 unidades = 7 volumes).
async function totalDeUnidades(pool, pedidoId) {
    const { rows } = await pool.query(
        `SELECT COALESCE(SUM(quantidade_separada), 0)::int AS separadas, COALESCE(SUM(quantidade_x), 0)::int AS pedidas
         FROM itens_pedido WHERE pedido_id = $1`,
        [pedidoId]
    );
    const n = rows[0]?.separadas || rows[0]?.pedidas || 1;
    return Math.max(1, n);
}

// zen = { zenErpGet, zenErpPost } (injetado pra não criar dependência circular com o poller)
// opcoes: { req, orcamentoMs } - orcamentoMs: não começa um passo novo depois desse tempo (a rota roda numa função
// serverless; o que sobrar fica pro botão/poller)
async function concluirBaixaEstoque(pool, zen, pedidoId, opcoes = {}) {
    const { zenErpGet, zenErpPost } = zen;
    const inicio = Date.now();
    const orcamentoMs = opcoes.orcamentoMs ?? 40000;
    const estourou = () => Date.now() - inicio > orcamentoMs;
    let passo = 'inicio';
    let lease = false;
    try {
        const { rows } = await pool.query(
            `SELECT p.id, p.numero_erp, p.outgoing_list_id, p.etapa_separacao,
                    COALESCE((to_jsonb(ps) ->> 'termina_ao_finalizar_reserva')::boolean, false) AS termina
             FROM pedidos p LEFT JOIN perfis_separacao ps ON ps.codigo = p.perfil_separacao_codigo
             WHERE p.id = $1`,
            [pedidoId]
        );
        const pedido = rows[0];
        if (!pedido || !pedido.termina) return { status: 'nao_aplicavel' };
        if (pedido.etapa_separacao === 'concluido_no_erp') return { status: 'concluido' };
        if (!ETAPAS_PENDENTES.includes(pedido.etapa_separacao)) return { status: 'nao_aplicavel' };
        if (!(await automacaoLigada(pool, opcoes.req))) return { status: 'desligado' };
        if (!pedido.outgoing_list_id) {
            return { status: 'pendente', passo, mensagem: 'A ordem não tem romaneio de saída no Zen - conclua o romaneio e a nota no Zen.' };
        }
        const romaneio = pedido.outgoing_list_id;

        lease = await pegarLease(pool, pedido.id);
        if (!lease) return { status: 'em_andamento', mensagem: 'Já tem outra execução concluindo essa baixa - aguarde alguns segundos.' };
        // outra execução pode ter terminado entre a leitura acima e a trava: relê a etapa
        const atual = await pool.query(`SELECT etapa_separacao FROM pedidos WHERE id = $1`, [pedido.id]);
        if (atual.rows[0]?.etapa_separacao === 'concluido_no_erp') return { status: 'concluido' };

        const statusRomaneio = async () => (await zenErpGet(`/material/outgoingList/${romaneio}`)).data?.status;
        const buscarNota = async () => {
            const r = await zenErpGet('/fiscal/outgoingInvoice', { q: `outgoingList.id==${romaneio}`, max: 1 });
            const lista = Array.isArray(r.data) ? r.data : r.data?.data || [];
            return lista[0] || null;
        };

        // 0. Já existe nota? (retomada) - pula os passos de romaneio/volume
        passo = 'conferir nota';
        let nota = await buscarNota();

        if (!nota) {
            // 1. Romaneio finalizado
            passo = 'finalizar romaneio';
            let st = await statusRomaneio();
            if (st !== 'PACKED') {
                if (st !== 'PICKED') {
                    return { status: 'pendente', passo, mensagem: `Romaneio ${romaneio} está com status "${st}" no Zen (esperado PICKED) - confira no Zen.` };
                }
                if (estourou()) return { status: 'pendente', passo, mensagem: 'Tempo esgotado; continua no próximo passo automático.' };
                await chamarComVerificacao(
                    () => zenErpPost(`/material/outgoingListOpPacked/${romaneio}`, {}),
                    async () => (await statusRomaneio()) === 'PACKED'
                );
                // o Zen pode demorar um instante para refletir o novo status: espera ate ~8s antes do proximo passo
                for (let i = 0; i < 4 && (await statusRomaneio().catch(() => null)) !== 'PACKED'; i++) await aguardar(2000);
            }
            await pool.query(`UPDATE pedidos SET etapa_separacao = 'romaneio_finalizado' WHERE id = $1 AND etapa_separacao = 'reserva_finalizada'`, [pedido.id]);

            // 2. Volumes
            passo = 'criar volumes';
            const listarVolumes = async () => {
                const r = await zenErpGet('/material/volume', { q: `outgoingList.id==${romaneio}` });
                return Array.isArray(r.data) ? r.data : r.data?.data || [];
            };
            let volumes = await listarVolumes();
            if (volumes.length === 0) {
                if (estourou()) return { status: 'pendente', passo, mensagem: 'Tempo esgotado; continua no próximo passo automático.' };
                const statusAntes = await statusRomaneio().catch(() => null);
                if (statusAntes && !['PICKED', 'PACKED'].includes(statusAntes)) {
                    return {
                        status: 'pendente', passo,
                        mensagem: `O romaneio ${romaneio} está com status "${statusAntes}" no Zen (para criar volumes precisa estar PICKED ou PACKED) e ainda não tem volumes - confira esse romaneio no Zen.`,
                    };
                }
                const quantidade = await totalDeUnidades(pool, pedido.id);
                await chamarComVerificacao(
                    () => zenErpPost(`/material/outgoingListOpVolumeCreateAuto/${romaneio}`, { quantity: quantidade }),
                    async () => (await listarVolumes()).length > 0
                );
                volumes = await listarVolumes();
                if (volumes.length === 0) {
                    return { status: 'pendente', passo, mensagem: `O Zen não criou os volumes do romaneio ${romaneio} - crie no Zen.` };
                }
            }
            await pool.query(
                `UPDATE pedidos SET etapa_separacao = 'volume_definido', volume_id = $2, volume_quantidade = $3 WHERE id = $1`,
                [pedido.id, volumes[0]?.id ?? null, volumes.length]
            );

            // 3. Nota fiscal (perfil Baixa estoque + série CONTROLE/INTERNO)
            passo = 'criar nota';
            if (estourou()) return { status: 'pendente', passo, mensagem: 'Tempo esgotado; continua no próximo passo automático.' };
            try {
                const resp = await zenErpPost(`/material/outgoingListOpOutgoingInvoiceCreate/${romaneio}`, {
                    fiscalProfileOperationId: PERFIL_FISCAL_BAIXA_ID,
                    invoiceSeriesId: SERIE_BAIXA_ID,
                });
                const d = resp?.data;
                const id = Array.isArray(d) ? d[0]?.id : d?.id;
                nota = id ? { id } : null;
            } catch (erroChamada) {
                // a nota pode ter sido criada mesmo com erro de resposta
                for (let tentativa = 0; tentativa < 3 && !nota; tentativa++) {
                    if (tentativa > 0) await aguardar(2000);
                    nota = await buscarNota().catch(() => null);
                }
                if (!nota) throw erroChamada;
            }
            if (!nota?.id) nota = await buscarNota();
            if (!nota?.id) {
                return { status: 'pendente', passo, mensagem: 'O Zen não devolveu a nota criada - confira no Zen.' };
            }
        }

        // 4. Confere perfil/série e grava a observação
        passo = 'observação da nota';
        let completa = (await zenErpGet(`/fiscal/outgoingInvoice/${nota.id}`)).data;
        const perfilId = Number(completa?.fiscalProfileOperation?.id);
        const serieId = Number(completa?.invoiceSeries?.id);
        if (perfilId !== PERFIL_FISCAL_BAIXA_ID || serieId !== SERIE_BAIXA_ID) {
            console.error(`[baixa-estoque] nota ${nota.id} do romaneio ${romaneio} criada com perfil ${perfilId} / série ${serieId} (esperado ${PERFIL_FISCAL_BAIXA_ID} / ${SERIE_BAIXA_ID})`);
            return {
                status: 'pendente', passo, notaId: nota.id,
                mensagem: `A nota ${nota.id} foi criada no Zen, mas NÃO com o perfil "Baixa estoque" / série CONTROLE/INTERNO. Confira e corrija no Zen (a ordem não foi concluída aqui).`,
            };
        }
        if ((completa?.properties?.comments || '') !== OBSERVACAO_BAIXA) {
            await zenErpPost('/fiscal/outgoingInvoice', { ...completa, properties: { ...(completa.properties || {}), comments: OBSERVACAO_BAIXA } }, 'PUT');
            completa = (await zenErpGet(`/fiscal/outgoingInvoice/${nota.id}`)).data;
            if ((completa?.properties?.comments || '') !== OBSERVACAO_BAIXA) {
                return { status: 'pendente', passo, notaId: nota.id, mensagem: `A nota ${nota.id} foi criada, mas não consegui gravar a observação - preencha no Zen.` };
            }
        }

        await pool.query(`UPDATE pedidos SET etapa_separacao = 'concluido_no_erp' WHERE id = $1`, [pedido.id]);
        console.log(`[baixa-estoque] ordem ${pedido.numero_erp}: romaneio ${romaneio} finalizado, volumes criados e nota ${nota.id} gerada (perfil Baixa estoque).`);
        return { status: 'concluido', notaId: nota.id };
    } catch (erro) {
        console.error(`[baixa-estoque] falha no passo "${passo}" (pedido ${pedidoId}):`, erro?.response?.data || erro.message);
        let extra = '';
        try {
            const { rows: r } = await pool.query(`SELECT outgoing_list_id FROM pedidos WHERE id = $1`, [pedidoId]);
            if (r[0]?.outgoing_list_id) {
                const st = (await zen.zenErpGet(`/material/outgoingList/${r[0].outgoing_list_id}`)).data?.status;
                extra = ` [status atual do romaneio no Zen: ${st ?? 'desconhecido'}]`;
            }
        } catch (_) {
            /* diagnostico e best effort */
        }
        return { status: 'pendente', passo, mensagem: `Falha ao ${passo} no Zen: ${textoDoErro(erro)}${extra}. Use "Concluir no Zen" pra tentar de novo (o que já foi feito não se repete).` };
    } finally {
        if (lease) await soltarLease(pool, pedidoId);
    }
}

// Retoma as baixas que pararam no meio (roda no ciclo do poller; nunca lança)
async function concluirBaixasPendentes(pool, zen, limite = 3) {
    try {
        if (!(await automacaoLigada(pool, null))) return { desligado: true };
        const { rows } = await pool.query(
            `SELECT p.id FROM pedidos p JOIN perfis_separacao ps ON ps.codigo = p.perfil_separacao_codigo
             WHERE p.etapa_separacao = ANY($1)
               AND COALESCE((to_jsonb(ps) ->> 'termina_ao_finalizar_reserva')::boolean, false)
             ORDER BY p.id LIMIT $2`,
            [ETAPAS_PENDENTES, limite]
        );
        const resultados = [];
        for (const r of rows) {
            resultados.push(await concluirBaixaEstoque(pool, zen, r.id, { orcamentoMs: 30000 }));
        }
        return { processadas: rows.length, resultados };
    } catch (erro) {
        console.error('[baixa-estoque] falha ao retomar baixas pendentes (não crítico):', erro.message);
        return { erro: erro.message };
    }
}

module.exports = { concluirBaixaEstoque, concluirBaixasPendentes, ETAPAS_PENDENTES, PERFIL_FISCAL_BAIXA_ID, SERIE_BAIXA_ID, OBSERVACAO_BAIXA };
