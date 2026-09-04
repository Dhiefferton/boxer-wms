require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exigirLogin, exigirCargo } = require('./auth');
const authRouter = require('./routes/auth');
const colaboradoresRouter = require('./routes/colaboradores');
const enderecosRouter = require('./routes/enderecos');
const tarefasRouter = require('./routes/tarefas');
const recebimentoRouter = require('./routes/recebimento');
const produtosRouter = require('./routes/produtos');
const pedidosRouter = require('./routes/pedidos');
const inventarioRouter = require('./routes/inventario');
const reconciliarErpRouter = require('./routes/reconciliar-erp');
const unidadesSerializadasRouter = require('./routes/unidades-serializadas');
const movimentacoesRouter = require('./routes/movimentacoes');
const nfImportacaoRouter = require('./routes/nf-importacao');
const pickingRouter = require('./routes/picking');
const erpCronRouter = require('./routes/erp-cron');
const separacaoErpRouter = require('./routes/separacao-erp');
const backfillPerfilRouter = require('./routes/backfill-perfil');
const conferenciaErpRouter = require('./routes/conferencia-erp');
const historicoRouter = require('./routes/historico');
const { iniciarPollingZenErp } = require('./poller');
const { iniciarAgendaInventario } = require('./agenda-inventario');

const app = express();
app.use(cors());
// Limite padrao do express.json() e so 100kb - baixo demais pras fotos
// de comprovacao (base64) enviadas por Separacao/Conferencia/Tarefas,
// que mesmo comprimidas no coletor (max 1000px, JPEG 0.6) podem passar
// disso em fotos com mais detalhe. Sem esse limite maior, o upload da
// foto falha com "413 Payload Too Large".
app.use(express.json({ limit: '10mb' }));

// /auth: login é público (a própria rota decide o que exige
// sessão, ex.: /auth/me). Nunca colocar exigirLogin aqui.
app.use('/auth', authRouter);

// /erp: chamado pelo cron job do Supabase (pg_cron + pg_net), não
// por um colaborador logado - tem seu próprio segredo
// (CRON_SECRET) checado dentro da rota. Nunca colocar exigirLogin
// aqui, ou o cron para de funcionar.
app.use('/erp', erpCronRouter);

// Daqui pra baixo, toda rota exige login (colaborador ativo com
// token válido). Algumas, além disso, exigem um cargo específico -
// 'admin' sempre passa em qualquer exigirCargo.
app.use('/colaboradores', exigirLogin, exigirCargo('admin'), colaboradoresRouter);
app.use('/enderecos', exigirLogin, enderecosRouter);
app.use('/tarefas', exigirLogin, tarefasRouter);
app.use('/recebimento', exigirLogin, recebimentoRouter);
app.use('/produtos', exigirLogin, produtosRouter);
app.use('/pedidos', exigirLogin, pedidosRouter);
app.use('/inventario', exigirLogin, inventarioRouter);
app.use('/reconciliar', exigirLogin, exigirCargo('admin'), reconciliarErpRouter);
app.use('/unidades-serializadas', exigirLogin, unidadesSerializadasRouter);
app.use('/movimentacoes', exigirLogin, movimentacoesRouter);
app.use('/nf-importacao', exigirLogin, nfImportacaoRouter);
app.use('/picking', exigirLogin, pickingRouter);
app.use('/separacao-erp', exigirLogin, separacaoErpRouter);
app.use('/backfill', exigirLogin, exigirCargo('admin'), backfillPerfilRouter);
app.use('/conferencia-erp', exigirLogin, conferenciaErpRouter);
app.use('/historico', exigirLogin, historicoRouter);

app.get('/', (req, res) => {
    res.json({ status: 'ok', servico: 'WMS API' });
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`WMS API rodando na porta ${PORT}`);
        iniciarPollingZenErp();
        iniciarAgendaInventario();
    });
}

module.exports = app;
