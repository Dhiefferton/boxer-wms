// ============================================================
// Rotas de gestao de colaboradores (tela de administracao)
// Quem acessa: admin e recebimento_reposicao (index.js: exigirLogin +
// exigirCargo; no modo ativo vale a permissão 'colaboradores.gerenciar').
//
// Não existe exclusão de verdade aqui: desativar (ativo = false)
// em vez de apagar, senão perderíamos a referência de quem fez o
// quê no histórico de movimentações mais pra frente. Um
// colaborador desativado simplesmente não consegue mais logar.
//
// PERFIL (05/10/2026): além dos 5 cargos de sempre, a pessoa pode ter um
// perfil criado no painel de Controle de acesso. Perfil novo fica na
// tabela colaborador_perfil e o cargo da coluna vira 'engenharia_produtos'
// (só leitura - qualquer checagem antiga "falha fechada"). Antes do banco
// de acessos ser preparado, só existem os 5 cargos.
//
// TRAVAS DE SEGURANÇA (valem sempre):
//  - só quem gerencia acessos (admin; no modo ativo, quem tem
//    'acessos.gerenciar') cria, promove ou altera um administrador - antes,
//    qualquer um que podia cadastrar colaborador conseguia criar um admin;
//  - o último administrador ativo nunca pode ser rebaixado nem desativado.
// ============================================================
const express = require('express');
const pool = require('../db');
const { gerarHashSenha } = require('../auth');
const {
    CARGOS_SISTEMA,
    PERFIS_SISTEMA,
    lerEstado,
    listarPerfis,
    auditar,
    limparCache,
    podeGerenciarAcessos,
} = require('../lib/permissoes');

const router = express.Router();

const CARGO_BASE_PERFIL_PERSONALIZADO = 'engenharia_produtos';

// Traduz o que veio da tela (cargo de sistema ou perfil personalizado) pro
// que grava no banco. Devolve null se o perfil não existe.
async function resolverPerfil(valor) {
    if (CARGOS_SISTEMA.includes(valor)) return { cargoColuna: valor, perfilPersonalizado: null, perfil: valor };
    const estado = await lerEstado(pool);
    if (!estado.preparado || typeof valor !== 'string') return null;
    const r = await pool.query(`SELECT chave FROM perfis_acesso WHERE chave = $1 AND sistema = false`, [valor]);
    if (r.rowCount === 0) return null;
    return { cargoColuna: CARGO_BASE_PERFIL_PERSONALIZADO, perfilPersonalizado: valor, perfil: valor };
}

async function listaDePerfisValidos() {
    const estado = await lerEstado(pool);
    if (!estado.preparado) return CARGOS_SISTEMA;
    const r = await pool.query(`SELECT chave FROM perfis_acesso ORDER BY sistema DESC, chave`);
    return r.rows.map((x) => x.chave);
}

// Acrescenta perfil / perfil_nome em cada linha (sem mexer no resto).
async function comPerfil(linhas) {
    const estado = await lerEstado(pool);
    let personalizados = new Map();
    let nomes = new Map(PERFIS_SISTEMA.map((p) => [p.chave, p.nome]));
    if (estado.preparado) {
        personalizados = new Map((await pool.query(`SELECT colaborador_id, perfil FROM colaborador_perfil`)).rows.map((r) => [r.colaborador_id, r.perfil]));
        nomes = new Map((await pool.query(`SELECT chave, nome FROM perfis_acesso`)).rows.map((r) => [r.chave, r.nome]));
    }
    return linhas.map((l) => {
        const perfil = personalizados.get(l.id) || l.cargo;
        return { ...l, perfil, perfil_nome: nomes.get(perfil) || perfil };
    });
}

async function contarOutrosAdminsAtivos(idExcluido) {
    const r = await pool.query(`SELECT COUNT(*)::int AS total FROM colaboradores WHERE cargo = 'admin' AND ativo = true AND id <> $1`, [idExcluido]);
    return r.rows[0].total;
}

