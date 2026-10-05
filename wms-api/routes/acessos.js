// ============================================================
// Painel "Controle de acesso" (05/10/2026): modo de operação, banco,
// perfis, permissões, exceções por colaborador, auditoria.
// Toda a rota é só pra administrador (index.js: exigirCargo('admin'));
// no modo ativo vale a permissão 'acessos.gerenciar'.
//
// - /estado, /banco/preparar, /modo, /divergencias funcionam mesmo antes
//   do banco estar preparado (é por elas que se prepara).
// - O resto exige o banco preparado (503 com a explicação se não estiver).
// - Perfil 'admin' é imutável (sempre tem tudo - evita se trancar fora).
// - Perfis de sistema (os 5 cargos antigos): nome/permissões editáveis e
//   restauráveis ao padrão, mas não excluíveis.
// - A chave do perfil é o que fica gravado (colaboradores.cargo ou
//   colaborador_perfil.perfil) - por isso no máximo 30 caracteres.
// - Toda alteração gera registro em auditoria_admin (antes e depois).
// ============================================================
const express = require('express');
const pool = require('../db');
const {
    CATALOGO,
    CATALOGO_POR_CHAVE,
    PERFIS_SISTEMA,
    CARGOS_SISTEMA,
    TABELAS_ACESSO,
    padraoDoPerfil,
    lerEstado,
    prepararBanco,
    definirModo,
    carregarEfetivasDoBanco,
    limparCache,
    auditar,
} = require('../lib/permissoes');

const router = express.Router();

async function exigirPreparado(req, res, next) {
    try {
        const estado = await lerEstado(pool);
        if (!estado.preparado) {
            return res.status(503).json({
                erro: 'O banco do controle de acesso ainda não foi preparado. Use o botão "Preparar banco" na aba Modo e banco.',
                bancoNaoPreparado: true,
            });
        }
        next();
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao conferir o banco do controle de acesso' });
    }
}

function gerarChave(nome) {
    const base = String(nome || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 26);
    return base || 'perfil';
}

function validarPermissoes(lista) {
    if (!Array.isArray(lista)) return { erro: 'Informe a lista de permissões' };
    const unicas = [...new Set(lista.map(String))];
    const invalidas = unicas.filter((c) => !CATALOGO_POR_CHAVE.has(c));
    if (invalidas.length > 0) return { erro: `Permissão desconhecida: ${invalidas.join(', ')}` };
    return { ok: unicas };
}

// ------------------------------------------------------------
// Estado, banco e modo
// ------------------------------------------------------------
async function resumoDivergencias() {
    const total = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE quando > now() - interval '24 hours')::int AS ultimas24h,
                MIN(quando) AS desde
         FROM acesso_divergencias`
    );
    return total.rows[0];
}

// GET /acessos/estado
router.get('/estado', async (req, res) => {
    try {
        limparCache();
        const estado = await lerEstado(pool);
        const tabelas = (
            await pool.query(
                `SELECT t AS nome, to_regclass('public.' || t) IS NOT NULL AS existe FROM unnest($1::text[]) AS t`,
                [TABELAS_ACESSO]
            )
        ).rows;
        const resposta = {
            modo: estado.modo,
            modoDoPainel: estado.modoDoPainel,
            override: estado.override,
            preparado: estado.preparado,
            tabelas,
            divergencias: null,
        };
        if (estado.preparado) resposta.divergencias = await resumoDivergencias();
        res.json(resposta);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o estado do controle de acesso' });
    }
});

// POST /acessos/banco/preparar - cria as tabelas novas (idempotente, só adiciona).
router.post('/banco/preparar', async (req, res) => {
    try {
        const { criadas } = await prepararBanco(pool);
        await auditar(pool, req, 'banco_preparado', { tela: 'acessos', alvo: 'tabelas de acesso', depois: { criadas } });
        res.json({ status: 'ok', criadas });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({
            erro: 'Não consegui preparar o banco (nada foi criado): ' + erro.message,
        });
    }
});

// PUT /acessos/modo  { modo: 'legado'|'sombra'|'ativo', motivo?, confirmar? }
router.put('/modo', exigirPreparado, async (req, res) => {
    const modo = String(req.body?.modo || '');
    try {
        const antes = await lerEstado(pool);
        if (antes.override) {
            return res.status(409).json({
                erro: `A variável de ambiente ACESSO_MODO=${antes.override} está definida na Vercel e vale mais que o painel. Remova-a para trocar o modo por aqui.`,
            });
        }
        if (modo === 'ativo' && antes.modoDoPainel !== 'ativo') {
            const d = await resumoDivergencias();
            if (d.ultimas24h > 0 && req.body?.confirmar !== true) {
                return res.status(409).json({
                    erro: `Houve ${d.ultimas24h} divergência(s) nas últimas 24h entre a regra antiga e a nova. Veja a lista antes de ativar - ou confirme que quer ativar mesmo assim.`,
                    requerConfirmacao: true,
                    divergencias24h: d.ultimas24h,
                });
            }
        }
        await definirModo(pool, modo, req.usuario.nome);
        await auditar(pool, req, 'modo_alterado', {
            tela: 'acessos',
            alvo: 'modo de operação',
            antes: { modo: antes.modoDoPainel },
            depois: { modo },
            motivo: req.body?.motivo ? String(req.body.motivo).slice(0, 500) : null,
        });
        res.json({ status: 'ok', modo });
    } catch (erro) {
        if (erro.status) return res.status(erro.status).json({ erro: erro.message });
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao trocar o modo' });
    }
});

// GET /acessos/divergencias - agrupadas por cargo + rota
router.get('/divergencias', exigirPreparado, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT cargo, metodo, rota, regra_antiga, regra_nova,
                    COUNT(*)::int AS vezes, MAX(quando) AS ultima, MIN(quando) AS primeira,
                    MAX(status) AS ultimo_status
             FROM acesso_divergencias
             GROUP BY cargo, metodo, rota, regra_antiga, regra_nova
             ORDER BY MAX(quando) DESC
             LIMIT 300`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar divergências' });
    }
});

