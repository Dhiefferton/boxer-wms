// ============================================================
// Agenda automática de inventário
//
// Regra: dispara uma rodada de contagem cíclica automaticamente
// na primeira semana de cada mês (dia 1 ao 7) - só uma vez por
// mês, mesmo que o processo reinicie várias vezes nesse período.
//
// Como evita duplicar: antes de gerar, verifica se já existe
// alguma contagem do tipo 'ciclico' criada neste mês (incluindo
// as que o próprio botão manual do dashboard já tiver gerado) -
// se já tiver, não gera de novo.
// ============================================================
const pool = require('./db');
const { gerarContagemCiclica } = require('./routes/inventario');

const QUANTIDADE_POR_RODADA = 10;
const INTERVALO_VERIFICACAO_MS = 6 * 60 * 60 * 1000; // checa a cada 6h

async function jaRodouEsseMes() {
    const { rowCount } = await pool.query(
        `SELECT 1 FROM contagens_inventario
         WHERE tipo = 'ciclico' AND criado_em >= date_trunc('month', now())
         LIMIT 1`
    );
    return rowCount > 0;
}

async function verificarAgenda() {
    const hoje = new Date();
    const diaDoMes = hoje.getDate();

    if (diaDoMes > 7) {
        return; // fora da primeira semana do mês
    }

    try {
        if (await jaRodouEsseMes()) {
            return; // já gerou (automático ou manual) neste mês
        }

        const criadas = await gerarContagemCiclica(QUANTIDADE_POR_RODADA);
        console.log(`[inventario] Contagem cíclica automática do mês gerada: ${criadas.length} tarefa(s).`);
    } catch (erro) {
        console.error('[inventario] Falha ao gerar contagem cíclica automática:', erro.message);
    }
}

function iniciarAgendaInventario() {
    console.log('[inventario] Agenda automática ligada (roda 1x no dia 1-7 de cada mês).');
    verificarAgenda(); // checa uma vez já na subida, além de continuar checando
    setInterval(verificarAgenda, INTERVALO_VERIFICACAO_MS);
}

module.exports = { iniciarAgendaInventario };
