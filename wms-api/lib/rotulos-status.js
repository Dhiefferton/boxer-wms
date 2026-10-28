// ============================================================
// Rótulos dos status (Fase 8A do projeto de autonomia, 28/10/2026)
// ============================================================
// Permite mudar, pelo painel (Controle de acesso > Rótulos de status), COMO os
// status aparecem nas telas: o texto, a cor do selo, a ordem e se o status
// aparece nos filtros. O VALOR INTERNO do status (ex.: 'nota_liberada') NUNCA
// muda: poller, baixa de estoque, conferência, Zen e CHECKs do banco continuam
// usando o valor de sempre. Só a exibição é personalizável.
//
// COMO FUNCIONA
//   - O CATÁLOGO mora em código (GRUPOS abaixo): só aparece no painel o que foi
//     cadastrado aqui. O padrão é o texto que as telas já mostravam.
//   - Sem nada salvo, as telas usam os textos que já têm no próprio código
//     (o front só troca o texto quando existe uma personalização salva).
//   - Personalizações ficam em `rotulos_status` (uma linha por grupo+valor; cada
//     campo NULL = "usar o padrão"). Cada mudança entra em
//     `rotulos_status_historico` (só insere) e na auditoria central.
//
// SEGURANÇA / REVERSIBILIDADE
//   - tabelas PRÓPRIAS, criadas só no botão "Preparar rótulos". Nunca apaga linha:
//     restaurar = campos NULL. RLS ligada, como as outras.
//   - Emergência: ROTULOS_MODO=padrao na Vercel ignora tudo que foi salvo.
//   - Função (flag) `rotulos_status_personalizados` liga/desliga pelo painel.
//   - Cor só pode ser uma das classes de selo que o sistema já tem (sem CSS livre).
//   - Qualquer falha (banco fora, tabela ausente, valor salvo inválido) = padrão.
//
// COMO CRIAR UM GRUPO/STATUS NOVO NO CATÁLOGO
//   1. acrescente em GRUPOS { chave, nome, descricao, recursos, itens: [{ valor, rotulo, ... }] };
//   2. no front, troque o texto fixo por `rotuloDe('grupo', 'valor', textoAtual)`.
// ============================================================

const TABELA = 'rotulos_status';
const TABELA_HIST = 'rotulos_status_historico';
const LOCK = 727010;

// Classes de selo que já existem no CSS (global.css .badge.*).
const CORES = ['accent', 'warning', 'success', 'danger', 'neutro'];
const NOMES_COR = { accent: 'Azul', warning: 'Amarelo', success: 'Verde', danger: 'Vermelho', neutro: 'Cinza' };

// recursos: o que dá pra personalizar naquele grupo (e que a tela já usa).
//   rotulo       texto do status
//   rotuloFiltro texto alternativo usado nos filtros/cartões de resumo
//   cor          classe do selo
//   ordem        ordem em que aparece nos filtros/cartões
//   visivel      aparece (ou não) nos filtros/cartões - nunca esconde o dado
const GRUPOS = [
    {
        chave: 'etapa_pedido',
        nome: 'Etapas da ordem de separação (coletor)',
        descricao: 'Texto da etapa em que a ordem está, mostrado no coletor (Separação). O valor interno da etapa não muda.',
        recursos: ['rotulo'],
        itens: [
            { valor: 'pendente', rotulo: 'Aguardando iniciar reserva' },
            { valor: 'reserva_iniciada', rotulo: 'Reserva iniciada' },
            { valor: 'estoque_alocado', rotulo: 'Estoque alocado' },
            { valor: 'reserva_finalizada', rotulo: 'Reserva finalizada' },
            { valor: 'volume_definido', rotulo: 'Volume definido' },
            { valor: 'romaneio_finalizado', rotulo: 'Romaneio finalizado' },
            { valor: 'nota_liberada', rotulo: 'Nota liberada - concluido' },
            { valor: 'embarque_liberado', rotulo: 'Embarque liberado' },
            { valor: 'concluido_no_erp', rotulo: 'Reserva finalizada - concluída' },
            { valor: 'processado_externamente', rotulo: 'Finalizado no Zen' },
            { valor: 'revertido_no_zen', rotulo: 'OS revertida no Zen' },
        ],
    },
    {
        chave: 'status_pedido',
        nome: 'Status das ordens no Acompanhamento (dashboard)',
        descricao: 'Selo de cada ordem e cartões de resumo da tela Acompanhamento de ordens de separação.',
        recursos: ['rotulo', 'rotuloFiltro', 'cor', 'ordem', 'visivel'],
        itens: [
            { valor: 'aberto', rotulo: 'Aberto', rotuloFiltro: 'Em aberto', cor: 'accent' },
            { valor: 'parcial', rotulo: 'Parcial', rotuloFiltro: 'Em andamento', cor: 'warning' },
            { valor: 'completo', rotulo: 'Completo', rotuloFiltro: 'Concluídas', cor: 'success' },
            { valor: 'cancelado', rotulo: 'Finalizado no Zen', rotuloFiltro: 'Finalizadas no Zen', cor: 'neutro' },
            { valor: 'revertido', rotulo: 'OS revertida no Zen', rotuloFiltro: 'OS revertida no Zen', cor: 'danger' },
        ],
    },
    {
        chave: 'status_unidade',
        nome: 'Status das unidades serializadas (dashboard)',
        descricao: 'Texto do status na tela Unidades e nas opções do filtro de status.',
        recursos: ['rotulo', 'ordem', 'visivel'],
        itens: [
            { valor: 'em_estoque', rotulo: 'Em estoque' },
            { valor: 'separado', rotulo: 'Separado' },
            { valor: 'expedido', rotulo: 'Expedido' },
            { valor: 'pendente', rotulo: 'Pendente' },
            { valor: 'removido', rotulo: 'Removido' },
        ],
    },
];

