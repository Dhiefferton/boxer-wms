// ============================================================
// Feature flags (Fase 5 do Controle de acesso, 06/10/2026)
// ============================================================
// Liga e desliga FUNÇÕES do sistema pelo painel (Controle de acesso > Funções),
// sem mexer em código e sem publicar de novo: pra todo mundo, por perfil ou por
// pessoa. Serve pra liberar uma função nova aos poucos (primeiro só pra você,
// depois pro perfil, depois pra todos) e pra desligar rápido se algo der errado.
//
// COMO FUNCIONA
//   - O CATÁLOGO de flags mora em código (FLAGS abaixo): cada função nova que
//     nascer com risco já nasce com uma flag. O painel só liga/desliga o que
//     está no catálogo - não existe "flag solta" sem código por trás.
//   - Cada flag tem um PADRÃO (ligada ou desligada). Sem nenhuma regra salva,
//     vale o padrão: o sistema se comporta exatamente como o código manda.
//   - Regras (tabela feature_flags_regras), da mais forte pra mais fraca:
//       pessoa  >  perfil  >  global  >  padrão do catálogo
//     Cada regra é Ligada, Desligada ou "herdar" (NULL = sem regra naquele nível).
//   - No back-end: exigirFlag('chave') barra a rota (403 flagDesativada) e
//     flagAtiva(...) responde sim/não. No front: useAuth().flag('chave').
//
// UMA FLAG NUNCA DÁ PERMISSÃO
//   Flag só decide se a função EXISTE pra pessoa. Quem pode usar continua sendo
//   o controle de permissões (perfis/exceções): função ligada + sem permissão =
//   continua barrado. Por isso exigirFlag() sempre vem JUNTO das checagens de
//   acesso, nunca no lugar delas.
//
// SEGURANÇA / REVERSIBILIDADE
//   - tabela PRÓPRIA, criada só no botão "Preparar funções" (não entra na lista
//     de tabelas do núcleo do controle de acesso, pra não mudar o "banco
//     preparado" já em uso). Nunca apaga linhas: "herdar" = NULL.
//   - se o banco falhar ou a tabela não existir, vale o PADRÃO do catálogo
//     (por isso o padrão de função nova deve ser o lado seguro: desligada).
//   - Emergência: variável FLAGS_MODO=padrao na Vercel ignora todas as regras
//     do painel e usa só o padrão do catálogo (vale mais que o painel).
//   - toda mudança é auditada (antes e depois, quem, quando, IP).
//
// COMO CRIAR UMA FLAG NOVA (quando houver uma função nova com risco)
//   1. acrescente em FLAGS: { chave: 'minha_funcao', nome, descricao, padrao: false, risco: 'medio' }
//   2. proteja a rota nova com exigirFlag('minha_funcao') (e as permissões de sempre)
//   3. no front, mostre a tela/botão só se flag('minha_funcao')
//   4. abra Controle de acesso > Funções, ligue pra você, teste, depois libere.
// ============================================================

