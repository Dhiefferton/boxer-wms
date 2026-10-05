#!/usr/bin/env node
// ============================================================
// Gera permissoesPadrao.js dos dois frontends a partir do catálogo da API
// (05/10/2026). Esse arquivo só serve de reserva: se a API for antiga e não
// mandar a lista de permissões, o front usa o padrão por cargo. A garantia
// de verdade é sempre a API.
//
// Uso (na pasta wms-api):   node scripts/gerar-padrao-front.js
// Rode de novo (e publique os fronts) se mudar o `padrao` de alguma permissão.
// ============================================================
const fs = require('fs');
const path = require('path');
const { CATALOGO } = require('../lib/permissoes');

const RAIZ = path.join(__dirname, '..', '..');
const mapa = {};
for (const p of CATALOGO) {
    if (p.tipo === 'tela') mapa[p.chave] = p.padrao;
}
// Ações também entram: o front usa pode('produtos.excluir') etc.
for (const p of CATALOGO) {
    if (p.tipo === 'acao') mapa[p.chave] = p.padrao;
}

const linhas = Object.entries(mapa).map(([k, v]) => `    '${k}': ${JSON.stringify(v)},`);
const conteudo = [
    '// ARQUIVO GERADO - não edite à mão.',
    '// Gerado por wms-api/scripts/gerar-padrao-front.js a partir do catálogo de',
    '// permissões da API (wms-api/lib/permissoes.js). Chave da permissão -> cargos',
    '// que têm essa permissão por padrão (o administrador sempre tem tudo).',
    '// Só é usado como reserva quando a API não manda a lista de permissões.',
    'export const PADRAO_PERMISSOES = {',
    ...linhas,
    '};',
    '',
].join('\n');

for (const app of ['wms-dashboard', 'wms-coletor']) {
    const destino = path.join(RAIZ, app, 'src', 'auth', 'permissoesPadrao.js');
    if (!fs.existsSync(path.dirname(destino))) {
        console.error(`Pasta não encontrada: ${destino}`);
        process.exitCode = 1;
        continue;
    }
    fs.writeFileSync(destino, conteudo.replace(/\n/g, '\r\n'));
    console.log(`OK ${destino} (${Object.keys(mapa).length} permissões)`);
}
