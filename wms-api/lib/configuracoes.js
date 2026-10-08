// ============================================================
// Configurações gerais (Fase 7 do projeto de autonomia, 08/10/2026)
// ============================================================
// Valores de AJUSTE do sistema que antes ficavam fixos no código (e exigiam
// commit + deploy pra mudar) passam a poder ser alterados pelo painel
// (Controle de acesso > Configurações), com motivo, histórico e "restaurar
// padrão". Mesmo molde da Fase 5 (feature-flags.js) e da Fase 2 (menu-config.js).
//
// COMO FUNCIONA
//   - O CATÁLOGO mora em código (CONFIGS abaixo): só aparece no painel o que
//     foi cadastrado aqui, com tipo, limites e PADRÃO. O padrão é EXATAMENTE o
//     valor que estava fixo no código antes - sem nenhuma alteração salva, o
//     sistema se comporta igual a antes.
//   - Alterações ficam na tabela `configuracoes_sistema` (uma linha por chave;
//     valor NULL = "usar o padrão"). Cada mudança também entra em
//     `configuracoes_historico` (só insere, nunca apaga) e na auditoria central.
//   - No código de negócio: `await valor(pool, 'chave')` devolve o número
//     efetivo. Qualquer falha (banco fora, tabela inexistente, valor inválido
//     guardado) devolve o PADRÃO - nunca derruba a operação.
//
// SEGURANÇA / REVERSIBILIDADE
//   - tabelas PRÓPRIAS, criadas só no botão "Preparar configurações". Nunca
//     apaga linha: restaurar = valor NULL. RLS ligada, como as outras.
//   - Emergência: variável CONFIG_MODO=padrao na Vercel ignora tudo que foi
//     salvo no painel e usa só os padrões do código (vale mais que o painel).
//   - Não é lugar de credencial: senha, token e segredo continuam só nas
//     variáveis da Vercel (não existe tipo "segredo" aqui, de propósito).
//
// COMO CRIAR UMA CONFIGURAÇÃO NOVA
//   1. acrescente em CONFIGS { chave, grupo, nome, descricao, tipo: 'inteiro',
//      padrao, min, max, risco } - o padrão deve ser o valor que já valia;
//   2. no código, troque o valor fixo por `await valor(pool, 'chave')`;
//   3. pronto: a tela mostra sozinha (nada a mudar no painel).
// ============================================================

const TABELA = 'configuracoes_sistema';
const TABELA_HIST = 'configuracoes_historico';
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{1,59}$/;
const RISCOS = ['baixo', 'medio', 'alto'];
const TIPOS = ['inteiro'];

// CATÁLOGO. Os padrões abaixo são os valores que estavam fixos no código.
//   verificarZen: 'reserva' -> antes de salvar, confere no ZenERP se a reserva existe.
const CONFIGS = [
    {
        chave: 'reserva_zen_mercado_livre',
        grupo: 'Reservas do ZenERP por depósito (Transferência de Depósito)',
        nome: 'Reserva - Mercado Livre',
        descricao: 'Número da reserva fixa do ZenERP onde as unidades enviadas pro Mercado Livre são alocadas.',
        tipo: 'inteiro', padrao: 22919, min: 1, max: 99999999, risco: 'alto', verificarZen: 'reserva',
    },
    {
        chave: 'reserva_zen_engenharia',
        grupo: 'Reservas do ZenERP por depósito (Transferência de Depósito)',
        nome: 'Reserva - Engenharia',
        descricao: 'Número da reserva fixa do ZenERP pras transferências pro depósito Engenharia.',
        tipo: 'inteiro', padrao: 48981, min: 1, max: 99999999, risco: 'alto', verificarZen: 'reserva',
    },
    {
        chave: 'reserva_zen_assistencia_tecnica',
        grupo: 'Reservas do ZenERP por depósito (Transferência de Depósito)',
        nome: 'Reserva - Assistência Técnica',
        descricao: 'Número da reserva fixa do ZenERP pras transferências pro depósito Assistência Técnica.',
        tipo: 'inteiro', padrao: 50317, min: 1, max: 99999999, risco: 'alto', verificarZen: 'reserva',
    },
    {
        chave: 'reserva_zen_showroom',
        grupo: 'Reservas do ZenERP por depósito (Transferência de Depósito)',
        nome: 'Reserva - Showroom',
        descricao: 'Número da reserva fixa do ZenERP pras transferências pro depósito Showroom.',
        tipo: 'inteiro', padrao: 50318, min: 1, max: 99999999, risco: 'alto', verificarZen: 'reserva',
    },
    {
        chave: 'reserva_zen_almoxarifado',
        grupo: 'Reservas do ZenERP por depósito (Transferência de Depósito)',
        nome: 'Reserva - Almoxarifado',
        descricao: 'Número da reserva fixa do ZenERP pras transferências pro depósito Almoxarifado.',
        tipo: 'inteiro', padrao: 50319, min: 1, max: 99999999, risco: 'alto', verificarZen: 'reserva',
    },
    {
        chave: 'limite_skus_multi_picking',
        grupo: 'Picking',
        nome: 'Limite de modelos por posição multi-SKU',
        descricao: 'Quantos modelos (SKUs) diferentes podem dividir a mesma posição multi-SKU do picking. Diminuir não mexe no que já está guardado: só impede de colocar mais modelos além do novo limite.',
        tipo: 'inteiro', padrao: 10, min: 2, max: 50, risco: 'medio',
    },
];

