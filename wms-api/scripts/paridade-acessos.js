#!/usr/bin/env node
// ============================================================
// Teste de paridade do controle de acesso (05/10/2026)
//
// Compara, para CADA rota da API e CADA cargo, a decisão da regra ANTIGA
// (exigirCargo no index.js e dentro das rotas + bloquearEscritaSomenteLeitura)
// com a da regra NOVA (catálogo de permissões em lib/permissoes.js).
// Não precisa de banco nem de servidor: lê o código-fonte.
//
// Uso (na pasta wms-api):   node scripts/paridade-acessos.js
// Rode antes de publicar qualquer mudança em rotas: se uma rota nova tiver
// restrição própria que o catálogo não conhece, o teste falha aqui em vez de
// afrouxar o acesso em produção.
//
// Saída: lista de diferenças. Duas classes:
//   - ESPERADA: leitura (GET) de módulo cuja tela tem permissão própria - a
//     regra nova também bloqueia a leitura de quem não tem a tela (antes só
//     o menu escondia). Aparece como "LEITURA".
//   - ERRO: qualquer outra diferença (acesso que mudou sem querer).
// Código de saída 1 se houver ERRO.
// ============================================================
const fs = require('fs');
const path = require('path');
const { MODULOS, resolverRota, decidirComPadrao, CATALOGO } = require('../lib/permissoes');

const RAIZ = path.join(__dirname, '..');
const CARGOS = ['admin', 'conferente', 'picking', 'recebimento_reposicao', 'engenharia_produtos'];

const indexSrc = fs.readFileSync(path.join(RAIZ, 'index.js'), 'utf8');

// require('./routes/x') por variável
const requires = {};
for (const m of indexSrc.matchAll(/const\s+(\w+)\s*=\s*require\('\.\/routes\/([\w-]+)'\)/g)) requires[m[1]] = m[2];

// app.use('/prefixo', guardas..., roteador)
const montagens = [];
for (const m of indexSrc.matchAll(/^app\.use\('(\/[\w-]+)',\s*([^;]+)\);/gm)) {
    const prefixo = m[1];
    const args = m[2].split(/,(?![^()]*\))/).map((a) => a.trim());
    const roteador = args[args.length - 1];
    if (!requires[roteador]) continue;
    const guardas = args.slice(0, -1);
    const exigir = guardas.find((g) => g.startsWith('exigirCargo('));
    montagens.push({
        prefixo,
        arquivo: requires[roteador],
        exigirCargo: exigir ? [...exigir.matchAll(/'([\w]+)'/g)].map((x) => x[1]) : null,
        bloquear: guardas.includes('bloquearEscritaSomenteLeitura'),
        login: guardas.includes('exigirLogin'),
    });
}

const PUBLICOS = new Set(['/auth', '/erp', '/frotas']);
const problemas = [];
const leituras = [];
let rotasVerificadas = 0;

for (const mt of montagens) {
    if (PUBLICOS.has(mt.prefixo)) continue;
    if (!MODULOS[mt.prefixo]) {
        problemas.push(`Módulo ${mt.prefixo} está no index.js mas não está em MODULOS (lib/permissoes.js): ficaria fora do gate.`);
        continue;
    }
    const src = fs.readFileSync(path.join(RAIZ, 'routes', mt.arquivo + '.js'), 'utf8');
    const chamadas = [...src.matchAll(/^router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2([^]*?)(?=^router\.|^module\.exports|\n\/\/ ====|$(?![\s\S]))/gm)];
    const total = (src.match(/^router\.(get|post|put|patch|delete)\(/gm) || []).length;
    if (chamadas.length !== total) {
        problemas.push(`${mt.arquivo}.js: ${total} rotas, mas só ${chamadas.length} lidas pelo teste (padrão de rota diferente).`);
    }
    for (const c of chamadas) {
        const metodo = c[1].toUpperCase();
        const caminhoRota = c[3];
        const cabecalho = c[4].split(/async\s*\(|\(req,\s*res/)[0];
        const exigirRota = [...cabecalho.matchAll(/exigirCargo\(([^)]*)\)/g)].map((x) => [...x[1].matchAll(/'([\w]+)'/g)].map((y) => y[1]));
        const caminho = (mt.prefixo + (caminhoRota === '/' ? '' : caminhoRota)).replace(/:[A-Za-z_]+/g, '123');
        const exigida = resolverRota(metodo, caminho);
        if (exigida && exigida.desconhecido) {
            problemas.push(`${metodo} ${caminho}: rota fora do gate (módulo desconhecido).`);
            continue;
        }
        for (const cargo of CARGOS) {
            // regra antiga
            let antiga = true;
            if (mt.exigirCargo && !(cargo === 'admin' || mt.exigirCargo.includes(cargo))) antiga = false;
            for (const lista of exigirRota) if (!(cargo === 'admin' || lista.includes(cargo))) antiga = false;
            if (mt.bloquear && cargo === 'engenharia_produtos' && metodo !== 'GET') antiga = false;
            // regra nova
            const nova = decidirComPadrao(cargo, exigida);
            rotasVerificadas++;
            if (antiga !== nova) {
                const linha = `${cargo.padEnd(22)} ${metodo.padEnd(6)} ${caminho}  antiga=${antiga ? 'permite' : 'nega'}  nova=${nova ? 'permite' : 'nega'}  (${exigida ? exigida.chaves.join(' ou ') : 'sem exigência'})`;
                const esperada = metodo === 'GET' && antiga && !nova && MODULOS[mt.prefixo].leitura;
                (esperada ? leituras : problemas).push(esperada ? linha : 'DIFERENÇA: ' + linha);
            }
        }
    }
}

// Todas as chaves usadas nas rotas/MODULOS existem no catálogo?
const chaves = new Set(CATALOGO.map((p) => p.chave));
for (const [prefixo, m] of Object.entries(MODULOS)) {
    for (const k of [m.editar, m.excluir, ...(m.leitura || [])].filter(Boolean)) {
        if (!chaves.has(k)) problemas.push(`MODULOS ${prefixo}: permissão '${k}' não existe no catálogo.`);
    }
}

console.log(`Verificadas ${rotasVerificadas} combinações cargo x rota em ${montagens.length} montagens.`);
if (leituras.length) {
    console.log(`\nLEITURA (esperado - a regra nova também protege a leitura dos dados da tela): ${leituras.length}`);
    for (const l of leituras) console.log('  ' + l);
}
if (problemas.length) {
    console.log(`\nERROS: ${problemas.length}`);
    for (const p of problemas) console.log('  ' + p);
    process.exit(1);
}
console.log('\nOK: nenhuma diferença inesperada entre a regra antiga e a nova.');
