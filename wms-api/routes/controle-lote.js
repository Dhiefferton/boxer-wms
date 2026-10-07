// ============================================================
// Controle de Lote - relatorio (estilo planilha) com Data Chegada,
// N° NF, Código, Modelo, Lote, Romaneio e Quantidade.
//
// Os dados vêm de duas origens (coluna "origem" na tabela):
// - recebimento_wms: gravados em nf-importacao.js (função
//   capturarControleLote) no momento em que o colaborador confirma o
//   recebimento de um item da NF no WMS.
// - importacao_historica: carga única da planilha "Controle
//   Etiquetas" (2021-2026, controle manual usado antes do WMS).
//
// GET   /controle-lote                  lê (qualquer pessoa logada)
// PATCH /controle-lote/:id              EDITA os 7 campos (06/10/2026) - só
//                                       administrador (ou quem tiver a
//                                       permissão 'sistema.manutencao' no
//                                       modo ativo do Controle de acesso)
// GET   /controle-lote/:id/historico    histórico das edições da linha (leitura)
//
// Edição é segura por construção: nunca apaga linha, grava ANTES/DEPOIS de
// cada alteração (tabela controle_lote_historico, criada sozinha na primeira
// edição - só adiciona, não mexe em nada existente) e também na auditoria do
// Controle de acesso.
// ============================================================
const express = require('express');
const pool = require('../db');
const { exigirCargo } = require('../auth');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROLE = /[\u0000-\u001f\u007f]/;

// campo da API -> coluna do banco
const CAMPOS = {
    dataChegada: 'data_chegada',
    numeroNf: 'numero_nf',
    codigo: 'sku',
    modelo: 'modelo',
    lote: 'lote',
    romaneio: 'romaneio',
    quantidade: 'quantidade',
};
const ROTULOS = {
    dataChegada: 'Data Chegada',
    numeroNf: 'N° NF',
    codigo: 'Código',
    modelo: 'Modelo',
    lote: 'Lote',
    romaneio: 'Romaneio',
    quantidade: 'Quantidade',
};

function paraApi(r) {
    return {
        id: r.id,
        dataChegada: r.data_chegada,
        numeroNf: r.numero_nf,
        codigo: r.sku,
        modelo: r.modelo,
        lote: r.lote,
        romaneio: r.romaneio,
        quantidade: Number(r.quantidade),
    };
}

// GET /controle-lote?texto=&first=&max=
router.get('/', async (req, res) => {
    try {
        const texto = (req.query.texto || '').trim();
        const first = Math.max(Number(req.query.first) || 0, 0);
        const max = Math.min(Math.max(Number(req.query.max) || 100, 1), 500);

        const valores = [];
        let where = '';
        if (texto) {
            valores.push(`%${texto}%`);
            where = `WHERE (sku ILIKE $1 OR modelo ILIKE $1 OR numero_nf ILIKE $1 OR lote ILIKE $1 OR romaneio ILIKE $1)`;
        }

        valores.push(max, first);
        const paramMax = `$${valores.length - 1}`;
        const paramFirst = `$${valores.length}`;

        const { rows } = await pool.query(
            `SELECT id, data_chegada, numero_nf, sku, modelo, lote, romaneio, quantidade
             FROM controle_lote
             ${where}
             ORDER BY data_chegada DESC
             LIMIT ${paramMax} OFFSET ${paramFirst}`,
            valores
        );

        res.json(rows.map(paraApi));
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar controle de lote' });
    }
});

// ------------------------------------------------------------
// Validação dos campos enviados. Só valida o que veio no corpo (edição
// parcial). Devolve { valores: {coluna: valor}, erro }.
// ------------------------------------------------------------
function texto(valor, rotulo, { obrigatorio, max }) {
    if (valor === null || valor === undefined) valor = '';
    if (typeof valor !== 'string' && typeof valor !== 'number') return { erro: `${rotulo} inválido` };
    const t = String(valor).trim();
    if (!t) {
        if (obrigatorio) return { erro: `${rotulo} é obrigatório` };
        return { valor: null };
    }
    if (t.length > max) return { erro: `${rotulo} aceita no máximo ${max} caracteres` };
    if (CONTROLE.test(t)) return { erro: `${rotulo} tem caracteres inválidos` };
    return { valor: t };
}

