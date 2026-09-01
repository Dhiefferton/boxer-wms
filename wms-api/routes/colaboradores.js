// ============================================================
// Rotas de gestao de colaboradores (tela de administracao)
// Toda essa rota so admin acessa - protegido no index.js
// (exigirLogin + exigirCargo('admin') no app.use).
//
// Não existe exclusão de verdade aqui: desativar (ativo = false)
// em vez de apagar, senão perderíamos a referência de quem fez o
// quê no histórico de movimentações mais pra frente. Um
// colaborador desativado simplesmente não consegue mais logar.
// ============================================================
const express = require('express');
const pool = require('../db');
const { gerarHashSenha } = require('../auth');

const router = express.Router();

const CARGOS_VALIDOS = ['admin', 'conferente', 'picking', 'recebimento_reposicao'];

// GET /colaboradores
// Lista todos, sem o hash da senha.
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, email, cargo, ativo, senha_temporaria, criado_em, atualizado_em
             FROM colaboradores
             ORDER BY nome ASC`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar colaboradores' });
    }
});

// POST /colaboradores
// Body: { nome, email, senha, cargo }
router.post('/', async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    const cargo = req.body?.cargo;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Informe nome, e-mail e senha' });
    }
    if (senha.length < 6) {
        return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }
    if (!CARGOS_VALIDOS.includes(cargo)) {
        return res.status(400).json({ erro: `Cargo inválido. Use um destes: ${CARGOS_VALIDOS.join(', ')}` });
    }

    try {
        const senhaHash = await gerarHashSenha(senha);
        // senha_temporaria = true: essa senha foi definida pelo admin
        // no cadastro, não pelo próprio colaborador - o front-end
        // obriga a troca no primeiro login.
        const { rows } = await pool.query(
            `INSERT INTO colaboradores (nome, email, senha_hash, cargo, senha_temporaria)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, nome, email, cargo, ativo, senha_temporaria, criado_em`,
            [nome, email, senhaHash, cargo]
        );
        res.status(201).json(rows[0]);
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(409).json({ erro: 'Já existe um colaborador com esse e-mail' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao criar colaborador' });
    }
});

// PUT /colaboradores/:id
// Body: { nome?, email?, cargo?, ativo?, senha? }
// Todos os campos são opcionais - atualiza só o que vier no body.
// "senha" só entra se vier preenchida (troca de senha pelo admin).
router.put('/:id', async (req, res) => {
    const { nome, email, cargo, ativo, senha } = req.body || {};

    if (cargo !== undefined && !CARGOS_VALIDOS.includes(cargo)) {
        return res.status(400).json({ erro: `Cargo inválido. Use um destes: ${CARGOS_VALIDOS.join(', ')}` });
    }
    if (senha !== undefined && senha !== '' && senha.length < 6) {
        return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }

    try {
        const atual = await pool.query(`SELECT id FROM colaboradores WHERE id = $1`, [req.params.id]);
        if (atual.rowCount === 0) {
            return res.status(404).json({ erro: 'Colaborador não encontrado' });
        }

        const campos = [];
        const valores = [];
        let i = 1;

        if (nome !== undefined) {
            campos.push(`nome = $${i++}`);
            valores.push(String(nome).trim());
        }
        if (email !== undefined) {
            campos.push(`email = $${i++}`);
            valores.push(String(email).trim().toLowerCase());
        }
        if (cargo !== undefined) {
            campos.push(`cargo = $${i++}`);
            valores.push(cargo);
        }
        if (ativo !== undefined) {
            campos.push(`ativo = $${i++}`);
            valores.push(Boolean(ativo));
        }
        if (senha !== undefined && senha !== '') {
            const senhaHash = await gerarHashSenha(senha);
            campos.push(`senha_hash = $${i++}`);
            valores.push(senhaHash);
            // Senha definida pelo admin (reset) - obriga o colaborador
            // a trocar no próximo login, mesma regra do cadastro novo.
            campos.push(`senha_temporaria = true`);
        }

        if (campos.length === 0) {
            return res.status(400).json({ erro: 'Nada para atualizar' });
        }

        campos.push(`atualizado_em = now()`);
        valores.push(req.params.id);

        const { rows } = await pool.query(
            `UPDATE colaboradores SET ${campos.join(', ')} WHERE id = $${i}
             RETURNING id, nome, email, cargo, ativo, senha_temporaria, criado_em, atualizado_em`,
            valores
        );
        res.json(rows[0]);
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(409).json({ erro: 'Já existe um colaborador com esse e-mail' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar colaborador' });
    }
});

module.exports = router;