const CACHE_MS = 10000;
let cachePreparado = null;
let cacheValores = null;

function limparCacheConfig() {
    cachePreparado = null;
    cacheValores = null;
}

function definicao(chave) {
    return CONFIGS.find((c) => c.chave === chave) || null;
}

function modoPadraoForcado() {
    return String(process.env.CONFIG_MODO || '').trim().toLowerCase() === 'padrao';
}

// Valida e converte o valor digitado. Devolve { ok: valor } ou { erro }.
function validarValor(def, bruto) {
    if (!def) return { erro: 'Configuração desconhecida' };
    if (def.tipo === 'inteiro') {
        const texto = String(bruto ?? '').trim();
        if (!/^-?\d{1,12}$/.test(texto)) return { erro: 'Informe um número inteiro' };
        const n = Number(texto);
        if (n < def.min || n > def.max) return { erro: `O valor precisa ficar entre ${def.min} e ${def.max}` };
        return { ok: n };
    }
    return { erro: 'Tipo de configuração não suportado' };
}

function registrarConfigs(lista) {
    for (const c of lista) {
        if (!CHAVE_VALIDA.test(String(c.chave || ''))) throw new Error(`Configuração com chave inválida: ${c.chave}`);
        if (CONFIGS.some((x) => x.chave === c.chave)) throw new Error(`Configuração repetida: ${c.chave}`);
        if (!TIPOS.includes(c.tipo)) throw new Error(`Tipo inválido em ${c.chave}`);
        if (c.risco && !RISCOS.includes(c.risco)) throw new Error(`Risco inválido em ${c.chave}`);
        const def = { risco: 'medio', grupo: 'Outras', descricao: '', nome: c.chave, ...c };
        const teste = validarValor(def, def.padrao);
        if (teste.erro) throw new Error(`Padrão inválido em ${c.chave}: ${teste.erro}`);
        CONFIGS.push(def);
    }
    limparCacheConfig();
}

async function configPreparado(pool) {
    const agora = Date.now();
    if (cachePreparado && cachePreparado.ate > agora) return cachePreparado.valor;
    let valor = false;
    try {
        const r = await pool.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS ok`);
        valor = Boolean(r.rows[0]?.ok);
    } catch (erro) {
        console.error('[configuracoes] não consegui conferir a tabela (usando padrões):', erro.message);
    }
    cachePreparado = { ate: agora + CACHE_MS, valor };
    return valor;
}

// Cria as tabelas (só adiciona; transação única; idempotente).
async function prepararConfig(pool) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(727004)');
        try {
            await client.query('BEGIN');
            const antes = await client.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS existe`);
            const criada = !antes.rows[0].existe;
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA} (
                chave          VARCHAR(60) PRIMARY KEY,
                valor          TEXT,
                motivo         TEXT,
                atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_por VARCHAR(120)
            )`);
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA_HIST} (
                id           BIGSERIAL PRIMARY KEY,
                chave        VARCHAR(60) NOT NULL,
                valor_antes  TEXT,
                valor_depois TEXT,
                motivo       TEXT,
                alterado_por VARCHAR(120),
                alterado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_${TABELA_HIST}_chave ON ${TABELA_HIST} (chave, id DESC)`);
            await client.query(`ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY`);
            await client.query(`ALTER TABLE ${TABELA_HIST} ENABLE ROW LEVEL SECURITY`);
            await client.query('COMMIT');
            limparCacheConfig();
            return { criada };
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            await client.query('SELECT pg_advisory_unlock(727004)').catch(() => {});
        }
    } finally {
        client.release();
    }
}

// chave -> valor salvo (texto). Em cache. Falha = nada salvo (vale o padrão).
async function lerSalvos(pool) {
    const agora = Date.now();
    if (cacheValores && cacheValores.ate > agora) return cacheValores.valor;
    const valor = new Map();
    try {
        if (!modoPadraoForcado() && (await configPreparado(pool))) {
            const { rows } = await pool.query(`SELECT chave, valor FROM ${TABELA} WHERE valor IS NOT NULL`);
            for (const r of rows) valor.set(r.chave, r.valor);
        }
    } catch (erro) {
        console.error('[configuracoes] falha ao ler os valores (usando padrões):', erro.message);
        valor.clear();
    }
    cacheValores = { ate: agora + CACHE_MS, valor };
    return valor;
}