// Aceita 'AAAA-MM-DD' (campo de data da tela) ou data/hora ISO completa.
// 'AAAA-MM-DD' vira meio-dia no horário de Brasília: aparece no dia certo em
// qualquer fuso próximo e não "volta um dia" por causa do UTC.
function data(valor) {
    if (typeof valor !== 'string' || !valor.trim()) return { erro: 'Data Chegada inválida' };
    const v = valor.trim();
    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [a, m, dia] = v.split('-').map(Number);
        const teste = new Date(Date.UTC(a, m - 1, dia));
        if (teste.getUTCFullYear() !== a || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== dia) {
            return { erro: 'Data Chegada inválida' };
        }
        d = new Date(`${v}T12:00:00-03:00`);
    } else {
        d = new Date(v);
    }
    if (Number.isNaN(d.getTime())) return { erro: 'Data Chegada inválida' };
    const ano = d.getUTCFullYear();
    if (ano < 2000 || ano > 2100) return { erro: 'Data Chegada fora do intervalo aceito (2000 a 2100)' };
    return { valor: d.toISOString() };
}

function quantidade(valor) {
    if (valor === '' || valor === null || valor === undefined || typeof valor === 'boolean') {
        return { erro: 'Quantidade é obrigatória' };
    }
    const n = Number(typeof valor === 'string' ? valor.replace(',', '.') : valor);
    if (!Number.isFinite(n)) return { erro: 'Quantidade inválida' };
    if (n < 0) return { erro: 'Quantidade não pode ser negativa' };
    if (n > 10000000) return { erro: 'Quantidade grande demais' };
    return { valor: Math.round(n * 1000) / 1000 };
}

function validar(corpo) {
    const valores = {};
    const campos = Object.keys(CAMPOS).filter((c) => Object.prototype.hasOwnProperty.call(corpo, c));
    if (campos.length === 0) return { erro: 'Nenhum campo para alterar' };
    for (const c of campos) {
        let r;
        if (c === 'dataChegada') r = data(corpo[c]);
        else if (c === 'quantidade') r = quantidade(corpo[c]);
        else if (c === 'codigo') r = texto(corpo[c], ROTULOS[c], { obrigatorio: true, max: 60 });
        else if (c === 'romaneio') r = texto(corpo[c], ROTULOS[c], { obrigatorio: true, max: 60 });
        else if (c === 'lote') r = texto(corpo[c], ROTULOS[c], { obrigatorio: false, max: 120 });
        else if (c === 'numeroNf') r = texto(corpo[c], ROTULOS[c], { obrigatorio: false, max: 30 });
        else r = texto(corpo[c], ROTULOS[c], { obrigatorio: false, max: 255 });
        if (r.erro) return { erro: r.erro, campo: c };
        valores[c] = r.valor;
    }
    return { valores };
}

function ipDaRequisicao(req) {
    const encaminhado = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return (encaminhado || req?.ip || req?.socket?.remoteAddress || '').slice(0, 80) || null;
}

// Tabela nova, só de histórico. Sem FK e sem DELETE: nunca atrapalha o
// controle_lote nem o recebimento. RLS ligada como as demais tabelas.
async function garantirHistorico(cliente) {
    await cliente.query('SELECT pg_advisory_xact_lock(727004)');
    await cliente.query(`
        CREATE TABLE IF NOT EXISTS controle_lote_historico (
            id BIGSERIAL PRIMARY KEY,
            controle_lote_id UUID NOT NULL,
            alterado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
            alterado_por_id INTEGER,
            alterado_por_nome TEXT,
            antes JSONB NOT NULL,
            depois JSONB NOT NULL,
            motivo TEXT,
            ip TEXT
        )`);
    await cliente.query(
        'CREATE INDEX IF NOT EXISTS idx_controle_lote_historico_linha ON controle_lote_historico (controle_lote_id, alterado_em DESC)'
    );
    await cliente.query('ALTER TABLE controle_lote_historico ENABLE ROW LEVEL SECURITY');
}

function iguais(campo, a, b) {
    if (campo === 'dataChegada') return new Date(a).getTime() === new Date(b).getTime();
    if (campo === 'quantidade') return Number(a) === Number(b);
    return (a ?? null) === (b ?? null);
}

