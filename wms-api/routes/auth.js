// ============================================================
// Rotas de autenticacao
// Login por e-mail/senha e consulta da sessao atual. Nao ha
// cadastro publico aqui - colaboradores sao criados por um admin
// na tela de gestao (ver routes/colaboradores.js).
// ============================================================
const express = require('express');
const pool = require('../db');
const { conferirSenha, gerarHashSenha, gerarToken, exigirLogin } = require('../auth');

const router = express.Router();

// POST /auth/login
// Body: { email, senha }
router.post('/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Informe e-mail e senha' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id, nome, email, senha_hash, cargo, ativo, senha_temporaria FROM colaboradores WHERE email = $1`,
            [email]
        );
        const colaborador = rows[0];

        // Mesma mensagem genérica pra e-mail não encontrado, senha
        // errada e usuário inativo - não dá pra quem tenta logar
        // adivinhar qual dessas é o caso.
        if (!colaborador || !colaborador.ativo) {
            return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
        }

        const senhaConfere = await conferirSenha(senha, colaborador.senha_hash);
        if (!senhaConfere) {
            return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
        }

        const token = gerarToken(colaborador);
        res.json({
            token,
            colaborador: {
                id: colaborador.id,
                nome: colaborador.nome,
                email: colaborador.email,
                cargo: colaborador.cargo,
                // true quando a senha foi definida por um admin
                // (cadastro novo ou reset) e ainda não foi trocada -
                // o front-end obriga a troca antes de liberar o resto.
                precisaTrocarSenha: colaborador.senha_temporaria,
            },
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao processar login' });
    }
});

// GET /auth/me
// Confere o token e devolve os dados atuais do colaborador
// direto do banco (não só o que estava no token quando ele foi
// gerado) - assim, se um admin desativar ou trocar o cargo de
// alguém, isso é refletido na próxima checagem, mesmo com o token
// antigo ainda "válido" no sentido de assinatura/expiração.
router.get('/me', exigirLogin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, email, cargo, ativo, senha_temporaria FROM colaboradores WHERE id = $1`,
            [req.usuario.id]
        );
        const colaborador = rows[0];
        if (!colaborador || !colaborador.ativo) {
            return res.status(401).json({ erro: 'Sessão inválida ou usuário desativado' });
        }
        res.json({
            id: colaborador.id,
            nome: colaborador.nome,
            email: colaborador.email,
            cargo: colaborador.cargo,
            precisaTrocarSenha: colaborador.senha_temporaria,
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar sessão' });
    }
});

// PATCH /auth/senha
// Body: { senhaAtual, novaSenha } - troca a propria senha (qualquer
// colaborador logado, de qualquer cargo). Exige a senha atual, seja
// ela definitiva ou temporaria - garante que quem esta trocando e
// mesmo quem sabe a senha em uso agora. Ao trocar, tira a marca de
// "senha temporaria" (se estava marcada), liberando o resto do
// sistema pra quem estava no primeiro acesso obrigatorio.
router.patch('/senha', exigirLogin, async (req, res) => {
    const senhaAtual = String(req.body?.senhaAtual || '');
    const novaSenha = String(req.body?.novaSenha || '');

    if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ erro: 'Informe a senha atual e a nova senha' });
    }
    if (novaSenha.length < 6) {
        return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id, senha_hash FROM colaboradores WHERE id = $1`,
            [req.usuario.id]
        );
        const colaborador = rows[0];
        if (!colaborador) {
            return res.status(401).json({ erro: 'Sessão inválida' });
        }

        const senhaConfere = await conferirSenha(senhaAtual, colaborador.senha_hash);
        if (!senhaConfere) {
            return res.status(401).json({ erro: 'Senha atual incorreta' });
        }

        const novoHash = await gerarHashSenha(novaSenha);
        await pool.query(
            `UPDATE colaboradores SET senha_hash = $2, senha_temporaria = false, atualizado_em = now() WHERE id = $1`,
            [colaborador.id, novoHash]
        );

        res.json({ status: 'senha_atualizada' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao trocar a senha' });
    }
});

module.exports = router;
