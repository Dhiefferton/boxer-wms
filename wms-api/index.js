require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exigirLogin, exigirCargo, bloquearEscritaSomenteLeitura } = require('./auth');
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
const controleLoteRouter = require('./routes/controle-lote');
const fluxosRouter = require('./routes/fluxos');
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
// 'admin' sempre passa em qualquer exigirCargo. bloquearEscritaSomenteLeitura
// vai em toda rota que tem alguma escrita (POST/PUT/PATCH/DELETE) -
// bloqueia só o cargo 'engenharia_produtos', sem mudar nada pros
// demais cargos (as que já são admin-only nem precisam dela, esse
// cargo já não é admin). historico e controle-lote são só leitura
// (GET), não precisam.
app.use('/colaboradores', exigirLogin, exigirCargo('admin'), colaboradoresRouter);
app.use('/enderecos', exigirLogin, bloquearEscritaSomenteLeitura, enderecosRouter);
app.use('/tarefas', exigirLogin, bloquearEscritaSomenteLeitura, tarefasRouter);
app.use('/recebimento', exigirLogin, bloquearEscritaSomenteLeitura, recebimentoRouter);
app.use('/produtos', exigirLogin, bloquearEscritaSomenteLeitura, produtosRouter);
app.use('/pedidos', exigirLogin, bloquearEscritaSomenteLeitura, pedidosRouter);
app.use('/inventario', exigirLogin, bloquearEscritaSomenteLeitura, inventarioRouter);
app.use('/reconciliar', exigirLogin, exigirCargo('admin'), reconciliarErpRouter);
app.use('/unidades-serializadas', exigirLogin, bloquearEscritaSomenteLeitura, unidadesSerializadasRouter);
app.use('/movimentacoes', exigirLogin, bloquearEscritaSomenteLeitura, movimentacoesRouter);
app.use('/nf-importacao', exigirLogin, bloquearEscritaSomenteLeitura, nfImportacaoRouter);
app.use('/picking', exigirLogin, bloquearEscritaSomenteLeitura, pickingRouter);
app.use('/separacao-erp', exigirLogin, bloquearEscritaSomenteLeitura, separacaoErpRouter);
app.use('/backfill', exigirLogin, exigirCargo('admin'), backfillPerfilRouter);
app.use('/conferencia-erp', exigirLogin, bloquearEscritaSomenteLeitura, conferenciaErpRouter);
app.use('/historico', exigirLogin, historicoRouter);
app.use('/controle-lote', exigirLogin, controleLoteRouter);
app.use('/fluxos', exigirLogin, bloquearEscritaSomenteLeitura, fluxosRouter);

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