// GET /colaboradores/perfis
// Perfis que dá pra escolher no cadastro (os 5 cargos de sempre + os criados
// no painel de Controle de acesso). Declarada antes das rotas com :id.
router.get('/perfis', async (req, res) => {
    try {
        res.json(await listarPerfis(pool));
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar perfis' });
    }
});

// GET /colaboradores
// Lista todos, sem o hash da senha.
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, email, cargo, ativo, senha_temporaria, criado_em, atualizado_em
             FROM colaboradores
             ORDER BY nome ASC`
        );
        res.json(await comPerfil(rows));
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar colaboradores' });
    }
});

// POST /colaboradores
// Body: { nome, email, senha, perfil } (ou cargo - mesmo significado)
router.post('/', async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    const pedido = req.body?.perfil ?? req.body?.cargo;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Informe nome, e-mail e senha' });
    }
    if (senha.length < 6) {
        return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }

    const client = await pool.connect();
    try {
        const destino = await resolverPerfil(pedido);
        if (!destino) {
            const validos = await listaDePerfisValidos();
            return res.status(400).json({ erro: `Perfil inválido. Use um destes: ${validos.join(', ')}` });
        }
        if (destino.cargoColuna === 'admin' && !(await podeGerenciarAcessos(pool, req.usuario))) {
            return res.status(403).json({ erro: 'Só quem gerencia acessos pode cadastrar um administrador.' });
        }

        const senhaHash = await gerarHashSenha(senha);
        await client.query('BEGIN');
        // senha_temporaria = true: essa senha foi definida pelo admin
        // no cadastro, não pelo próprio colaborador - o front-end
        // obriga a troca no primeiro login.
        const { rows } = await client.query(
            `INSERT INTO colaboradores (nome, email, senha_hash, cargo, senha_temporaria)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, nome, email, cargo, ativo, senha_temporaria, criado_em`,
            [nome, email, senhaHash, destino.cargoColuna]
        );
        if (destino.perfilPersonalizado) {
            await client.query(`INSERT INTO colaborador_perfil (colaborador_id, perfil) VALUES ($1, $2)`, [rows[0].id, destino.perfilPersonalizado]);
        }
        await client.query('COMMIT');
        limparCache();
        await auditar(pool, req, 'colaborador_criado', {
            tela: 'colaboradores',
            alvo: `${nome} (#${rows[0].id})`,
            depois: { email, perfil: destino.perfil },
        });
        res.status(201).json((await comPerfil(rows))[0]);
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.code === '23505') {
            return res.status(409).json({ erro: 'Já existe um colaborador com esse e-mail' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao criar colaborador' });
    } finally {
        client.release();
    }
});

