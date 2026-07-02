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
const { iniciarPollingZenErp } = require('./poller');

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

app.get('/', (req, res) => {
    res.json({ status: 'ok', servico: 'WMS API' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`WMS API rodando na porta ${PORT}`);
    iniciarPollingZenErp();
});