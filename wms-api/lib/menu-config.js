// ============================================================
// Menus editáveis (Fase 2 do Controle de acesso, 05/10/2026)
// ============================================================
// O administrador pode, pelo painel (Controle de acesso > Menus), mudar:
//   - o NOME de um item de menu (ou de um grupo do menu do dashboard);
//   - a ORDEM dos itens dentro do mesmo grupo;
//   - ESCONDER um item do menu.
// em dois menus: o do dashboard e o do coletor.
//
// IMPORTANTE - isto é só APARÊNCIA do menu:
//   - esconder um item NÃO bloqueia a tela nem a API. Quem bloqueia é a
//     permissão (perfis / exceções por pessoa). Quem tem a permissão ainda
//     abre a tela pelo endereço direto; quem não tem continua barrado pela API.
//   - sem nada salvo, o menu é exatamente o de antes (os valores padrão estão
//     no front e repetidos aqui só pra o painel mostrar "padrão").
//
// SEGURANÇA / REVERSIBILIDADE:
//   - tabela PRÓPRIA (menu_config), criada só quando o administrador clica em
//     "Preparar menus" - NÃO entra na lista de tabelas do núcleo do controle
//     de acesso (isso trocaria o estado "banco preparado" já em uso).
//   - nunca apaga linhas: "restaurar padrão" só zera os campos (UPDATE).
//   - o item "Controle de acesso" (dash.acessos) nunca pode ser escondido, pra
//     o administrador não se trancar fora do painel.
//   - modo legado (camada desligada) = menu padrão, sem consultar a tabela.
//   - qualquer falha ao ler a tabela = menu padrão (nunca quebra o login).
// ============================================================

// Estrutura PADRÃO dos menus. 'item' é a chave usada na tabela:
//   - itens: a chave da permissão da tela (dash.* / col.*);
//   - grupos do dashboard: 'grupo:<id>'.
// 'pai' = grupo onde o item está (null = nível principal). A ordem do array é a
// ordem padrão dentro de cada nível. Mantenha igual ao MENU de
// wms-dashboard/src/components/Topbar.jsx e às opções de wms-coletor/src/pages/Menu.jsx.
const MENUS = {
    dashboard: {
        nome: 'Dashboard',
        itens: [
            { item: 'dash.mapa', rotulo: 'Mapa de ruas', pai: null },
            { item: 'grupo:estoque', rotulo: 'Estoque', pai: null, grupo: true },
            { item: 'grupo:operacao', rotulo: 'Operação', pai: null, grupo: true },
            { item: 'dash.historico', rotulo: 'Histórico', pai: null },
            { item: 'dash.relatorios', rotulo: 'Relatórios', pai: null },
            { item: 'grupo:sistema', rotulo: 'Sistema', pai: null, grupo: true },

            { item: 'dash.produtos', rotulo: 'Produtos', pai: 'grupo:estoque' },
            { item: 'dash.unidades', rotulo: 'Unidades', pai: 'grupo:estoque' },
            { item: 'dash.entradas_manuais', rotulo: 'Entradas manuais', pai: 'grupo:estoque' },
            { item: 'dash.reposicao_kanban', rotulo: 'Reposição (Kanban)', pai: 'grupo:estoque' },
            { item: 'dash.estoque_pulmao', rotulo: 'Estoque Pulmão', pai: 'grupo:estoque' },
            { item: 'dash.controle_lote', rotulo: 'Controle de Lote', pai: 'grupo:estoque' },

            { item: 'dash.pedidos', rotulo: 'Ordens de separação', pai: 'grupo:operacao' },
            { item: 'dash.divergencias', rotulo: 'Divergências', pai: 'grupo:operacao' },

            { item: 'dash.colaboradores', rotulo: 'Colaboradores', pai: 'grupo:sistema' },
            { item: 'dash.perfis_fiscais', rotulo: 'Perfis fiscais (Devolução)', pai: 'grupo:sistema' },
            { item: 'dash.perfis_separacao', rotulo: 'Perfis de separação', pai: 'grupo:sistema' },
            { item: 'dash.acessos', rotulo: 'Controle de acesso', pai: 'grupo:sistema', travado: true },
        ],
    },
    coletor: {
        nome: 'Coletor',
        itens: [
            { item: 'col.nf_importacao', rotulo: 'Recebimento (NF)', pai: null },
            { item: 'col.nf_devolucao', rotulo: 'Devolução (NF)', pai: null },
            { item: 'col.imprimir_ordem', rotulo: 'Imprimir Ordem de Separação', pai: null },
            { item: 'col.separacao', rotulo: 'Separação', pai: null },
            { item: 'col.transferencia', rotulo: 'Transferência de Depósito', pai: null },
            { item: 'col.estoque_devolucao', rotulo: 'Estoque Devolução', pai: null },
            { item: 'col.conferencia', rotulo: 'Conferência de embarque', pai: null },
            { item: 'col.picking', rotulo: 'Picking (repor)', pai: null },
            { item: 'col.pulmao', rotulo: 'Estoque Pulmão → Vertical', pai: null },
            { item: 'col.inventario', rotulo: 'Contagem de inventário', pai: null },
            { item: 'col.reimprimir', rotulo: 'Reimprimir etiquetas', pai: null },
        ],
    },
};