// PUT /colaboradores/:id
// Body: { nome?, email?, perfil? (ou cargo?), ativo?, senha? }
// Todos os campos são opcionais - atualiza só o que vier no body.
// "senha" só entra se vier preenchida (troca de senha pelo admin).
router.put('/:id', async (req, res) => {
    const { nome, email, ativo, senha } = req.body || {};
    let pedido = req.body?.perfil;
    const cargoLegado = req.body?.cargo;

    if (senha !== undefined && senha !== '' && senha.length < 6) {
        return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }

    const client = await pool.connect();
    try {
        const atual = await client.query(`SELECT id, nome, email, cargo, ativo FROM colaboradores WHERE id = $1`, [req.params.id]);
        if (atual.rowCount === 0) {
            return res.status(404).json({ erro: 'Colaborador não encontrado' });
        }
        const alvo = (await comPerfil(atual.rows))[0];

        // Tela antiga manda só "cargo" - e manda de volta o cargo-base de quem tem
        // perfil personalizado. Isso NÃO é pedido de troca de perfil.
        if (pedido === undefined && cargoLegado !== undefined && !(alvo.perfil !== alvo.cargo && cargoLegado === alvo.cargo)) {
            pedido = cargoLegado;
        }

        const quemGerencia = await podeGerenciarAcessos(pool, req.usuario);
        if (alvo.cargo === 'admin' && !quemGerencia) {
            return res.status(403).json({ erro: 'Só quem gerencia acessos pode alterar um administrador.' });
        }

        let destino = null;
        if (pedido !== undefined && pedido !== alvo.perfil) {
            destino = await resolverPerfil(pedido);
            if (!destino) {
                const validos = await listaDePerfisValidos();
                return res.status(400).json({ erro: `Perfil inválido. Use um destes: ${validos.join(', ')}` });
            }
            if (destino.cargoColuna === 'admin' && !quemGerencia) {
                return res.status(403).json({ erro: 'Só quem gerencia acessos pode promover alguém a administrador.' });
            }
        }

        // Último administrador ativo: não rebaixar nem desativar.
        const deixaDeSerAdminAtivo =
            alvo.cargo === 'admin' && alvo.ativo && ((destino && destino.cargoColuna !== 'admin') || (ativo !== undefined && !Boolean(ativo)));
        if (deixaDeSerAdminAtivo && (await contarOutrosAdminsAtivos(alvo.id)) === 0) {
            return res.status(409).json({ erro: 'Esse é o último administrador ativo - o sistema precisa de pelo menos um.' });
        }

        const campos = [];
        const valores = [];
        let i = 1;
        const antes = {};
        const depois = {};

        if (nome !== undefined) {
            campos.push(`nome = $${i++}`);
            valores.push(String(nome).trim());
            if (String(nome).trim() !== alvo.nome) {
                antes.nome = alvo.nome;
                depois.nome = String(nome).trim();
            }
        }
        if (email !== undefined) {
            campos.push(`email = $${i++}`);
            valores.push(String(email).trim().toLowerCase());
            if (String(email).trim().toLowerCase() !== alvo.email) {
                antes.email = alvo.email;
                depois.email = String(email).trim().toLowerCase();
            }
        }
        if (destino) {
            campos.push(`cargo = $${i++}`);
            valores.push(destino.cargoColuna);
            antes.perfil = alvo.perfil;
            depois.perfil = destino.perfil;
        }
        if (ativo !== undefined) {
            campos.push(`ativo = $${i++}`);
            valores.push(Boolean(ativo));
            if (Boolean(ativo) !== alvo.ativo) {
                antes.ativo = alvo.ativo;
                depois.ativo = Boolean(ativo);
            }
        }
        if (senha !== undefined && senha !== '') {
            const senhaHash = await gerarHashSenha(senha);
            campos.push(`senha_hash = $${i++}`);
            valores.push(senhaHash);
            // Senha definida pelo admin (reset) - obriga o colaborador
            // a trocar no próximo login, mesma regra do cadastro novo.
            campos.push(`senha_temporaria = true`);
            depois.senha = 'redefinida';
        }

        if (campos.length === 0) {
            return res.status(400).json({ erro: 'Nada para atualizar' });
        }

        campos.push(`atualizado_em = now()`);
        valores.push(req.params.id);

        await client.query('BEGIN');
        const { rows } = await client.query(
            `UPDATE colaboradores SET ${campos.join(', ')} WHERE id = $${i}
             RETURNING id, nome, email, cargo, ativo, senha_temporaria, criado_em, atualizado_em`,
            valores
        );
        if (destino) {
            if (destino.perfilPersonalizado) {
                await client.query(
                    `INSERT INTO colaborador_perfil (colaborador_id, perfil) VALUES ($1, $2)
                     ON CONFLICT (colaborador_id) DO UPDATE SET perfil = EXCLUDED.perfil, atualizado_em = now()`,
                    [alvo.id, destino.perfilPersonalizado]
                );
            } else if ((await lerEstado(pool)).preparado) {
                await client.query(`DELETE FROM colaborador_perfil WHERE colaborador_id = $1`, [alvo.id]);
            }
        }
        await client.query('COMMIT');
        limparCache();

        await auditar(pool, req, 'colaborador_alterado', {
            tela: 'colaboradores',
            alvo: `${alvo.nome} (#${alvo.id})`,
            antes,
            depois,
        });
        res.json((await comPerfil(rows))[0]);
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.code === '23505') {
            return res.status(409).json({ erro: 'Já existe um colaborador com esse e-mail' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar colaborador' });
    } finally {
        client.release();
    }
});

module.exports = router;