// ------------------------------------------------------------
// Catálogo e perfis
// ------------------------------------------------------------
// GET /acessos/catalogo - todas as permissões possíveis
router.get('/catalogo', (req, res) => {
    res.json(
        CATALOGO.map((p) => ({
            chave: p.chave,
            tipo: p.tipo,
            app: p.app,
            grupo: p.grupo,
            rotulo: p.rotulo,
            descricao: p.descricao,
            rotas: p.rotas || [],
            padrao: p.padrao,
        }))
    );
});

// GET /acessos/perfis - perfis com permissões e quantos colaboradores usam
router.get('/perfis', exigirPreparado, async (req, res) => {
    try {
        const perfis = (await pool.query(`SELECT chave, nome, descricao, sistema FROM perfis_acesso ORDER BY sistema DESC, nome ASC`)).rows;
        const perms = (await pool.query(`SELECT perfil, permissao FROM perfil_permissoes`)).rows;
        const usos = (
            await pool.query(
                `SELECT COALESCE(cp.perfil, c.cargo) AS perfil, COUNT(*)::int AS total
                 FROM colaboradores c LEFT JOIN colaborador_perfil cp ON cp.colaborador_id = c.id
                 GROUP BY 1`
            )
        ).rows;
        const porPerfil = new Map();
        for (const r of perms) {
            if (!porPerfil.has(r.perfil)) porPerfil.set(r.perfil, []);
            porPerfil.get(r.perfil).push(r.permissao);
        }
        const usoPorPerfil = new Map(usos.map((u) => [u.perfil, u.total]));
        res.json(
            perfis.map((p) => ({
                ...p,
                imutavel: p.chave === 'admin',
                permissoes: p.chave === 'admin' ? CATALOGO.map((c) => c.chave) : (porPerfil.get(p.chave) || []).sort(),
                padrao: p.sistema && p.chave !== 'admin' ? padraoDoPerfil(p.chave).sort() : null,
                colaboradores: usoPorPerfil.get(p.chave) || 0,
            }))
        );
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar perfis' });
    }
});