// padrão de ordem = posição no catálogo (1, 2, 3...)
for (const g of GRUPOS) g.itens.forEach((it, i) => { it.ordem = i + 1; });

const CAMPOS = ['rotulo', 'rotuloFiltro', 'cor', 'ordem', 'visivel'];
const COLUNA = { rotulo: 'rotulo', rotuloFiltro: 'rotulo_filtro', cor: 'cor', ordem: 'ordem', visivel: 'visivel' };

const CACHE_MS = 10000;
let cachePreparado = null;
let cacheSalvos = null;

function limparCacheRotulos() {
    cachePreparado = null;
    cacheSalvos = null;
}

function modoPadraoForcado() {
    return String(process.env.ROTULOS_MODO || '').trim().toLowerCase() === 'padrao';
}

function grupo(chave) {
    return GRUPOS.find((g) => g.chave === chave) || null;
}

function item(chaveGrupo, valor) {
    const g = grupo(chaveGrupo);
    return g ? g.itens.find((i) => i.valor === valor) || null : null;
}

// Valida UM campo. Devolve { ok: valor } (ok pode ser null = voltar ao padrão) ou { erro }.
function validarCampo(g, campo, bruto) {
    if (!g.recursos.includes(campo)) return { erro: `Este grupo não permite personalizar "${campo}"` };
    if (bruto === null || bruto === '') return { ok: null };
    if (campo === 'rotulo' || campo === 'rotuloFiltro') {
        const t = String(bruto).replace(/\s+/g, ' ').trim();
        if (t.length < 1) return { ok: null };
        if (t.length > 40) return { erro: 'O texto pode ter no máximo 40 caracteres' };
        // eslint-disable-next-line no-control-regex
        if (/[<>\u0000-\u001f]/.test(t)) return { erro: 'O texto tem caracteres não permitidos' };
        return { ok: t };
    }
    if (campo === 'cor') {
        const c = String(bruto).trim();
        if (!CORES.includes(c)) return { erro: `Cor inválida (use ${CORES.join(', ')})` };
        return { ok: c };
    }
    if (campo === 'ordem') {
        const texto = String(bruto).trim();
        if (!/^\d{1,3}$/.test(texto)) return { erro: 'A ordem é um número inteiro de 1 a 999' };
        const n = Number(texto);
        if (n < 1 || n > 999) return { erro: 'A ordem é um número inteiro de 1 a 999' };
        return { ok: n };
    }
    if (campo === 'visivel') {
        if (bruto === true || bruto === 'true') return { ok: true };
        if (bruto === false || bruto === 'false') return { ok: false };
        return { erro: 'Visível deve ser verdadeiro ou falso' };
    }
    return { erro: 'Campo desconhecido' };
}

