require('dotenv').config();
const express = require('express');
const cors = require('cors');

const enderecosRouter = require('./routes/enderecos');
const tarefasRouter = require('./routes/tarefas');
const recebimentoRouter = require('./routes/recebimento');
const produtosRouter = require('./routes/produtos');
const pedidosRouter = require('./routes/pedidos');
const inventarioRouter = require('./routes/inventario');
const areasFlutuanteRouter = require('./routes/areas-flutuante');
const cadastroEnderecosRouter = require('./routes/cadastro-enderecos');
const unidadesSerializadasRouter = require('./routes/unidades-serializadas');
const movimentacoesRouter = require('./routes/movimentacoes');
const nfImportacaoRouter = require('./routes/nf-importacao');
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
app.use('/areas-flutuante', areasFlutuanteRouter);
app.use('/cadastro-enderecos', cadastroEnderecosRouter);
app.use('/unidades-serializadas', unidadesSerializadasRouter);
app.use('/movimentacoes', movimentacoesRouter);
app.use('/nf-importacao', nfImportacaoRouter);

app.get('/', (req, res) => {
    res.json({ status: 'ok', servico: 'WMS API' });
});

// Só sobe o servidor de verdade (e liga o polling/agenda em processo
// contínuo) quando esse arquivo é executado direto - é o caso do
// Railway hoje (node index.js). Quando é importado como módulo (o
// handler serverless do Vercel, por exemplo), não faz sentido nem
// escutar porta nem manter setInterval vivo - função serverless não
// tem processo contínuo. Nesse cenário o polling vira um Cron Job
// separado (Fase I3), não algo que mora aqui dentro.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`WMS API rodando na porta ${PORT}`);
        iniciarPollingZenErp();
        iniciarAgendaInventario();
    });
}

module.exports = app;