// O valor efetivo de uma configuração. NUNCA lança: qualquer problema devolve o padrão.
async function valor(pool, chave) {
    const def = definicao(chave);
    if (!def) throw new Error(`Configuração desconhecida: ${chave}`); // erro de programação, não de dado
    try {
        const salvos = await lerSalvos(pool);
        if (salvos.has(chave)) {
            const v = validarValor(def, salvos.get(chave));
            if (!v.erro) return v.ok;
            console.error(`[configuracoes] valor salvo inválido em ${chave} (usando o padrão):`, v.erro);
        }
    } catch (erro) {
        console.error('[configuracoes] falha ao decidir o valor (usando o padrão):', erro.message);
    }
    return def.padrao;
}

// ------------------------------------------------------------
// Painel
// ------------------------------------------------------------
async function catalogoParaPainel(pool) {
    const preparado = await configPreparado(pool);
    let linhas = [];
    if (preparado) {
        linhas = (await pool.query(`SELECT chave, valor, motivo, atualizado_em, atualizado_por FROM ${TABELA}`)).rows;
    }
    return {
        preparado,
        modoPadraoForcado: modoPadraoForcado(),
        configuracoes: CONFIGS.map((c) => {
            const l = linhas.find((x) => x.chave === c.chave);
            const salvoValido = l && l.valor !== null && !validarValor(c, l.valor).erro;
            return {
                chave: c.chave,
                grupo: c.grupo,
                nome: c.nome,
                descricao: c.descricao,
                tipo: c.tipo,
                padrao: c.padrao,
                min: c.min,
                max: c.max,
                risco: c.risco,
                verificaNoZen: Boolean(c.verificarZen),
                salvo: l && l.valor !== null ? l.valor : null,
                efetivo: salvoValido && !modoPadraoForcado() ? validarValor(c, l.valor).ok : c.padrao,
                motivo: l?.motivo || null,
                atualizadoEm: l?.atualizado_em || null,
                atualizadoPor: l?.atualizado_por || null,
            };
        }),
    };
}

// Confere no ZenERP se a reserva existe (só pra configs com verificarZen).
// Só RECUSA quando o Zen responde "não existe". Se o Zen estiver fora ou
// responder estranho, deixa salvar mas avisa (devolve aviso).
async function verificarReservaNoZen(zenErpGet, numero) {
    try {
        const r = await zenErpGet('/material/reservation', { q: `id==${numero}`, max: 1 });
        const lista = Array.isArray(r.data) ? r.data : r.data?.data || [];
        if (lista.length === 0) return { existe: false };
        return { existe: true, status: lista[0]?.status ?? null };
    } catch (erro) {
        return { indisponivel: true, motivo: erro?.response?.status ? `HTTP ${erro.response.status}` : erro.message };
    }
}

// Grava o valor (ou NULL = restaurar padrão). Devolve { antes, depois } (texto|null).
async function salvarValor(pool, chave, novoValor, usuarioNome, motivo) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const atual = await client.query(`SELECT valor FROM ${TABELA} WHERE chave = $1 FOR UPDATE`, [chave]);
        const antes = atual.rows[0]?.valor ?? null;
        const depois = novoValor === null ? null : String(novoValor);
        await client.query(
            `INSERT INTO ${TABELA} (chave, valor, motivo, atualizado_por)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (chave) DO UPDATE
             SET valor = EXCLUDED.valor, motivo = EXCLUDED.motivo, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
            [chave, depois, motivo || null, usuarioNome || null]
        );
        if (antes !== depois) {
            await client.query(
                `INSERT INTO ${TABELA_HIST} (chave, valor_antes, valor_depois, motivo, alterado_por) VALUES ($1, $2, $3, $4, $5)`,
                [chave, antes, depois, motivo || null, usuarioNome || null]
            );
        }
        await client.query('COMMIT');
        limparCacheConfig();
        return { antes, depois };
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }
}

async function historico(pool, chave, limite = 50) {
    const l = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
    const { rows } = await pool.query(
        `SELECT id, valor_antes, valor_depois, motivo, alterado_por, alterado_em
         FROM ${TABELA_HIST} WHERE chave = $1 ORDER BY id DESC LIMIT $2`,
        [chave, l]
    );
    return rows.map((r) => ({
        id: r.id,
        antes: r.valor_antes,
        depois: r.valor_depois,
        motivo: r.motivo,
        alteradoPor: r.alterado_por,
        alteradoEm: r.alterado_em,
    }));
}

module.exports = {
    CONFIGS,
    registrarConfigs,
    definicao,
    validarValor,
    limparCacheConfig,
    configPreparado,
    prepararConfig,
    valor,
    catalogoParaPainel,
    verificarReservaNoZen,
    salvarValor,
    historico,
};
