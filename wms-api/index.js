require('dotenv').config();
const express = require('express');
const cors = require('cors');
const enderecosRouter = require('./routes/enderecos');
const tarefasRouter = require('./routes/tarefas');
const recebimentoRouter = require('./routes/recebimento');
const produtosRouter = require('./routes/produtos');
const pedidosRouter = require('./routes/pedidos');
const inventarioRouter = require('./routes/inventario');
const reconciliarErpRouter = require('./routes/reconciliar-erp');
const areasFlutuanteRouter = require('./routes/areas-flutuante');
const cadastroEnderecosRouter = require('./routes/cadastro-enderecos');
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
app.use(express.json());

app.use('/enderecos', enderecosRouter);
app.use('/tarefas', tarefasRouter);
app.use('/recebimento', recebimentoRouter);
app.use('/produtos', produtosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/inventario', inventarioRouter);
app.use('/reconciliar', reconciliarErpRouter);
app.use('/areas-flutuante', areasFlutuanteRouter);
app.use('/cadastro-enderecos', cadastroEnderecosRouter);
app.use('/unidades-serializadas', unidadesSerializadasRouter);
app.use('/movimentacoes', movimentacoesRouter);
app.use('/nf-importacao', nfImportacaoRouter);
app.use('/picking', pickingRouter);
app.use('/erp', erpCronRouter);
app.use('/separacao-erp', separacaoErpRouter);
app.use('/backfill', backfillPerfilRouter);
app.use('/conferencia-erp', conferenciaErpRouter);
app.use('/historico', historicoRouter);

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