// POST /acessos/perfis  { nome, descricao?, permissoes?: [], copiarDe?: chave }
router.post('/perfis', exigirPreparado, async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    const descricao = String(req.body?.descricao || '').trim() || null;
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do perfil' });
    if (nome.length > 120) return res.status(400).json({ erro: 'Nome muito longo (máx. 120 caracteres)' });

    const client = await pool.connect();
    try {
        let permissoes = [];
        if (req.body?.copiarDe) {
            const origem = String(req.body.copiarDe);
            if (origem === 'admin') {
                permissoes = CATALOGO.map((c) => c.chave);
            } else {
                const r = await client.query(`SELECT permissao FROM perfil_permissoes WHERE perfil = $1`, [origem]);
                permissoes = r.rows.map((x) => x.permissao);
            }
        } else if (req.body?.permissoes !== undefined) {
            const v = validarPermissoes(req.body.permissoes);
            if (v.erro) return res.status(400).json({ erro: v.erro });
            permissoes = v.ok;
        }

        await client.query('BEGIN');
        const base = gerarChave(nome);
        let chave = base;
        for (let n = 2; ; n++) {
            const ja = await client.query(`SELECT 1 FROM perfis_acesso WHERE chave = $1`, [chave]);
            if (ja.rowCount === 0) break;
            chave = `${base.slice(0, 26)}_${n}`;
        }
        await client.query(`INSERT INTO perfis_acesso (chave, nome, descricao, sistema) VALUES ($1, $2, $3, false)`, [chave, nome, descricao]);
        for (const p of permissoes) {
            await client.query(`INSERT INTO perfil_permissoes (perfil, permissao) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [chave, p]);
        }
        await client.query('COMMIT');
        limparCache();
        await auditar(pool, req, 'perfil_criado', { tela: 'acessos', alvo: `${nome} (${chave})`, depois: { permissoes: permissoes.length, copiarDe: req.body?.copiarDe || null } });
        res.status(201).json({ chave, nome, descricao, sistema: false, permissoes: permissoes.sort(), colaboradores: 0 });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao criar perfil' });
    } finally {
        client.release();
    }
});

// PUT /acessos/perfis/:chave  { nome?, descricao?, permissoes?, motivo? }
router.put('/perfis/:chave', exigirPreparado, async (req, res) => {
    const chave = req.params.chave;
    if (chave === 'admin') return res.status(400).json({ erro: 'O perfil Administrador não pode ser alterado.' });

    const client = await pool.connect();
    try {
        const atual = await client.query(`SELECT chave, nome, descricao FROM perfis_acesso WHERE chave = $1`, [chave]);
        if (atual.rowCount === 0) return res.status(404).json({ erro: 'Perfil não encontrado' });

        let permissoes;
        if (req.body?.permissoes !== undefined) {
            const v = validarPermissoes(req.body.permissoes);
            if (v.erro) return res.status(400).json({ erro: v.erro });
            permissoes = v.ok;
        }
        const nome = req.body?.nome !== undefined ? String(req.body.nome).trim() : undefined;
        if (nome !== undefined && (!nome || nome.length > 120)) return res.status(400).json({ erro: 'Nome inválido' });
        const descricao = req.body?.descricao !== undefined ? String(req.body.descricao).trim() || null : undefined;

        await client.query('BEGIN');
        if (nome !== undefined || descricao !== undefined) {
            await client.query(
                `UPDATE perfis_acesso SET nome = COALESCE($2, nome), descricao = CASE WHEN $4 THEN $3 ELSE descricao END, atualizado_em = now() WHERE chave = $1`,
                [chave, nome ?? null, descricao ?? null, descricao !== undefined]
            );
        }
        let antes = [];
        if (permissoes) {
            antes = (await client.query(`SELECT permissao FROM perfil_permissoes WHERE perfil = $1`, [chave])).rows.map((r) => r.permissao);
            await client.query(`DELETE FROM perfil_permissoes WHERE perfil = $1`, [chave]);
            for (const p of permissoes) {
                await client.query(`INSERT INTO perfil_permissoes (perfil, permissao) VALUES ($1, $2)`, [chave, p]);
            }
        }
        await client.query('COMMIT');
        limparCache();

        const depois = {};
        const antesAudit = {};
        if (nome !== undefined && nome !== atual.rows[0].nome) {
            antesAudit.nome = atual.rows[0].nome;
            depois.nome = nome;
        }
        if (permissoes) {
            depois.liberadas = permissoes.filter((p) => !antes.includes(p));
            antesAudit.removidas = antes.filter((p) => !permissoes.includes(p));
        }
        await auditar(pool, req, 'perfil_alterado', {
            tela: 'acessos',
            alvo: `${atual.rows[0].nome} (${chave})`,
            antes: antesAudit,
            depois,
            motivo: req.body?.motivo ? String(req.body.motivo).slice(0, 500) : null,
        });
        res.json({ status: 'ok' });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao alterar perfil' });
    } finally {
        client.release();
    }
});

// POST /acessos/perfis/:chave/restaurar-padrao - volta um perfil de sistema ao que tinha originalmente.
router.post('/perfis/:chave/restaurar-padrao', exigirPreparado, async (req, res) => {
    const chave = req.params.chave;
    if (chave === 'admin') return res.status(400).json({ erro: 'O perfil Administrador não pode ser alterado.' });
    if (!CARGOS_SISTEMA.includes(chave)) {
        return res.status(400).json({ erro: 'Só perfis de sistema têm um padrão pra restaurar.' });
    }
    const client = await pool.connect();
    try {
        const padrao = padraoDoPerfil(chave);
        await client.query('BEGIN');
        const antes = (await client.query(`SELECT permissao FROM perfil_permissoes WHERE perfil = $1`, [chave])).rows.map((r) => r.permissao);
        await client.query(`DELETE FROM perfil_permissoes WHERE perfil = $1`, [chave]);
        for (const p of padrao) {
            await client.query(`INSERT INTO perfil_permissoes (perfil, permissao) VALUES ($1, $2)`, [chave, p]);
        }
        await client.query('COMMIT');
        limparCache();
        await auditar(pool, req, 'perfil_restaurado_padrao', {
            tela: 'acessos',
            alvo: chave,
            antes: { removidas: antes.filter((p) => !padrao.includes(p)) },
            depois: { liberadas: padrao.filter((p) => !antes.includes(p)) },
        });
        res.json({ status: 'ok', permissoes: padrao.length });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao restaurar o padrão' });
    } finally {
        client.release();
    }
});

// DELETE /acessos/perfis/:chave - só perfil criado no painel e sem ninguém usando
router.delete('/perfis/:chave', exigirPreparado, async (req, res) => {
    const chave = req.params.chave;
    try {
        const perfil = await pool.query(`SELECT chave, nome, sistema FROM perfis_acesso WHERE chave = $1`, [chave]);
        if (perfil.rowCount === 0) return res.status(404).json({ erro: 'Perfil não encontrado' });
        if (perfil.rows[0].sistema) return res.status(400).json({ erro: 'Perfis de sistema não podem ser excluídos.' });
        const uso = await pool.query(`SELECT COUNT(*)::int AS total FROM colaborador_perfil WHERE perfil = $1`, [chave]);
        if (uso.rows[0].total > 0) {
            return res.status(409).json({ erro: `Não dá pra excluir: ${uso.rows[0].total} colaborador(es) usam esse perfil. Troque o perfil deles antes.` });
        }
        const antes = (await pool.query(`SELECT permissao FROM perfil_permissoes WHERE perfil = $1`, [chave])).rows.map((r) => r.permissao);
        await pool.query(`DELETE FROM perfis_acesso WHERE chave = $1`, [chave]);
        limparCache();
        await auditar(pool, req, 'perfil_excluido', { tela: 'acessos', alvo: `${perfil.rows[0].nome} (${chave})`, antes: { permissoes: antes } });
        res.json({ status: 'ok' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir perfil' });
    }
});

// ------------------------------------------------------------
// Colaboradores: exceções individuais e "visualizar como"
// ------------------------------------------------------------
// GET /acessos/colaboradores - lista com perfil e nº de exceções
router.get('/colaboradores', exigirPreparado, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.id, c.nome, c.email, c.cargo, c.ativo,
                    COALESCE(cp.perfil, c.cargo) AS perfil,
                    (SELECT COUNT(*)::int FROM colaborador_permissoes x WHERE x.colaborador_id = c.id) AS excecoes
             FROM colaboradores c
             LEFT JOIN colaborador_perfil cp ON cp.colaborador_id = c.id
             ORDER BY c.nome ASC`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar colaboradores' });
    }
});

// GET /acessos/colaboradores/:id - perfil, exceções e o que ele pode de fato
// (isto é também o "visualizar como": a lista efetiva mostra menus e ações dele).
router.get('/colaboradores/:id', exigirPreparado, async (req, res) => {
    try {
        const c = await pool.query(
            `SELECT c.id, c.nome, c.email, c.cargo, c.ativo, COALESCE(cp.perfil, c.cargo) AS perfil
             FROM colaboradores c LEFT JOIN colaborador_perfil cp ON cp.colaborador_id = c.id
             WHERE c.id = $1`,
            [req.params.id]
        );
        if (c.rowCount === 0) return res.status(404).json({ erro: 'Colaborador não encontrado' });
        const colaborador = c.rows[0];
        const doPerfil =
            colaborador.cargo === 'admin'
                ? CATALOGO.map((p) => p.chave)
                : (await pool.query(`SELECT permissao FROM perfil_permissoes WHERE perfil = $1`, [colaborador.perfil])).rows.map((r) => r.permissao);
        const excecoes = (
            await pool.query(
                `SELECT permissao, efeito, motivo, concedido_por, atualizado_em FROM colaborador_permissoes WHERE colaborador_id = $1 ORDER BY permissao`,
                [colaborador.id]
            )
        ).rows.map((e) => ({
            ...e,
            // Conflito/redundância: a exceção não muda nada porque o perfil já resolve igual.
            redundante: e.efeito === 'liberar' ? doPerfil.includes(e.permissao) : !doPerfil.includes(e.permissao),
        }));
        limparCache();
        const ctx = await carregarEfetivasDoBanco(pool, colaborador.id);
        res.json({
            colaborador,
            doPerfil: doPerfil.sort(),
            excecoes,
            efetivas: [...ctx.permissoes].sort(),
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o colaborador' });
    }
});

// PUT /acessos/colaboradores/:id  { excecoes: [{ permissao, efeito, motivo? }], motivo? }
// Substitui TODAS as exceções do colaborador pela lista enviada.
router.put('/colaboradores/:id', exigirPreparado, async (req, res) => {
    const lista = req.body?.excecoes;
    if (!Array.isArray(lista)) return res.status(400).json({ erro: 'Informe a lista de exceções' });
    const motivoGeral = req.body?.motivo ? String(req.body.motivo).slice(0, 500) : null;
    const vistas = new Map();
    for (const e of lista) {
        const permissao = String(e?.permissao || '');
        const efeito = String(e?.efeito || '');
        if (!CATALOGO_POR_CHAVE.has(permissao)) return res.status(400).json({ erro: `Permissão desconhecida: ${permissao}` });
        if (efeito !== 'liberar' && efeito !== 'bloquear') return res.status(400).json({ erro: `Efeito inválido: ${efeito}` });
        vistas.set(permissao, { efeito, motivo: e?.motivo ? String(e.motivo).slice(0, 500) : motivoGeral });
    }

    const client = await pool.connect();
    try {
        const c = await client.query(`SELECT id, nome, cargo FROM colaboradores WHERE id = $1`, [req.params.id]);
        if (c.rowCount === 0) return res.status(404).json({ erro: 'Colaborador não encontrado' });
        if (c.rows[0].cargo === 'admin') {
            return res.status(400).json({ erro: 'Administradores têm acesso total - exceções não se aplicam.' });
        }
        const antes = (
            await client.query(`SELECT permissao, efeito FROM colaborador_permissoes WHERE colaborador_id = $1 ORDER BY permissao`, [c.rows[0].id])
        ).rows;
        await client.query('BEGIN');
        await client.query(`DELETE FROM colaborador_permissoes WHERE colaborador_id = $1`, [c.rows[0].id]);
        for (const [permissao, e] of vistas) {
            await client.query(
                `INSERT INTO colaborador_permissoes (colaborador_id, permissao, efeito, motivo, concedido_por) VALUES ($1, $2, $3, $4, $5)`,
                [c.rows[0].id, permissao, e.efeito, e.motivo, req.usuario.nome]
            );
        }
        await client.query('COMMIT');
        limparCache();
        await auditar(pool, req, 'excecoes_colaborador', {
            tela: 'acessos',
            alvo: `${c.rows[0].nome} (#${c.rows[0].id})`,
            antes,
            depois: [...vistas].map(([permissao, e]) => ({ permissao, efeito: e.efeito })).sort((a, b) => a.permissao.localeCompare(b.permissao)),
            motivo: motivoGeral,
        });
        res.json({ status: 'ok', total: vistas.size });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar as exceções' });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// Auditoria
// ------------------------------------------------------------
// GET /acessos/auditoria?limite=100&antesDe=<id>&acao=<texto>&alvo=<texto>
router.get('/auditoria', exigirPreparado, async (req, res) => {
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);
    const antesDe = parseInt(req.query.antesDe, 10);
    const acao = req.query.acao ? String(req.query.acao) : null;
    const busca = req.query.busca ? `%${String(req.query.busca).trim()}%` : null;
    try {
        const { rows } = await pool.query(
            `SELECT id, quando, ator_id, ator_nome, acao, tela, alvo, antes, depois, motivo, origem, ip
             FROM auditoria_admin
             WHERE ($1::bigint IS NULL OR id < $1)
               AND ($2::text IS NULL OR acao = $2)
               AND ($3::text IS NULL OR alvo ILIKE $3 OR ator_nome ILIKE $3)
             ORDER BY id DESC
             LIMIT $4`,
            [Number.isFinite(antesDe) ? antesDe : null, acao, busca, limite]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar a auditoria' });
    }
});

module.exports = router;
