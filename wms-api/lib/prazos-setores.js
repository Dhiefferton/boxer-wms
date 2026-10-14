// ============================================================
// Fase 6 - Permissões temporárias + setores (10/2026)
//
// 1) PRAZO nas exceções por pessoa: colunas opcionais inicia_em / expira_em em
//    colaborador_permissoes. NULL = permanente, exatamente como era antes. O
//    vencimento é pela DATA (ninguém precisa lembrar de remover): ao calcular
//    as permissões efetivas, exceção vencida (ou que ainda não começou) é
//    ignorada. Nada é apagado - a linha fica, marcada como vencida no painel.
// 2) SETORES: só organização (tabelas setores + colaborador_setor). Setor NÃO
//    dá nem tira permissão nesta fase.
//
// Segurança / compatibilidade:
//   - Tudo aditivo: ALTER TABLE ... ADD COLUMN IF NOT EXISTS e CREATE TABLE IF
//     NOT EXISTS, pelo botão "Preparar prazos e setores" (idempotente, com
//     advisory lock). Nunca remove nada.
//   - Sem preparar, o cálculo de permissões nem consulta as colunas novas
//     (comportamento idêntico ao de antes).
//   - Kill switch: PERMISSOES_TEMPORARIAS_DESLIGADO=1 (ambiente) ou a função
//     'permissoes_temporarias' desligada no painel => exceções COM prazo são
//     ignoradas (como se não existissem); só as permanentes valem.
// ============================================================

const CACHE_MS = 10000;
const PRAZO_MAXIMO_DIAS = 366;
const DIA_MS = 24 * 60 * 60 * 1000;

let cachePreparo = null;

function limparCache() {
    cachePreparo = null;
}

// { colunas: boolean, setores: boolean } - falha de consulta = tudo "não preparado".
async function estadoPreparo(pool) {
    const agora = Date.now();
    if (cachePreparo && cachePreparo.ate > agora) return cachePreparo.valor;
    let valor = { colunas: false, setores: false };
    try {
        const { rows } = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'colaborador_permissoes'
                    AND column_name IN ('inicia_em', 'expira_em'))::int AS colunas,
                (to_regclass('public.setores') IS NOT NULL AND to_regclass('public.colaborador_setor') IS NOT NULL) AS setores`
        );
        valor = { colunas: rows[0].colunas === 2, setores: rows[0].setores === true };
    } catch (erro) {
        console.error('[prazos-setores] falha ao conferir o preparo (tratando como não preparado):', erro.message);
    }
    cachePreparo = { ate: agora + CACHE_MS, valor };
    return valor;
}

const SQL_SETORES = [
    `CREATE TABLE IF NOT EXISTS setores (
        id            SERIAL PRIMARY KEY,
        nome          VARCHAR(80) NOT NULL,
        descricao     TEXT,
        ativo         BOOLEAN NOT NULL DEFAULT true,
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_setores_nome ON setores (lower(nome))`,
    `CREATE TABLE IF NOT EXISTS colaborador_setor (
        colaborador_id INTEGER PRIMARY KEY,
        setor_id       INTEGER NOT NULL REFERENCES setores(id),
        atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
];

// Idempotente e só adiciona. Devolve o que foi criado nesta chamada.
async function preparar(pool) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(727002)');
        try {
            const antes = await estadoPreparoSemCache(client);
            await client.query('BEGIN');
            await client.query(`ALTER TABLE colaborador_permissoes ADD COLUMN IF NOT EXISTS inicia_em TIMESTAMPTZ`);
            await client.query(`ALTER TABLE colaborador_permissoes ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ`);
            for (const sql of SQL_SETORES) await client.query(sql);
            // Só aparece pra API REST pública do Supabase se o RLS estiver desligado.
            await client.query(`ALTER TABLE setores ENABLE ROW LEVEL SECURITY`);
            await client.query(`ALTER TABLE colaborador_setor ENABLE ROW LEVEL SECURITY`);
            await client.query('COMMIT');
            limparCache();
            return { colunasAdicionadas: !antes.colunas, setoresCriados: !antes.setores };
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            await client.query('SELECT pg_advisory_unlock(727002)').catch(() => {});
        }
    } finally {
        client.release();
    }
}