// CATÁLOGO. Vazio de propósito: a Fase 5 entrega só a infraestrutura; nenhuma
// tela existente depende de flag. Formato de cada item:
//   { chave: 'a-z0-9_', nome: 'Nome curto', descricao: 'O que liga/desliga',
//     padrao: false, risco: 'baixo' | 'medio' | 'alto' }
const FLAGS = [
    // Fase 7 (08/10/2026): as duas automações com o ZenERP que já rodam em produção
    // viram flags. padrao: true = comportamento ATUAL (sem regra salva, nada muda).
    // Desligar no painel = mesmo efeito das variáveis de emergência
    // (ENVIO_AUTOMATICO_DESLIGADO=1 / RECEBIMENTO_MAQ_AUTO_DESLIGADO=1), que
    // continuam valendo e têm prioridade.
    {
        chave: 'envio_automatico_zen',
        nome: 'Avançar envio no Zen automaticamente',
        descricao: 'Quando o último pedido de um envio é embarcado, o WMS prepara/aprova o envio no ZenERP sozinho. Desligado: o envio fica pra finalizar manualmente na tela de Envios.',
        padrao: true,
        risco: 'medio',
    },
    {
        chave: 'transferencia_entre_depositos',
        nome: 'Transferir serial entre depósitos',
        descricao: 'Permite bipar na Transferência de Depósito um serial que já foi transferido para outro depósito: o WMS desfaz a alocação na reserva do depósito antigo no ZenERP e aloca na reserva do novo. Desligado: o sistema volta a bloquear serial já transferido.',
        padrao: true,
        risco: 'medio',
    },
    {
        chave: 'recebimento_maq_automatico',
        nome: 'Mover RECEBIMENTO para MAQ automaticamente',
        descricao: 'Ao confirmar um item no recebimento de NF, o WMS move a linha de estoque do endereço RECEBIMENTO para MAQ no ZenERP. Desligado: o botão manual continua disponível.',
        padrao: true,
        risco: 'medio',
    },
];

const TABELA = 'feature_flags_regras';
const TIPOS = ['global', 'perfil', 'pessoa'];
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{1,59}$/;
const RISCOS = ['baixo', 'medio', 'alto'];

const CACHE_MS = 10000;
let cachePreparado = null;
let cacheRegras = null;
const cachePerfis = new Map(); // colaboradorId -> { ate, perfil }

function limparCacheFlags() {
    cachePreparado = null;
    cacheRegras = null;
    cachePerfis.clear();
}

// Registra flags extras (usado por testes e por módulos futuros). Valida o formato.
function registrarFlags(lista) {
    for (const f of lista) {
        if (!CHAVE_VALIDA.test(String(f.chave || ''))) throw new Error(`Flag com chave inválida: ${f.chave}`);
        if (FLAGS.some((x) => x.chave === f.chave)) throw new Error(`Flag repetida: ${f.chave}`);
        if (f.risco && !RISCOS.includes(f.risco)) throw new Error(`Risco inválido em ${f.chave}`);
        FLAGS.push({
            chave: f.chave,
            nome: f.nome || f.chave,
            descricao: f.descricao || '',
            padrao: f.padrao === true,
            risco: f.risco || 'medio',
        });
    }
    limparCacheFlags();
}

function definicao(chave) {
    return FLAGS.find((f) => f.chave === chave) || null;
}

function modoPadraoForcado() {
    return String(process.env.FLAGS_MODO || '').trim().toLowerCase() === 'padrao';
}

