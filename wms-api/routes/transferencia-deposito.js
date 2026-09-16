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
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost } = require('../poller');
const { exigirCargo } = require('../auth');
const { reavaliarFilaPulmao } = require('../lib/pulmao');

const router = express.Router();

// Reserva fixa no ZenERP usada só pra esse fluxo - sempre fica
// "iniciada" lá, nunca é finalizada por aqui. Se um dia precisar
// trocar (reserva nova), é só mudar essa constante.
const RESERVATION_ID_TRANSFERENCIA_DEPOSITO = 22919;

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
                (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
            ]
        );
    } catch (erro) {
        console.error('Falha ao registrar movimentacao (nao critico):', erro);
    }
}

// POST /transferencia-deposito/bipar
// Body: { serial }
router.post('/bipar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const serialDigitado = String(req.body?.serial || '').trim();
    if (!serialDigitado) {
        return res.status(400).json({ erro: 'Informe o serial bipado' });
    }

    // Mesma extração de código de fábrica usada em separacao-erp.js
    // (bipar-serial) - ver comentário lá pro raciocínio completo,
    // incluindo a correção de 16/09/2026 (exige o formato completo
    // "P<numero>L<numero>S<numero>", não só o "S" isolado, senão um
    // serial puro tipo "BXS1087347" casa errado com o "S" do meio).
    const matchQrFabrica = serialDigitado.match(/P\d+L\d+S(\d+)/i);
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

        // 2. Aloca 1 unidade dessa linha na reserva fixa de transferência.
        await chamarComVerificacao(
            () => zenErpPost(
                `/material/reservationOpAllocateStock/${RESERVATION_ID_TRANSFERENCIA_DEPOSITO}?stockId=${linhaDisponivel.id}&quantity=1`,
                {}
            ),
            () => zenErpGet('/material/stock', { q: `id==${linhaDisponivel.id}`, max: 1 })
                .then((r) => r.data?.[0]?.reservation?.id ?? null),
            RESERVATION_ID_TRANSFERENCIA_DEPOSITO
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
                        } else {
                            // Mesmo cuidado de picking.js (/repor): cancela
                            // tarefa pendente que aponte pra esse pallet
                            // antes de apagar, senão o DELETE falha por FK.
                            await client.query(
                                `UPDATE tarefas_reposicao SET status = 'cancelada' WHERE pallet_origem_id = $1 AND status IN ('pendente', 'em_andamento')`,
                                [pallet.rows[0].id]
                            );
                            await client.query(
                                `UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada' WHERE pallet_origem_id = $1 AND status = 'pendente'`,
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
            // Destino sempre e a mesma reserva fixa do Zen (nunca um
            // endereco/pedido nosso) - usa um tipo proprio
            // ('reserva_zen') em vez de reaproveitar o 'externo'
            // generico (usado em remocao manual em enderecos.js e
            // unidades-serializadas.js), pra a tela de Historico poder
            // mostrar "Reserva 22919" em vez de um "Externo" mudo.
            // destino_id NAO leva RESERVATION_ID_TRANSFERENCIA_DEPOSITO:
            // essa coluna e uuid (referencia enderecos/pedidos/etc do
            // proprio WMS), e o id da reserva e um inteiro do ZenERP -
            // tipos incompativeis. Como so existe essa UNICA reserva
            // fixa pra esse fluxo inteiro, o numero fica hardcoded no
            // label do frontend (formatarLocal) em vez de vir do banco.
            destinoTipo: 'reserva_zen',
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
        });
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao processar transferência', detalhe: erro?.response?.data || erro.message });
    }
});

module.exports = router;