async function estadoPreparoSemCache(client) {
    const { rows } = await client.query(
        `SELECT
            (SELECT COUNT(*) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'colaborador_permissoes'
                AND column_name IN ('inicia_em', 'expira_em'))::int AS colunas,
            (to_regclass('public.setores') IS NOT NULL AND to_regclass('public.colaborador_setor') IS NOT NULL) AS setores`
    );
    return { colunas: rows[0].colunas === 2, setores: rows[0].setores === true };
}

// ------------------------------------------------------------
// Vigência
// ------------------------------------------------------------
function paraMs(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
    return Number.isFinite(ms) ? ms : null;
}

// 'permanente' | 'agendada' (ainda não começou) | 'vigente' | 'vencida'
function estadoDoPrazo(iniciaEm, expiraEm, agora = Date.now()) {
    const ini = paraMs(iniciaEm);
    const fim = paraMs(expiraEm);
    if (ini === null && fim === null) return 'permanente';
    if (ini !== null && ini > agora) return 'agendada';
    if (fim !== null && fim <= agora) return 'vencida';
    return 'vigente';
}

function temPrazo(e) {
    return paraMs(e?.inicia_em) !== null || paraMs(e?.expira_em) !== null;
}

function desligadoPorAmbiente() {
    return process.env.PERMISSOES_TEMPORARIAS_DESLIGADO === '1';
}

// Exceções com prazo valem agora? (kill switch de ambiente + função do painel)
// Falha ao consultar a função = padrão (ligado).
async function temporariasAtivas(pool, { colaboradorId, cargo, perfil } = {}) {
    if (desligadoPorAmbiente()) return false;
    try {
        // require tardio: feature-flags e permissoes já se referenciam assim.
        return await require('./feature-flags').flagAtiva(pool, 'permissoes_temporarias', { colaboradorId, cargo, perfil });
    } catch (erro) {
        console.error('[prazos-setores] falha ao consultar a função permissoes_temporarias (usando ligado):', erro.message);
        return true;
    }
}

// Valida início/fim vindos do painel (ISO). `existente` = valores já gravados
// (um fim que já passou só é aceito se for exatamente o que já estava salvo,
// pra poder salvar outras mudanças sem mexer numa exceção vencida).
function validarPrazo(iniciaEm, expiraEm, existente = {}, agora = Date.now()) {
    const lerCampo = (v, nome) => {
        if (v === null || v === undefined || v === '') return { ms: null };
        const ms = paraMs(v);
        if (ms === null) return { erro: `Data de ${nome} inválida` };
        return { ms };
    };
    const ini = lerCampo(iniciaEm, 'início');
    if (ini.erro) return { erro: ini.erro };
    const fim = lerCampo(expiraEm, 'término');
    if (fim.erro) return { erro: fim.erro };

    if (ini.ms !== null && fim.ms !== null && fim.ms <= ini.ms) {
        return { erro: 'A data de término precisa ser depois da data de início' };
    }
    const limite = agora + PRAZO_MAXIMO_DIAS * DIA_MS;
    if (fim.ms !== null) {
        if (fim.ms <= agora && fim.ms !== paraMs(existente.expira_em)) {
            return { erro: 'A data de término já passou' };
        }
        if (fim.ms > limite) return { erro: `Permissão temporária pode durar no máximo ${PRAZO_MAXIMO_DIAS} dias` };
    }
    if (ini.ms !== null && ini.ms > limite) {
        return { erro: `O início não pode ser daqui a mais de ${PRAZO_MAXIMO_DIAS} dias` };
    }
    return {
        ok: {
            iniciaEm: ini.ms === null ? null : new Date(ini.ms),
            expiraEm: fim.ms === null ? null : new Date(fim.ms),
        },
    };
}

module.exports = {
    PRAZO_MAXIMO_DIAS,
    estadoPreparo,
    preparar,
    limparCache,
    estadoDoPrazo,
    temPrazo,
    paraMs,
    desligadoPorAmbiente,
    temporariasAtivas,
    validarPrazo,
};