async function flagsPreparado(pool) {
    const agora = Date.now();
    if (cachePreparado && cachePreparado.ate > agora) return cachePreparado.valor;
    let valor = false;
    try {
        const r = await pool.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS ok`);
        valor = Boolean(r.rows[0]?.ok);
    } catch (erro) {
        console.error('[feature-flags] não consegui conferir a tabela das flags (usando padrões):', erro.message);
    }
    cachePreparado = { ate: agora + CACHE_MS, valor };
    return valor;
}

// Cria a tabela (só adiciona; transação única; idempotente).
async function prepararFlags(pool) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(727003)');
        try {
            await client.query('BEGIN');
            const antes = await client.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS existe`);
            const criada = !antes.rows[0].existe;
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA} (
                chave          VARCHAR(60) NOT NULL,
                escopo_tipo    VARCHAR(10) NOT NULL CHECK (escopo_tipo IN ('global', 'perfil', 'pessoa')),
                escopo_valor   VARCHAR(60) NOT NULL,
                ativo          BOOLEAN,
                motivo         TEXT,
                atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_por VARCHAR(120),
                PRIMARY KEY (chave, escopo_tipo, escopo_valor)
            )`);
            await client.query(`ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY`);
            await client.query('COMMIT');
            limparCacheFlags();
            return { criada };
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            await client.query('SELECT pg_advisory_unlock(727003)').catch(() => {});
        }
    } finally {
        client.release();
    }
}

// Todas as regras com valor (ativo não nulo), agrupadas por flag. Em cache.
// Falha = sem regras (vale o padrão).
async function lerRegras(pool) {
    const agora = Date.now();
    if (cacheRegras && cacheRegras.ate > agora) return cacheRegras.valor;
    const valor = new Map(); // chave -> [{ tipo, valor, ativo }]
    try {
        if (!modoPadraoForcado() && (await flagsPreparado(pool))) {
            const { rows } = await pool.query(`SELECT chave, escopo_tipo, escopo_valor, ativo FROM ${TABELA} WHERE ativo IS NOT NULL`);
            for (const r of rows) {
                if (!valor.has(r.chave)) valor.set(r.chave, []);
                valor.get(r.chave).push({ tipo: r.escopo_tipo, valor: r.escopo_valor, ativo: r.ativo });
            }
        }
    } catch (erro) {
        console.error('[feature-flags] falha ao ler as regras (usando padrões do catálogo):', erro.message);
        valor.clear();
    }
    cacheRegras = { ate: agora + CACHE_MS, valor };
    return valor;
}

// Decide uma flag pra uma pessoa. Devolve { ativo, origem }.
//   origem: 'pessoa' | 'perfil' | 'global' | 'padrao'
function decidir(def, regras, { colaboradorId, perfil }) {
    const lista = regras || [];
    if (colaboradorId !== undefined && colaboradorId !== null) {
        const r = lista.find((x) => x.tipo === 'pessoa' && x.valor === String(colaboradorId));
        if (r) return { ativo: r.ativo, origem: 'pessoa' };
    }
    if (perfil) {
        const r = lista.find((x) => x.tipo === 'perfil' && x.valor === perfil);
        if (r) return { ativo: r.ativo, origem: 'perfil' };
    }
    const g = lista.find((x) => x.tipo === 'global');
    if (g) return { ativo: g.ativo, origem: 'global' };
    return { ativo: def.padrao, origem: 'padrao' };
}

// Perfil da pessoa (chave do perfil de acesso). Sem o banco do núcleo preparado,
// é o cargo. Em cache curto.
async function perfilDoColaborador(pool, colaboradorId, cargo) {
    const agora = Date.now();
    const c = cachePerfis.get(colaboradorId);
    if (c && c.ate > agora) return c.perfil;
    let perfil = cargo || null;
    try {
        const { lerEstado } = require('./permissoes');
        const estado = await lerEstado(pool);
        if (estado.preparado) {
            const r = await pool.query(
                `SELECT COALESCE(cp.perfil, c.cargo) AS perfil
                 FROM colaboradores c LEFT JOIN colaborador_perfil cp ON cp.colaborador_id = c.id
                 WHERE c.id = $1`,
                [colaboradorId]
            );
            if (r.rows[0]?.perfil) perfil = r.rows[0].perfil;
        }
    } catch (erro) {
        console.error('[feature-flags] não consegui achar o perfil (usando o cargo):', erro.message);
    }
    cachePerfis.set(colaboradorId, { ate: agora + CACHE_MS, perfil });
    return perfil;
}

// A flag está ligada pra essa pessoa? Flag que não existe no catálogo = desligada.
async function flagAtiva(pool, chave, { colaboradorId, cargo, perfil } = {}) {
    const def = definicao(chave);
    if (!def) return false;
    try {
        const regras = await lerRegras(pool);
        const p = perfil || (colaboradorId != null ? await perfilDoColaborador(pool, colaboradorId, cargo) : cargo);
        return decidir(def, regras.get(chave), { colaboradorId, perfil: p }).ativo;
    } catch (erro) {
        console.error('[feature-flags] falha ao decidir a flag (usando o padrão):', erro.message);
        return def.padrao;
    }
}

// Middleware: barra a rota se a função está desligada pra pessoa logada.
// Use SEMPRE junto das checagens de permissão (flag não dá acesso).
function exigirFlag(pool, chave) {
    let avisou = false;
    return async function (req, res, next) {
        try {
            if (!definicao(chave) && !avisou) {
                // erro de programação: falha fechada e avisa (uma vez) no log
                avisou = true;
                console.error(`[feature-flags] exigirFlag('${chave}') usa uma flag que não está no catálogo - rota fechada`);
            }
            const u = req.usuario || {};
            const ativa = await flagAtiva(pool, chave, { colaboradorId: u.id, cargo: u.cargo });
            if (!ativa) {
                return res.status(403).json({ erro: 'Esta função está desativada no momento.', flagDesativada: true, flag: chave });
            }
            next();
        } catch (erro) {
            console.error(erro);
            res.status(500).json({ erro: 'Falha ao conferir a função' });
        }
    };
}

// O que o front recebe: { chave: true|false } de TODAS as flags do catálogo,
// já resolvido pra essa pessoa. Sempre devolve objeto (vazio se não há flags).
async function flagsParaFront(pool, colaborador, perfil) {
    const saida = {};
    if (FLAGS.length === 0) return saida;
    const regras = await lerRegras(pool);
    for (const f of FLAGS) {
        saida[f.chave] = decidir(f, regras.get(f.chave), { colaboradorId: colaborador.id, perfil: perfil || colaborador.cargo }).ativo;
    }
    return saida;
}

// ------------------------------------------------------------
// Painel
// ------------------------------------------------------------
async function catalogoParaPainel(pool) {
    const preparado = await flagsPreparado(pool);
    let linhas = [];
    if (preparado) {
        const r = await pool.query(
            `SELECT chave, escopo_tipo, escopo_valor, ativo, motivo, atualizado_em, atualizado_por FROM ${TABELA} ORDER BY chave, escopo_tipo, escopo_valor`
        );
        linhas = r.rows;
    }
    return {
        preparado,
        modoPadraoForcado: modoPadraoForcado(),
        flags: FLAGS.map((f) => {
            const regras = linhas.filter((l) => l.chave === f.chave);
            const global = regras.find((l) => l.escopo_tipo === 'global');
            return {
                chave: f.chave,
                nome: f.nome,
                descricao: f.descricao,
                padrao: f.padrao,
                risco: f.risco,
                global: global && global.ativo !== null ? global.ativo : null,
                regras: regras
                    .filter((l) => l.escopo_tipo !== 'global')
                    .map((l) => ({
                        tipo: l.escopo_tipo,
                        valor: l.escopo_valor,
                        ativo: l.ativo,
                        motivo: l.motivo,
                        atualizadoEm: l.atualizado_em,
                        atualizadoPor: l.atualizado_por,
                    })),
            };
        }),
    };
}

// Valida o que veio do painel. Devolve { ok: [{ tipo, valor, ativo }] } ou { erro }.
async function validarRegras(pool, chave, lista) {
    if (!definicao(chave)) return { erro: 'Função desconhecida' };
    if (!Array.isArray(lista) || lista.length === 0) return { erro: 'Informe as regras a alterar' };
    if (lista.length > 300) return { erro: 'Regras demais numa só alteração' };
    const vistas = new Set();
    const ok = [];
    for (const x of lista) {
        const tipo = String(x?.tipo || '');
        if (!TIPOS.includes(tipo)) return { erro: `Tipo de regra inválido: ${tipo}` };
        if (x.ativo !== true && x.ativo !== false && x.ativo !== null) return { erro: 'Cada regra precisa ser ligada (true), desligada (false) ou herdar (null)' };
        let valor = String(x?.valor ?? '');
        if (tipo === 'global') {
            valor = '*';
        } else if (tipo === 'pessoa') {
            if (!/^\d{1,9}$/.test(valor)) return { erro: `Pessoa inválida: ${valor}` };
            const r = await pool.query(`SELECT 1 FROM colaboradores WHERE id = $1`, [Number(valor)]);
            if (r.rowCount === 0) return { erro: `Colaborador não encontrado: ${valor}` };
        } else if (tipo === 'perfil') {
            if (!/^[a-z0-9_]{1,30}$/.test(valor)) return { erro: `Perfil inválido: ${valor}` };
            const { lerEstado, CARGOS_SISTEMA } = require('./permissoes');
            const estado = await lerEstado(pool);
            let existe = CARGOS_SISTEMA.includes(valor) || valor === 'admin';
            if (!existe && estado.preparado) {
                existe = (await pool.query(`SELECT 1 FROM perfis_acesso WHERE chave = $1`, [valor])).rowCount > 0;
            }
            if (!existe) return { erro: `Perfil não encontrado: ${valor}` };
        }
        const k = `${tipo}:${valor}`;
        if (vistas.has(k)) return { erro: `Regra repetida: ${k}` };
        vistas.add(k);
        const motivo = x?.motivo ? String(x.motivo).slice(0, 500) : null;
        ok.push({ tipo, valor, ativo: x.ativo, motivo });
    }
    return { ok };
}

// Grava (upsert). Devolve { antes, depois } só do que mudou.
async function salvarRegras(pool, chave, regras, usuarioNome, motivoGeral) {
    const client = await pool.connect();
    try {
        const atuais = (
            await client.query(`SELECT escopo_tipo, escopo_valor, ativo FROM ${TABELA} WHERE chave = $1`, [chave])
        ).rows;
        await client.query('BEGIN');
        for (const r of regras) {
            await client.query(
                `INSERT INTO ${TABELA} (chave, escopo_tipo, escopo_valor, ativo, motivo, atualizado_por)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (chave, escopo_tipo, escopo_valor) DO UPDATE
                 SET ativo = EXCLUDED.ativo, motivo = EXCLUDED.motivo, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
                [chave, r.tipo, r.valor, r.ativo, r.motivo || motivoGeral || null, usuarioNome || null]
            );
        }
        await client.query('COMMIT');
        limparCacheFlags();
        const antes = [];
        const depois = [];
        for (const r of regras) {
            const a = atuais.find((x) => x.escopo_tipo === r.tipo && x.escopo_valor === r.valor);
            const antigo = a ? a.ativo : null;
            if (antigo !== r.ativo) {
                antes.push({ tipo: r.tipo, valor: r.valor, ativo: antigo });
                depois.push({ tipo: r.tipo, valor: r.valor, ativo: r.ativo });
            }
        }
        return { antes, depois };
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }
}

// "Testar para": como a flag fica pra uma pessoa e por quê.
async function testarParaPessoa(pool, chave, colaboradorId) {
    const def = definicao(chave);
    if (!def) return null;
    const c = await pool.query(`SELECT id, nome, cargo FROM colaboradores WHERE id = $1`, [colaboradorId]);
    if (c.rowCount === 0) return { naoEncontrado: true };
    const col = c.rows[0];
    limparCacheFlags();
    const perfil = await perfilDoColaborador(pool, col.id, col.cargo);
    const regras = await lerRegras(pool);
    const r = decidir(def, regras.get(chave), { colaboradorId: col.id, perfil });
    return { colaborador: { id: col.id, nome: col.nome }, perfil, ativo: r.ativo, origem: r.origem, modoPadraoForcado: modoPadraoForcado() };
}

module.exports = {
    FLAGS,
    TIPOS,
    registrarFlags,
    limparCacheFlags,
    flagsPreparado,
    prepararFlags,
    lerRegras,
    decidir,
    flagAtiva,
    exigirFlag,
    flagsParaFront,
    catalogoParaPainel,
    validarRegras,
    salvarRegras,
    testarParaPessoa,
};
