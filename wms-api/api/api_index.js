// ============================================================
// Entrypoint pro Vercel - ele procura arquivos dentro de /api e
// trata o que for exportado como um handler de requisição.
// Reaproveita o app Express de sempre (o mesmo que roda no
// Railway) - o app em si não muda nada, só o jeito de "servir"
// ele é diferente (sem app.listen, sem processo contínuo).
// ============================================================
module.exports = require('../index');
