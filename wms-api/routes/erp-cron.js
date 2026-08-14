// Endpoint HTTP chamado pelo cron job do Supabase (pg_cron + pg_net),
// mesmo padrao usado no boxer-requisicoes. Substitui o polling antigo
// baseado em setInterval, que so funciona numa maquina ligada o tempo
// todo (Railway) - nao funciona direito em serverless (Vercel).
// Protegido por segredo no header Authorization.
const express = require('express');
const { executarCiclo } = require('../poller');

const router = express.Router();

router.post('/cron', async (req, res) => {
    const auth = req.headers.authorization || '';
        const esperado = `Bearer ${process.env.CRON_SECRET}`;
            if (!process.env.CRON_SECRET || auth !== esperado) {
                    return res.status(401).json({ erro: 'Nao autorizado' });
                        }

                            try {
                                    await executarCiclo();
                                            res.json({ status: 'ok' });
                                                } catch (erro) {
                                                        console.error(erro);
                                                                res.status(500).json({ erro: 'Falha ao executar ciclo de sincronizacao' });
                                                                    }
                                                                    });

                                                                    module.exports = router;
                                                                    