const APPS_VALIDOS = Object.keys(MENUS);
const TABELA = 'menu_config';
const TAMANHO_MAX_ROTULO = 40;
const ORDEM_MAX = 999;

const CACHE_MS = 10000;
let cachePreparado = null; // { ate, valor }
let cacheConfig = null; // { ate, valor }

function limparCacheMenu() {
    cachePreparado = null;
    cacheConfig = null;
}

function itemDoApp(app, item) {
    return MENUS[app]?.itens.find((i) => i.item === item) || null;
}

async function menuPreparado(pool) {
    const agora = Date.now();
    if (cachePreparado && cachePreparado.ate > agora) return cachePreparado.valor;
    let valor = false;
    try {
        const r = await pool.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS ok`);
        valor = Boolean(r.rows[0]?.ok);
    } catch (erro) {
        console.error('[menu-config] não consegui conferir a tabela do menu (usando menu padrão):', erro.message);
    }
    cachePreparado = { ate: agora + CACHE_MS, valor };
    return valor;
}

// Cria a tabela (só adiciona; transação única; idempotente).
async function prepararMenu(pool) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(727002)');
        try {
            await client.query('BEGIN');
            const antes = await client.query(`SELECT to_regclass('public.${TABELA}') IS NOT NULL AS existe`);
            const criada = !antes.rows[0].existe;
            await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA} (
                app            VARCHAR(12) NOT NULL,
                item           VARCHAR(80) NOT NULL,
                rotulo         VARCHAR(${TAMANHO_MAX_ROTULO}),
                ordem          INTEGER,
                oculto         BOOLEAN NOT NULL DEFAULT false,
                atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_por VARCHAR(120),
                PRIMARY KEY (app, item)
            )`);
            await client.query(`ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY`);
            await client.query('COMMIT');
            limparCacheMenu();
            return { criada };
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

// { dashboard: { 'dash.mapa': { rotulo, ordem, oculto }, ... }, coletor: {...} }
// Só entram valores que mudam alguma coisa em relação ao padrão.
async function lerConfig(pool) {
    const agora = Date.now();
    if (cacheConfig && cacheConfig.ate > agora) return cacheConfig.valor;
    const vazio = () => ({ dashboard: {}, coletor: {} });
    let valor = vazio();
    try {
        if (await menuPreparado(pool)) {
            const { rows } = await pool.query(`SELECT app, item, rotulo, ordem, oculto FROM ${TABELA}`);
            for (const r of rows) {
                const def = itemDoApp(r.app, r.item);
                if (!def) continue; // item que não existe mais no catálogo: ignora
                const cfg = {};
                if (r.rotulo) cfg.rotulo = r.rotulo;
                if (Number.isInteger(r.ordem)) cfg.ordem = r.ordem;
                if (r.oculto && !def.travado) cfg.oculto = true;
                if (Object.keys(cfg).length > 0) valor[r.app][r.item] = cfg;
            }
        }
    } catch (erro) {
        console.error('[menu-config] falha ao ler a configuração do menu (usando menu padrão):', erro.message);
        valor = vazio();
    }
    cacheConfig = { ate: agora + CACHE_MS, valor };
    return valor;
}

// O que o front recebe em /auth/login e /auth/me. SEMPRE devolve o objeto
// (vazio quando não há nada) pra o front sobrescrever o que tinha guardado.
async function menuParaFront(pool, estado) {
    if (!estado || estado.modo === 'legado') return { dashboard: {}, coletor: {} };
    return lerConfig(pool);
}

// Para o painel: catálogo + valores atuais.
async function catalogoParaPainel(pool) {
    const preparado = await menuPreparado(pool);
    let linhas = [];
    if (preparado) {
        const r = await pool.query(`SELECT app, item, rotulo, ordem, oculto FROM ${TABELA}`);
        linhas = r.rows;
    }
    const apps = {};
    for (const app of APPS_VALIDOS) {
        apps[app] = {
            nome: MENUS[app].nome,
            itens: MENUS[app].itens.map((i, indice) => {
                const l = linhas.find((x) => x.app === app && x.item === i.item);
                return {
                    item: i.item,
                    rotuloPadrao: i.rotulo,
                    rotulo: l?.rotulo || null,
                    pai: i.pai,
                    grupo: Boolean(i.grupo),
                    travado: Boolean(i.travado),
                    indicePadrao: indice,
                    ordem: Number.isInteger(l?.ordem) ? l.ordem : null,
                    oculto: Boolean(l?.oculto) && !i.travado,
                    // Permissão que libera a tela (só itens; grupo não tem).
                    permissao: i.grupo ? null : i.item,
                };
            }),
        };
    }
    return { preparado, apps };
}

// Valida e normaliza o que veio do painel. Devolve { ok: [...] } ou { erro }.
function validarAlteracoes(app, lista) {
    if (!APPS_VALIDOS.includes(app)) return { erro: 'Menu desconhecido (use dashboard ou coletor)' };
    if (!Array.isArray(lista) || lista.length === 0) return { erro: 'Informe os itens a alterar' };
    if (lista.length > 100) return { erro: 'Itens demais numa só alteração' };
    const vistos = new Set();
    const ok = [];
    for (const x of lista) {
        const item = String(x?.item || '');
        const def = itemDoApp(app, item);
        if (!def) return { erro: `Item de menu desconhecido: ${item}` };
        if (vistos.has(item)) return { erro: `Item repetido: ${item}` };
        vistos.add(item);

        let rotulo = null;
        if (x.rotulo !== undefined && x.rotulo !== null) {
            const t = String(x.rotulo).trim().replace(/\s+/g, ' ');
            if (/[\u0000-\u001f\u007f]/.test(t)) return { erro: `Nome inválido em "${def.rotulo}"` };
            if (t.length > TAMANHO_MAX_ROTULO) return { erro: `Nome muito longo em "${def.rotulo}" (máx. ${TAMANHO_MAX_ROTULO} caracteres)` };
            // Nome igual ao padrão = sem personalização.
            rotulo = t && t !== def.rotulo ? t : null;
        }

        let ordem = null;
        if (x.ordem !== undefined && x.ordem !== null) {
            const n = Number(x.ordem);
            if (!Number.isInteger(n) || n < 0 || n > ORDEM_MAX) return { erro: `Ordem inválida em "${def.rotulo}"` };
            ordem = n;
        }

        const oculto = x.oculto === true;
        if (oculto && def.travado) return { erro: `"${def.rotulo}" não pode ser escondido (é o acesso a este painel).` };

        ok.push({ item, rotulo, ordem, oculto });
    }
    return { ok };
}

async function estadoAtual(client, app, itens) {
    const r = await client.query(`SELECT item, rotulo, ordem, oculto FROM ${TABELA} WHERE app = $1 AND item = ANY($2::text[])`, [
        app,
        itens,
    ]);
    const mapa = new Map(r.rows.map((x) => [x.item, { rotulo: x.rotulo, ordem: x.ordem, oculto: x.oculto }]));
    return itens.map((i) => ({ item: i, ...(mapa.get(i) || { rotulo: null, ordem: null, oculto: false }) }));
}

// Grava (upsert) e devolve { antes, depois } só dos itens que de fato mudaram.
async function salvarAlteracoes(pool, app, alteracoes, usuarioNome) {
    const client = await pool.connect();
    try {
        const antesTodos = await estadoAtual(client, app, alteracoes.map((a) => a.item));
        await client.query('BEGIN');
        for (const a of alteracoes) {
            await client.query(
                `INSERT INTO ${TABELA} (app, item, rotulo, ordem, oculto, atualizado_por)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (app, item) DO UPDATE
                 SET rotulo = EXCLUDED.rotulo, ordem = EXCLUDED.ordem, oculto = EXCLUDED.oculto,
                     atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
                [app, a.item, a.rotulo, a.ordem, a.oculto, usuarioNome || null]
            );
        }
        await client.query('COMMIT');
        limparCacheMenu();
        const antes = [];
        const depois = [];
        for (const a of alteracoes) {
            const b = antesTodos.find((x) => x.item === a.item);
            const igual = (b.rotulo || null) === a.rotulo && (b.ordem ?? null) === a.ordem && Boolean(b.oculto) === a.oculto;
            if (!igual) {
                antes.push({ item: a.item, rotulo: b.rotulo || null, ordem: b.ordem ?? null, oculto: Boolean(b.oculto) });
                depois.push({ item: a.item, rotulo: a.rotulo, ordem: a.ordem, oculto: a.oculto });
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

// Volta o menu de um app ao padrão. Não apaga linhas: só zera os campos.
async function restaurarPadrao(pool, app, usuarioNome) {
    const antes = await pool.query(
        `SELECT item, rotulo, ordem, oculto FROM ${TABELA}
         WHERE app = $1 AND (rotulo IS NOT NULL OR ordem IS NOT NULL OR oculto)`,
        [app]
    );
    await pool.query(
        `UPDATE ${TABELA} SET rotulo = NULL, ordem = NULL, oculto = false, atualizado_em = now(), atualizado_por = $2
         WHERE app = $1`,
        [app, usuarioNome || null]
    );
    limparCacheMenu();
    return { antes: antes.rows };
}

module.exports = {
    MENUS,
    APPS_VALIDOS,
    TAMANHO_MAX_ROTULO,
    limparCacheMenu,
    menuPreparado,
    prepararMenu,
    lerConfig,
    menuParaFront,
    catalogoParaPainel,
    validarAlteracoes,
    salvarAlteracoes,
    restaurarPadrao,
};
