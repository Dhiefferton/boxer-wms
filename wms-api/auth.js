// ============================================================
// Autenticacao e niveis de acesso (Fase 3)
// Login proprio (nao usa Supabase Auth): e-mail + senha com hash
// bcrypt, sessao via token JWT. Este modulo concentra:
//   - gerar/conferir hash de senha
//   - gerar/verificar o token JWT
//   - os dois middlewares que protegem as rotas: exigirLogin (so
//     exige estar logado) e exigirCargo (exige um cargo especifico,
//     ademais de estar logado)
//
// Cargos validos (mesma lista da tabela colaboradores):
//   admin                  - acesso total (sempre passa em
//                             qualquer exigirCargo, nao precisa
//                             listar 'admin' toda vez)
//   conferente              - telas de conferencia de embarque
//   picking                 - telas de separacao/picking
//   recebimento_reposicao   - telas de recebimento e reposicao
// ============================================================
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    // Nao derruba o servidor pra nao quebrar outros endpoints que
    // nao dependem de login, mas login/sessao nao funcionam direito
    // sem isso - configurar JWT_SECRET no ambiente (Vercel) o quanto
    // antes.
    console.warn(
        'AVISO: variável de ambiente JWT_SECRET não configurada. ' +
        'Usando um valor padrão (inseguro) só pra não derrubar o servidor - configure JWT_SECRET antes de usar em produção.'
    );
}
const SEGREDO = JWT_SECRET || 'boxer-wms-troque-esse-segredo-configurando-JWT_SECRET';
const VALIDADE_TOKEN = '12h';

function gerarHashSenha(senha) {
    return bcrypt.hash(senha, 10);
}

function conferirSenha(senha, hash) {
    return bcrypt.compare(senha, hash);
}

// Gera o token JWT da sessao. O payload guarda so o que as rotas
// precisam pra decidir acesso e pra preencher "operador" no
// historico - nunca a senha/hash.
function gerarToken(colaborador) {
    return jwt.sign(
        {
            id: colaborador.id,
            nome: colaborador.nome,
            email: colaborador.email,
            cargo: colaborador.cargo,
        },
        SEGREDO,
        { expiresIn: VALIDADE_TOKEN }
    );
}

function verificarToken(token) {
    return jwt.verify(token, SEGREDO);
}

// Middleware: exige um token valido no header "Authorization: Bearer <token>".
// Preenche req.usuario com { id, nome, email, cargo } quando valido.
function exigirLogin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [tipo, token] = authHeader.split(' ');
    if (tipo !== 'Bearer' || !token) {
        return res.status(401).json({ erro: 'Login necessário' });
    }
    try {
        req.usuario = verificarToken(token);
        next();
    } catch (erro) {
        return res.status(401).json({ erro: 'Sessão inválida ou expirada, faça login novamente' });
    }
}

// Middleware: exige que o usuario logado tenha um dos cargos
// informados. Sempre usar DEPOIS de exigirLogin na cadeia da rota.
// 'admin' sempre passa, mesmo sem estar na lista - e o cargo com
// acesso total do sistema.
function exigirCargo(...cargosPermitidos) {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ erro: 'Login necessário' });
        }
        if (req.usuario.cargo === 'admin' || cargosPermitidos.includes(req.usuario.cargo)) {
            return next();
        }
        return res.status(403).json({ erro: 'Seu nível de acesso não permite essa ação' });
    };
}

module.exports = {
    gerarHashSenha,
    conferirSenha,
    gerarToken,
    verificarToken,
    exigirLogin,
    exigirCargo,
};