async function rotulosPreparado(pool) {
    const agora = Date.now();
    if (cachePreparado && cachePreparado.ate > agora) return cachePreparado.valor;
    let valor = false;
    try {
        const r = await pool.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS ok`);
        valor = Boolean(r.rows[0]?.ok);
    } catch (erro) {
        console.error('[rotulos-status] não consegui conferir a tabela (usando padrões):', erro.message);
    }
    cachePreparado = { ate: agora + CACHE_MS, valor };
    return valor;
}

// Cria as tabelas (só adiciona; transação única; idempotente).
async function prepararRotulos(pool) {
    const client = await pool.connect();
    try {
        await client.query(`SELECT pg_advisory_lock(${LOCK})`);
        try {
            await client.query('BEGIN');
            const antes = await client.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS existe`);
            const criada = !antes.rows[0].existe;
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA} (
                grupo          VARCHAR(40) NOT NULL,
                valor          VARCHAR(60) NOT NULL,
                rotulo         VARCHAR(60),
                rotulo_filtro  VARCHAR(60),
                cor            VARCHAR(20),
                ordem          INTEGER,
                visivel        BOOLEAN,
                motivo         TEXT,
                atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_por VARCHAR(120),
                PRIMARY KEY (grupo, valor)
            )`);
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA_HIST} (
                id           BIGSERIAL PRIMARY KEY,
                grupo        VARCHAR(40) NOT NULL,
                valor        VARCHAR(60) NOT NULL,
                antes        JSONB,
                depois       JSONB,
                motivo       TEXT,
                alterado_por VARCHAR(120),
                alterado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_${TABELA_HIST}_item ON ${TABELA_HIST} (grupo, valor, id DESC)`);
            await client.query(`ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY`);
            await client.query(`ALTER TABLE ${TABELA_HIST} ENABLE ROW LEVEL SECURITY`);
            await client.query('COMMIT');
            limparCacheRotulos();
            return { criada };
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            await client.query(`SELECT pg_advisory_unlock(${LOCK})`).catch(() => {});
        }
    } finally {
        client.release();
    }
}

// Linha do banco -> objeto só com os campos personalizados VÁLIDOS.
function sobreposicaoDaLinha(l) {
    const g = grupo(l.grupo);
    if (!g || !item(l.grupo, l.valor)) return null;
    const bruto = { rotulo: l.rotulo, rotuloFiltro: l.rotulo_filtro, cor: l.cor, ordem: l.ordem, visivel: l.visivel };
    const out = {};
    for (const campo of CAMPOS) {
        if (bruto[campo] === null || bruto[campo] === undefined) continue;
        const v = validarCampo(g, campo, bruto[campo]);
        if (!v.erro && v.ok !== null) out[campo] = v.ok;
    }
    return Object.keys(out).length > 0 ? out : null;
}

// { grupo: { valor: { campos personalizados } } } - em cache. Falha = {} (vale o padrão).
async function lerSobreposicoes(pool) {
    const agora = Date.now();
    if (cacheSalvos && cacheSalvos.ate > agora) return cacheSalvos.valor;
    const valor = {};
    try {
        if (!modoPadraoForcado() && (await rotulosPreparado(pool))) {
            const { rows } = await pool.query(`SELECT grupo, valor, rotulo, rotulo_filtro, cor, ordem, visivel FROM ${TABELA}`);
            for (const l of rows) {
                const s = sobreposicaoDaLinha(l);
                if (!s) continue;
                if (!valor[l.grupo]) valor[l.grupo] = {};
                valor[l.grupo][l.valor] = s;
            }
        }
    } catch (erro) {
        console.error('[rotulos-status] falha ao ler as personalizações (usando padrões):', erro.message);
        for (const k of Object.keys(valor)) delete valor[k];
    }
    cacheSalvos = { ate: agora + CACHE_MS, valor };
    return valor;
}

// O que o front lê: só as personalizações (nada salvo = {}). NUNCA lança.
async function sobreposicoesParaFront(pool) {
    try {
        return await lerSobreposicoes(pool);
    } catch (erro) {
        console.error('[rotulos-status] falha (usando padrões):', erro.message);
        return {};
    }
}

