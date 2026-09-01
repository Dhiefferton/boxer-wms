// ============================================================
// Rotas de autenticacao
// Login por e-mail/senha e consulta da sessao atual. Nao ha
// cadastro publico aqui - colaboradores sao criados por um admin
// na tela de gestao (ver routes/colaboradores.js).
// ============================================================
const express = require('express');
const pool = require('../db');
const { conferirSenha, gerarToken, exigirLogin } = require('../auth');

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
            `SELECT id, nome, email, senha_hash, cargo, ativo FROM colaboradores WHERE email = $1`,
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
            `SELECT id, nome, email, cargo, ativo FROM colaboradores WHERE id = $1`,
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
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar sessão' });
    }
});

module.exports = router;