// PATCH /controle-lote/:id
// Body: qualquer um de { dataChegada, numeroNf, codigo, modelo, lote,
// romaneio, quantidade } + motivo (opcional). Só os campos enviados mudam.
router.patch('/:id', exigirCargo('admin'), async (req, res) => {
    const id = String(req.params.id || '');
    if (!UUID.test(id)) return res.status(400).json({ erro: 'Linha inválida' });

    const corpo = req.body && typeof req.body === 'object' ? req.body : {};
    const { valores, erro, campo } = validar(corpo);
    if (erro) return res.status(400).json({ erro, campo });
    const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 300) || null : null;

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        await garantirHistorico(cliente);

        const { rows } = await cliente.query(
            `SELECT id, data_chegada, numero_nf, sku, modelo, lote, romaneio, quantidade
             FROM controle_lote WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (rows.length === 0) {
            await cliente.query('ROLLBACK');
            return res.status(404).json({ erro: 'Linha não encontrada (talvez outra pessoa já alterou a lista - atualize a tela)' });
        }
        const atual = paraApi(rows[0]);

        const antes = {};
        const depois = {};
        const sets = [];
        const params = [];
        for (const c of Object.keys(valores)) {
            const novo = c === 'dataChegada' ? new Date(valores[c]) : valores[c];
            if (iguais(c, atual[c], novo)) continue;
            antes[c] = c === 'dataChegada' ? new Date(atual[c]).toISOString() : atual[c];
            depois[c] = c === 'dataChegada' ? new Date(novo).toISOString() : novo;
            params.push(valores[c]);
            sets.push(`${CAMPOS[c]} = $${params.length}`);
        }
        if (sets.length === 0) {
            await cliente.query('ROLLBACK');
            return res.json({ alterado: false, linha: atual });
        }

        params.push(id);
        const resultado = await cliente.query(
            `UPDATE controle_lote SET ${sets.join(', ')} WHERE id = $${params.length}
             RETURNING id, data_chegada, numero_nf, sku, modelo, lote, romaneio, quantidade`,
            params
        );
        await cliente.query(
            `INSERT INTO controle_lote_historico (controle_lote_id, alterado_por_id, alterado_por_nome, antes, depois, motivo, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, req.usuario?.id ?? null, req.usuario?.nome ?? null, JSON.stringify(antes), JSON.stringify(depois), motivo, ipDaRequisicao(req)]
        );
        await cliente.query('COMMIT');

        // Auditoria central (Controle de acesso > Auditoria). Não derruba nada se falhar.
        try {
            const { auditar } = require('../lib/permissoes');
            await auditar(pool, req, 'controle_lote_editado', {
                tela: 'controle-lote',
                alvo: `${atual.codigo} / lote ${atual.lote || '-'} / romaneio ${atual.romaneio}`,
                antes,
                depois,
                motivo,
            });
        } catch (e) {
            console.error('[controle-lote] auditoria central indisponível:', e.message);
        }

        res.json({ alterado: true, linha: paraApi(resultado.rows[0]), campos: Object.keys(depois) });
    } catch (e) {
        try { await cliente.query('ROLLBACK'); } catch (_) { /* já encerrada */ }
        if (e.code === '23505') {
            return res.status(409).json({ erro: 'Já existe outra linha com essa mesma combinação de NF, código, lote e romaneio.' });
        }
        if (e.code === '22001') {
            return res.status(400).json({ erro: 'Algum texto é maior do que o campo aceita' });
        }
        console.error('[controle-lote] falha ao editar:', e);
        res.status(500).json({ erro: 'Falha ao salvar a edição' });
    } finally {
        cliente.release();
    }
});

// GET /controle-lote/:id/historico
// Leitura, como a própria lista: qualquer pessoa logada (mesma regra da lista no
// controle de acesso - o catálogo trata /controle-lote GET como aberto). Quem
// altera é só o administrador; a tela só mostra o relógio pra quem pode editar.
router.get('/:id/historico', async (req, res) => {
    const id = String(req.params.id || '');
    if (!UUID.test(id)) return res.status(400).json({ erro: 'Linha inválida' });
    try {
        const { rows } = await pool.query(
            `SELECT id, alterado_em, alterado_por_nome, antes, depois, motivo
             FROM controle_lote_historico WHERE controle_lote_id = $1
             ORDER BY alterado_em DESC, id DESC LIMIT 100`,
            [id]
        );
        res.json(
            rows.map((r) => ({
                id: r.id,
                alteradoEm: r.alterado_em,
                alteradoPor: r.alterado_por_nome,
                antes: r.antes,
                depois: r.depois,
                motivo: r.motivo,
            }))
        );
    } catch (e) {
        // 42P01 = a tabela ainda não existe (nenhuma edição feita até agora)
        if (e.code === '42P01') return res.json([]);
        console.error('[controle-lote] falha ao ler histórico:', e);
        res.status(500).json({ erro: 'Falha ao ler o histórico' });
    }
});

module.exports = router;