// ------------------------------------------------------------
// Painel
// ------------------------------------------------------------
async function catalogoParaPainel(pool) {
    const preparado = await rotulosPreparado(pool);
    let linhas = [];
    if (preparado) {
        linhas = (
            await pool.query(`SELECT grupo, valor, rotulo, rotulo_filtro, cor, ordem, visivel, motivo, atualizado_em, atualizado_por FROM ${TABELA}`)
        ).rows;
    }
    return {
        preparado,
        modoPadraoForcado: modoPadraoForcado(),
        cores: CORES.map((c) => ({ chave: c, nome: NOMES_COR[c] })),
        grupos: GRUPOS.map((g) => ({
            chave: g.chave,
            nome: g.nome,
            descricao: g.descricao,
            recursos: g.recursos,
            itens: g.itens.map((it) => {
                const l = linhas.find((x) => x.grupo === g.chave && x.valor === it.valor);
                const salvo = l ? sobreposicaoDaLinha(l) || {} : {};
                const efetivo = {
                    rotulo: salvo.rotulo ?? it.rotulo,
                    rotuloFiltro: salvo.rotuloFiltro ?? it.rotuloFiltro ?? null,
                    cor: salvo.cor ?? it.cor ?? null,
                    ordem: salvo.ordem ?? it.ordem,
                    visivel: salvo.visivel ?? true,
                };
                return {
                    valor: it.valor,
                    padrao: { rotulo: it.rotulo, rotuloFiltro: it.rotuloFiltro ?? null, cor: it.cor ?? null, ordem: it.ordem, visivel: true },
                    salvo,
                    efetivo,
                    personalizado: Object.keys(salvo).length > 0,
                    motivo: l?.motivo || null,
                    atualizadoEm: l?.atualizado_em || null,
                    atualizadoPor: l?.atualizado_por || null,
                };
            }),
        })),
    };
}

// Grava as mudanças de UM status. `mudancas`: { campo: valor | null } (campo ausente = não mexe;
// null = volta ao padrão naquele campo). Devolve { antes, depois } (objetos só com campos personalizados).
async function salvarItem(pool, chaveGrupo, valorItem, mudancas, usuarioNome, motivo) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const atual = await client.query(
            `SELECT rotulo, rotulo_filtro, cor, ordem, visivel FROM ${TABELA} WHERE grupo = $1 AND valor = $2 FOR UPDATE`,
            [chaveGrupo, valorItem]
        );
        const linha = atual.rows[0] || { rotulo: null, rotulo_filtro: null, cor: null, ordem: null, visivel: null };
        const antes = {};
        const novo = {};
        for (const campo of CAMPOS) {
            const col = COLUNA[campo];
            antes[campo] = linha[col] ?? null;
            novo[campo] = Object.prototype.hasOwnProperty.call(mudancas, campo) ? mudancas[campo] : antes[campo];
        }
        const igual = CAMPOS.every((c) => antes[c] === novo[c]);
        await client.query(
            `INSERT INTO ${TABELA} (grupo, valor, rotulo, rotulo_filtro, cor, ordem, visivel, motivo, atualizado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (grupo, valor) DO UPDATE
             SET rotulo = EXCLUDED.rotulo, rotulo_filtro = EXCLUDED.rotulo_filtro, cor = EXCLUDED.cor, ordem = EXCLUDED.ordem,
                 visivel = EXCLUDED.visivel, motivo = EXCLUDED.motivo, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
            [chaveGrupo, valorItem, novo.rotulo, novo.rotuloFiltro, novo.cor, novo.ordem, novo.visivel, motivo || null, usuarioNome || null]
        );
        if (!igual) {
            await client.query(
                `INSERT INTO ${TABELA_HIST} (grupo, valor, antes, depois, motivo, alterado_por) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
                [chaveGrupo, valorItem, JSON.stringify(antes), JSON.stringify(novo), motivo || null, usuarioNome || null]
            );
        }
        await client.query('COMMIT');
        limparCacheRotulos();
        return { antes, depois: novo, alterada: !igual };
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }
}

async function restaurarItem(pool, chaveGrupo, valorItem, usuarioNome, motivo) {
    const g = grupo(chaveGrupo);
    const todos = {};
    for (const campo of g.recursos) todos[campo] = null;
    return salvarItem(pool, chaveGrupo, valorItem, todos, usuarioNome, motivo);
}

async function historico(pool, chaveGrupo, valorItem, limite = 50) {
    const l = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
    const { rows } = await pool.query(
        `SELECT id, antes, depois, motivo, alterado_por, alterado_em
           FROM ${TABELA_HIST} WHERE grupo = $1 AND valor = $2 ORDER BY id DESC LIMIT $3`,
        [chaveGrupo, valorItem, l]
    );
    return rows.map((r) => ({ id: r.id, antes: r.antes, depois: r.depois, motivo: r.motivo, alteradoPor: r.alterado_por, alteradoEm: r.alterado_em }));
}

module.exports = {
    GRUPOS,
    CORES,
    CAMPOS,
    grupo,
    item,
    validarCampo,
    modoPadraoForcado,
    limparCacheRotulos,
    rotulosPreparado,
    prepararRotulos,
    sobreposicoesParaFront,
    catalogoParaPainel,
    salvarItem,
    restaurarItem,
    historico,
};
