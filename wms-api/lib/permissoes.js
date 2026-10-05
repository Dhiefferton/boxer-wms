// ============================================================
// Controle de acesso por permissões (05/10/2026, a pedido do
// Dhiefferton: "ter 100% do controle do sistema, sem depender de você")
// ============================================================
// ANTES: 5 cargos fixos no código (admin, conferente, picking,
// recebimento_reposicao, engenharia_produtos) e cada rota/tela com o
// cargo escrito à mão. Mudar quem acessa o quê = mexer em código.
//
// AGORA: tudo gira em torno de PERMISSÕES (chaves) do CATALOGO abaixo:
//
//   - PERFIS (tabela perfis_acesso): conjuntos de permissões. Os 5 cargos
//     antigos viram perfis "de sistema" com EXATAMENTE o acesso que tinham
//     (ver `padrao` de cada permissão); dá pra criar perfis novos pelo
//     painel (tela Controle de acesso, no dashboard).
//   - EXCEÇÕES POR PESSOA (colaborador_permissoes): liberar ou bloquear
//     UMA permissão só pra um colaborador, sem mudar o perfil.
//   - O cargo 'admin' sempre tem tudo e não pode ser limitado.
//
// Tipos de permissão: 'tela' (aparece/some no menu e rota do dashboard e
// do coletor; nos módulos com `leitura` a API também bloqueia a leitura) e
// 'acao' (gravar/executar - SEMPRE conferido na API; o front só esconde
// botão por usabilidade).
//
// ------------------------------------------------------------
// COMO ISSO ENTRA EM PRODUÇÃO SEM RISCO (3 modos, ver lerEstado):
//   legado - camada desligada: tudo funciona exatamente como antes.
//   sombra - (PADRÃO) a regra antiga continua mandando; a nova só CALCULA
//            o que decidiria e registra as diferenças (acesso_divergencias)
//            pra provar que o mapa de permissões bate com o sistema atual.
//   ativo  - a nova regra manda (perfis/exceções do painel valem) e as
//            checagens antigas (exigirCargo / bloquearEscritaSomenteLeitura)
//            viram passagem livre - quem decide é o gate daqui.
// O modo é trocado no painel (ou, em emergência, pela variável de ambiente
// ACESSO_MODO=legado na Vercel, que vale mais que o painel).
//
// BANCO: nada é criado sozinho. As tabelas novas (todas "só adicionam",
// nenhuma tabela existente é alterada) nascem quando o administrador clica
// em "Preparar banco" no painel (prepararBanco). Antes disso, e se o banco
// de permissões falhar por qualquer motivo, vale o padrão por cargo em
// memória - ninguém fica trancado pra fora.
//
// CUIDADO AO ACRESCENTAR ROTAS NOVAS: no modo 'ativo' o exigirCargo antigo
// deixa passar; quem protege é o catálogo. Rota nova com restrição própria
// precisa entrar em uma `acao(... rotas)` daqui, senão cai na permissão
// genérica "<módulo>.editar". O script wms-api/scripts/paridade-acessos.js
// confere isso (rode antes de publicar mudanças em rotas).
// ============================================================

const TODOS = ['conferente', 'picking', 'recebimento_reposicao', 'engenharia_produtos'];
// Quem hoje consegue GRAVAR em rotas sem restrição específica de cargo:
// todo mundo menos engenharia_produtos (só visualização).
const OPERACAO = ['conferente', 'picking', 'recebimento_reposicao'];
const REC = ['recebimento_reposicao'];
const PICK = ['picking'];
const CONF_PICK = ['conferente', 'picking'];
const ADM = []; // só admin (que sempre tem tudo)

const G_DASH = 'Dashboard - telas';
const G_COLETOR = 'Coletor - telas';

function tela(chave, app, rotulo, padrao, descricao) {
    return { chave, tipo: 'tela', app, grupo: app === 'dashboard' ? G_DASH : G_COLETOR, rotulo, descricao: descricao || '', padrao };
}
function acao(chave, grupo, rotulo, padrao, rotas, descricao) {
    return { chave, tipo: 'acao', app: 'api', grupo, rotulo, descricao: descricao || '', padrao, rotas: rotas || [] };
}

const CATALOGO = [
    // ---------------- Dashboard: telas ----------------
    tela('dash.mapa', 'dashboard', 'Mapa de ruas', TODOS),
    tela('dash.produtos', 'dashboard', 'Produtos (lista, cadastro e edição)', TODOS),
    tela('dash.unidades', 'dashboard', 'Unidades (números de série)', TODOS),
    tela('dash.entradas_manuais', 'dashboard', 'Entradas manuais', REC),
    tela('dash.reposicao_kanban', 'dashboard', 'Reposição (Kanban)', REC),
    tela('dash.estoque_pulmao', 'dashboard', 'Estoque Pulmão', REC),
    tela('dash.controle_lote', 'dashboard', 'Controle de Lote', TODOS),
    tela('dash.pedidos', 'dashboard', 'Ordens de separação', TODOS),
    tela('dash.divergencias', 'dashboard', 'Divergências', TODOS),
    tela('dash.historico', 'dashboard', 'Histórico', TODOS),
    tela('dash.relatorios', 'dashboard', 'Relatórios', TODOS),
    tela('dash.colaboradores', 'dashboard', 'Colaboradores', REC, 'Lista e cadastro de colaboradores.'),
    tela('dash.perfis_fiscais', 'dashboard', 'Perfis fiscais (Devolução)', ADM),
    tela('dash.perfis_separacao', 'dashboard', 'Perfis de separação', ADM),
    tela('dash.acessos', 'dashboard', 'Controle de acesso', ADM, 'Esta tela: perfis, permissões e exceções por colaborador.'),

    // ---------------- Coletor: telas ----------------
    tela('col.imprimir_ordem', 'coletor', 'Imprimir Ordem de Separação', TODOS),
    tela('col.separacao', 'coletor', 'Separação', PICK),
    tela('col.inventario', 'coletor', 'Contagem de inventário', TODOS),
    tela('col.picking', 'coletor', 'Picking (repor)', REC),
    tela('col.nf_importacao', 'coletor', 'Recebimento (NF)', REC),
    tela('col.nf_devolucao', 'coletor', 'Devolução (NF)', REC),
    tela('col.conferencia', 'coletor', 'Conferência de embarque', CONF_PICK),
    tela('col.reimprimir', 'coletor', 'Reimprimir etiquetas', REC),
    tela('col.pulmao', 'coletor', 'Estoque Pulmão → Vertical', REC),
    tela('col.transferencia', 'coletor', 'Transferência de Depósito', REC),
    tela('col.estoque_devolucao', 'coletor', 'Estoque Devolução', REC),

    // ---------------- Ações ----------------
    // Produtos
    acao('produtos.editar', 'Produtos e unidades', 'Cadastrar e editar produtos', OPERACAO, [
        'POST /produtos', 'POST /produtos/:id/reativar', 'PUT /produtos/:id', 'POST /produtos/sincronizar-dimensoes-zenerp',
    ]),
    acao('produtos.excluir', 'Produtos e unidades', 'Excluir produtos', OPERACAO, [
        'DELETE /produtos/:id', 'POST /produtos/excluir-varios',
    ]),
    acao('unidades.editar', 'Produtos e unidades', 'Criar e editar unidades (números de série)', OPERACAO, [
        'POST /unidades-serializadas', 'PATCH /unidades-serializadas/:id',
    ]),
    acao('unidades.excluir', 'Produtos e unidades', 'Excluir unidades (números de série)', OPERACAO, [
        'DELETE /unidades-serializadas/:id',
    ]),

    // Mapa
    acao('mapa.editar', 'Mapa de ruas', 'Editar endereços (reserva flutuante, multi-SKU, bloquear/desbloquear)', OPERACAO, [
        'PUT /enderecos/:id/reserva-flutuante', 'PUT /enderecos/:id/multi-sku', 'POST /enderecos/:id/multi-sku/adicionar-sku',
        'POST /enderecos/bloquear-lote', 'POST /enderecos/desbloquear-lote', 'PATCH /enderecos/:id/pallet',
    ]),
    acao('mapa.remover_pallet', 'Mapa de ruas', 'Remover pallet de um endereço', OPERACAO, ['DELETE /enderecos/:id/pallet']),

    // Inventário
    acao('inventario.contar', 'Inventário', 'Confirmar contagem (coletor)', OPERACAO, ['POST /inventario/tarefas/:id/confirmar']),
    acao('inventario.gerenciar', 'Inventário', 'Gerar contagens e aprovar divergências', OPERACAO, [
        'POST /inventario/gerar-ciclico', 'POST /inventario/gerar-geral', 'POST /inventario/divergencias/:contagemId/aprovar',
    ]),

    // Recebimento
    acao('recebimento.iniciar', 'Recebimento', 'Iniciar recebimento (avulso e em lote)', REC, [
        'POST /recebimento/iniciar', 'POST /recebimento/iniciar-lote',
    ]),
    acao('recebimento.editar', 'Recebimento', 'Outras gravações de recebimento', OPERACAO),
    acao('nf_importacao.receber', 'Recebimento', 'Receber item de NF (receber, retirar, devolver pra lista, marcar como peça)', REC, [
        'PATCH /nf-importacao/itens/:itemId/receber', 'POST /nf-importacao/itens/:itemId/retirar-do-recebimento',
        'POST /nf-importacao/itens/:itemId/devolver-pra-lista', 'POST /nf-importacao/itens/:itemId/marcar-como-peca',
    ]),
    acao('nf_importacao.editar', 'Recebimento', 'Outras gravações de NF de importação', OPERACAO),

    // Devolução / transferência
    acao('nf_devolucao.receber', 'Devolução e transferência', 'Receber item de NF de devolução', REC, [
        'PATCH /nf-devolucao/itens/:itemId/receber',
    ]),
    acao('nf_devolucao.perfis_fiscais', 'Devolução e transferência', 'Criar e excluir perfis fiscais', ADM, [
        'POST /nf-devolucao/perfis-fiscais', 'DELETE /nf-devolucao/perfis-fiscais/:id',
    ]),
    acao('nf_devolucao.debug', 'Devolução e transferência', 'Consulta de depuração de NF de devolução', ADM, [
        'GET /nf-devolucao/debug/buscar',
    ]),
    acao('nf_devolucao.editar', 'Devolução e transferência', 'Outras gravações de NF de devolução', OPERACAO),
    acao('devolucao_estoque.operar', 'Devolução e transferência', 'Operar Estoque Devolução (bipar e trocar depósito)', REC, [
        'PATCH /devolucao-estoque/:palletId/deposito', 'POST /devolucao-estoque/bipar',
    ]),
    acao('devolucao_estoque.editar', 'Devolução e transferência', 'Outras gravações de Estoque Devolução', OPERACAO),
    acao('transferencia.operar', 'Devolução e transferência', 'Transferência de depósito (bipar e retornar)', REC, [
        'POST /transferencia-deposito/bipar', 'POST /transferencia-deposito/retornar',
    ]),
    acao('transferencia.editar', 'Devolução e transferência', 'Outras gravações de transferência', OPERACAO),

    // Separação e conferência
    acao('separacao.operar', 'Separação e conferência', 'Separar pedidos (reserva, bipar serial, foto, romaneio, volume, liberar nota)', PICK, [
        'POST /separacao-erp/:pedidoId/preparar-transportadora', 'POST /separacao-erp/:pedidoId/iniciar-reserva',
        'POST /separacao-erp/:pedidoId/bipar-serial', 'POST /separacao-erp/:pedidoId/foto',
        'POST /separacao-erp/:pedidoId/finalizar-reserva', 'POST /separacao-erp/:pedidoId/finalizar-romaneio',
        'POST /separacao-erp/:pedidoId/definir-volume', 'POST /separacao-erp/:pedidoId/liberar-nota',
    ]),
    acao('separacao.imprimir', 'Separação e conferência', 'Sincronizar e imprimir ordens de separação', OPERACAO, [
        'POST /separacao-erp/sincronizar', 'POST /separacao-erp/:pedidoId/preparar-impressao', 'POST /separacao-erp/imprimir-lote',
    ]),
    acao('separacao.perfis', 'Separação e conferência', 'Criar e excluir perfis de separação', ADM, [
        'POST /separacao-erp/perfis-separacao', 'DELETE /separacao-erp/perfis-separacao/:id',
    ]),
    acao('separacao.correcoes', 'Separação e conferência', 'Correções administrativas de pedidos (reabrir, corrigir alocação, devolver ao estoque)', ADM, [
        'POST /separacao-erp/limpar-processados-externamente', 'POST /separacao-erp/corrigir-alocacao-almoxarifado',
        'POST /separacao-erp/corrigir-itens-faltando', 'POST /separacao-erp/reabrir-processados-externamente',
        'POST /separacao-erp/reabrir-revertidos', 'POST /separacao-erp/:pedidoId/itens/:itemId/devolver-estoque',
    ]),
    acao('separacao.editar', 'Separação e conferência', 'Outras gravações de separação', OPERACAO),
    acao('conferencia.operar', 'Separação e conferência', 'Conferir embarque (volume, foto, liberar embarque)', CONF_PICK, [
        'POST /conferencia-erp/:pedidoId/conferir-volume', 'POST /conferencia-erp/:pedidoId/foto',
        'POST /conferencia-erp/:pedidoId/liberar-embarque',
    ]),
    acao('conferencia.editar', 'Separação e conferência', 'Outras gravações de conferência', OPERACAO),

    // Reposição / Picking / Pulmão
    acao('tarefas.separacao_confirmar', 'Reposição, Picking e Pulmão', 'Confirmar tarefa de separação', PICK, [
        'POST /tarefas/separacao/:id/confirmar',
    ]),
    acao('tarefas.reposicao', 'Reposição, Picking e Pulmão', 'Reposição (gerar por estoque mínimo, confirmar, cancelar)', REC, [
        'POST /tarefas/reposicao/gerar-por-estoque-minimo', 'POST /tarefas/reposicao/:id/confirmar', 'POST /tarefas/reposicao/:id/cancelar',
    ]),
    acao('tarefas.editar', 'Reposição, Picking e Pulmão', 'Outras gravações de tarefas', OPERACAO),
    acao('picking.repor', 'Reposição, Picking e Pulmão', 'Repor picking (coletor)', REC, ['POST /picking/repor']),
    acao('picking.editar', 'Reposição, Picking e Pulmão', 'Outras gravações de picking', OPERACAO),
    acao('pulmao.transferir', 'Reposição, Picking e Pulmão', 'Subir pallet do Pulmão pro vertical', REC, [
        'POST /pulmao/transferir-por-etiqueta', 'POST /pulmao/pallets/:id/transferir', 'POST /pulmao/reavaliar',
        'POST /pulmao/tarefas/:id/confirmar', 'POST /pulmao/tarefas/:id/cancelar',
    ]),
    acao('pulmao.teste', 'Reposição, Picking e Pulmão', 'Pulmão Teste (aprovar teste, mandar SKU pro teste)', REC, [
        'POST /pulmao/teste/:palletId/aprovar', 'POST /pulmao/teste/por-sku',
    ]),
    acao('pulmao.editar', 'Reposição, Picking e Pulmão', 'Outras gravações do Pulmão', OPERACAO),

    // Outros
    acao('fluxos.editar', 'Outros', 'Editar o diagrama de fluxo do sistema', OPERACAO, ['PUT /fluxos/:chave']),
    acao('relatorios.executar', 'Outros', 'Executar e exportar relatórios', TODOS, [
        'POST /relatorios/:id/executar', 'POST /relatorios/:id/exportar',
    ]),

    // Pessoas, acessos e sistema
    acao('colaboradores.gerenciar', 'Pessoas, acessos e sistema', 'Cadastrar, editar e desativar colaboradores', REC, [], 'Alterar o perfil de um colaborador exige também a permissão de controle de acesso.'),
    acao('acessos.gerenciar', 'Pessoas, acessos e sistema', 'Gerenciar perfis, permissões e exceções (painel Controle de acesso)', ADM, []),
    acao('sistema.manutencao', 'Pessoas, acessos e sistema', 'Rotinas de manutenção (reconciliar ERP, backfill)', ADM, [
        'POST /reconciliar/pendentes', 'POST /backfill/perfil-separacao', 'POST /backfill/itens-pedido/:numeroErp',
    ]),
];

const CATALOGO_POR_CHAVE = new Map(CATALOGO.map((p) => [p.chave, p]));

// Perfis de sistema (os 5 cargos que já existiam).
const PERFIS_SISTEMA = [
    { chave: 'admin', nome: 'Administrador', descricao: 'Acesso total. Não pode ser limitado.' },
    { chave: 'conferente', nome: 'Conferente', descricao: 'Conferência de embarque e operação geral.' },
    { chave: 'picking', nome: 'Picking', descricao: 'Separação de pedidos e operação geral.' },
    { chave: 'recebimento_reposicao', nome: 'Recebimento / Repositor Picking', descricao: 'Recebimento, reposição, Pulmão, devolução e transferência.' },
    { chave: 'engenharia_produtos', nome: 'Engenharia de Produtos (somente visualização)', descricao: 'Só visualiza; não grava nada.' },
];

// ------------------------------------------------------------
// Módulos da API: prefixo -> permissão genérica de gravação
// (quando a rota não está listada em nenhuma ação) e, opcionalmente,
// quais telas liberam a LEITURA (GET) dos dados do módulo.
// ------------------------------------------------------------
const MODULOS = {
    '/enderecos': { editar: 'mapa.editar' },
    '/tarefas': { editar: 'tarefas.editar' },
    '/recebimento': { editar: 'recebimento.editar' },
    '/produtos': { editar: 'produtos.editar', excluir: 'produtos.excluir' },
    '/pedidos': { editar: 'separacao.editar' },
    '/inventario': { editar: 'inventario.gerenciar' },
    '/unidades-serializadas': { editar: 'unidades.editar', excluir: 'unidades.excluir' },
    '/movimentacoes': { editar: 'separacao.editar' },
    '/nf-importacao': { editar: 'nf_importacao.editar', leitura: ['col.nf_importacao'] },
    '/nf-devolucao': { editar: 'nf_devolucao.editar', leitura: ['col.nf_devolucao', 'dash.perfis_fiscais'] },
    '/picking': { editar: 'picking.editar' },
    '/separacao-erp': { editar: 'separacao.editar' },
    '/conferencia-erp': { editar: 'conferencia.editar' },
    '/fluxos': { editar: 'fluxos.editar' },
    '/pulmao': { editar: 'pulmao.editar', leitura: ['dash.estoque_pulmao', 'col.pulmao'] },
    '/transferencia-deposito': { editar: 'transferencia.editar', leitura: ['col.transferencia'] },
    '/devolucao-estoque': { editar: 'devolucao_estoque.editar', leitura: ['col.estoque_devolucao'] },
    '/relatorios': { editar: 'relatorios.executar' },
    '/historico': { editar: 'sistema.manutencao' },
    '/controle-lote': { editar: 'sistema.manutencao' },
    '/colaboradores': { editar: 'colaboradores.gerenciar', leitura: ['dash.colaboradores'] },
    '/reconciliar': { editar: 'sistema.manutencao', leitura: ['sistema.manutencao'] },
    '/backfill': { editar: 'sistema.manutencao', leitura: ['sistema.manutencao'] },
    '/acessos': { editar: 'acessos.gerenciar', leitura: ['acessos.gerenciar'] },
};

// ------------------------------------------------------------
// Resolução de rota -> permissão exigida
// ------------------------------------------------------------
function compilarRota(texto, chave) {
    const [metodo, caminho] = texto.split(' ');
    const partes = caminho.split('/').filter(Boolean);
    const regex = new RegExp('^/' + partes.map((p) => (p.startsWith(':') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$');
    const parametros = partes.filter((p) => p.startsWith(':')).length;
    return { metodo, regex, chave, parametros, tamanho: caminho.length };
}

// Mais específico primeiro: menos parâmetros, depois caminho mais longo.
const ROTAS_COMPILADAS = CATALOGO.flatMap((p) => (p.rotas || []).map((r) => compilarRota(r, p.chave))).sort(
    (a, b) => a.parametros - b.parametros || b.tamanho - a.tamanho
);

// O Express casa rotas sem diferenciar maiúscula de minúscula e ignora a
// barra final - aqui também, senão '/PRODUTOS' escaparia do gate.
function normalizarCaminho(caminho) {
    let c = String(caminho || '').split('?')[0].split('#')[0].toLowerCase();
    if (c.length > 1 && c.endsWith('/')) c = c.slice(0, -1);
    return c;
}

// Devolve { chaves: [...] } (basta ter UMA delas) ou null quando a rota
// não exige nenhuma permissão específica (só estar logado) - ex.: GET
// em módulo sem `leitura`. Devolve { modulo: false } pra prefixo que
// não é de nenhum módulo conhecido (o gate deixa passar).
function resolverRota(metodo, caminhoBruto) {
    const caminho = normalizarCaminho(caminhoBruto);
    const m = String(metodo || 'GET').toUpperCase();
    const prefixo = '/' + (caminho.split('/')[1] || '');
    const modulo = MODULOS[prefixo];
    if (!modulo) return { desconhecido: true };

    // /colaboradores: POST/PUT têm uma regra própria (ver gate).
    for (const r of ROTAS_COMPILADAS) {
        if (r.metodo === m && r.regex.test(caminho)) return { chaves: [r.chave] };
    }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
        return modulo.leitura ? { chaves: modulo.leitura } : null;
    }
    if (m === 'DELETE' && modulo.excluir) return { chaves: [modulo.excluir] };
    return { chaves: [modulo.editar] };
}

// ------------------------------------------------------------
// Padrões (seed) e permissões em memória (fallback)
// ------------------------------------------------------------
function padraoDoPerfil(perfil) {
    if (perfil === 'admin') return CATALOGO.map((p) => p.chave);
    return CATALOGO.filter((p) => p.padrao.includes(perfil)).map((p) => p.chave);
}


// ------------------------------------------------------------
// Estado: banco preparado? em que modo estamos?
// ------------------------------------------------------------
const MODOS_VALIDOS = ['legado', 'sombra', 'ativo'];
const TABELAS_ACESSO = [
    'perfis_acesso',
    'perfil_permissoes',
    'colaborador_perfil',
    'colaborador_permissoes',
    'permissoes_conhecidas',
    'auditoria_admin',
    'acesso_config',
    'acesso_divergencias',
];
const CARGOS_SISTEMA = PERFIS_SISTEMA.map((p) => p.chave);

const CACHE_ESTADO_MS = 10000;
let cacheEstado = null; // { ate, valor: { preparado, modo, modoDoPainel, override } }

function modoDoAmbiente() {
    const v = String(process.env.ACESSO_MODO || '').trim().toLowerCase();
    return MODOS_VALIDOS.includes(v) ? v : null;
}

async function lerEstado(pool) {
    const agora = Date.now();
    if (cacheEstado && cacheEstado.ate > agora) return cacheEstado.valor;
    let preparado = false;
    let modoDoPainel = 'sombra';
    try {
        const r = await pool.query(
            `SELECT bool_and(to_regclass('public.' || t) IS NOT NULL) AS pronto FROM unnest($1::text[]) AS t`,
            [TABELAS_ACESSO]
        );
        preparado = Boolean(r.rows[0]?.pronto);
        if (preparado) {
            const m = await pool.query(`SELECT valor FROM acesso_config WHERE chave = 'modo'`);
            const v = m.rows[0]?.valor;
            if (MODOS_VALIDOS.includes(v)) modoDoPainel = v;
        }
    } catch (erro) {
        console.error('[permissoes] não consegui ler o estado do controle de acesso (usando sombra):', erro.message);
        preparado = false;
        modoDoPainel = 'sombra';
    }
    const override = modoDoAmbiente();
    const valor = { preparado, modoDoPainel, override, modo: override || modoDoPainel };
    cacheEstado = { ate: agora + CACHE_ESTADO_MS, valor };
    return valor;
}

function limparCache() {
    cacheEstado = null;
    cachePessoas.clear();
}

// ------------------------------------------------------------
// "Preparar banco": cria as tabelas novas (só adiciona; nada existente é
// alterado) numa transação única - ou cria tudo, ou não cria nada.
// ------------------------------------------------------------
const SQL_TABELAS = [
    `CREATE TABLE IF NOT EXISTS perfis_acesso (
        chave         VARCHAR(30) PRIMARY KEY,
        nome          VARCHAR(120) NOT NULL,
        descricao     TEXT,
        sistema       BOOLEAN NOT NULL DEFAULT false,
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS perfil_permissoes (
        perfil    VARCHAR(30) NOT NULL REFERENCES perfis_acesso(chave) ON DELETE CASCADE ON UPDATE CASCADE,
        permissao VARCHAR(80) NOT NULL,
        PRIMARY KEY (perfil, permissao)
    )`,
    // Perfil personalizado de uma pessoa. Quem usa perfil novo continua com
    // colaboradores.cargo = 'engenharia_produtos' (só leitura): qualquer
    // checagem antiga que ainda olhe o cargo "falha fechada".
    `CREATE TABLE IF NOT EXISTS colaborador_perfil (
        colaborador_id INTEGER PRIMARY KEY,
        perfil         VARCHAR(30) NOT NULL REFERENCES perfis_acesso(chave) ON UPDATE CASCADE,
        atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS colaborador_permissoes (
        colaborador_id INTEGER NOT NULL,
        permissao      VARCHAR(80) NOT NULL,
        efeito         VARCHAR(10) NOT NULL CHECK (efeito IN ('liberar', 'bloquear')),
        motivo         TEXT,
        concedido_por  VARCHAR(120),
        atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (colaborador_id, permissao)
    )`,
    `CREATE TABLE IF NOT EXISTS permissoes_conhecidas (
        chave         VARCHAR(80) PRIMARY KEY,
        registrada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS auditoria_admin (
        id        BIGSERIAL PRIMARY KEY,
        quando    TIMESTAMPTZ NOT NULL DEFAULT now(),
        ator_id   INTEGER,
        ator_nome VARCHAR(120),
        acao      VARCHAR(60) NOT NULL,
        tela      VARCHAR(60),
        alvo      VARCHAR(160),
        antes     JSONB,
        depois    JSONB,
        motivo    TEXT,
        origem    VARCHAR(200),
        ip        VARCHAR(80)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auditoria_admin_quando ON auditoria_admin (id DESC)`,
    `CREATE TABLE IF NOT EXISTS acesso_config (
        chave         VARCHAR(60) PRIMARY KEY,
        valor         TEXT NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por VARCHAR(120)
    )`,
    `CREATE TABLE IF NOT EXISTS acesso_divergencias (
        id        BIGSERIAL PRIMARY KEY,
        quando    TIMESTAMPTZ NOT NULL DEFAULT now(),
        colaborador_id INTEGER,
        cargo     VARCHAR(60),
        metodo    VARCHAR(10) NOT NULL,
        rota      VARCHAR(200) NOT NULL,
        regra_antiga VARCHAR(10) NOT NULL,
        regra_nova   VARCHAR(10) NOT NULL,
        status    INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_acesso_divergencias_quando ON acesso_divergencias (id DESC)`,
];

async function prepararBanco(pool) {
    const client = await pool.connect();
    const criadas = [];
    try {
        await client.query('SELECT pg_advisory_lock(727001)');
        try {
            await client.query('BEGIN');
            const antes = await client.query(
                `SELECT t AS tabela, to_regclass('public.' || t) IS NOT NULL AS existe FROM unnest($1::text[]) AS t`,
                [TABELAS_ACESSO]
            );
            for (const r of antes.rows) if (!r.existe) criadas.push(r.tabela);

            for (const sql of SQL_TABELAS) await client.query(sql);
            // Só aparece pra API REST pública do Supabase se o RLS estiver desligado.
            for (const tabela of TABELAS_ACESSO) await client.query(`ALTER TABLE ${tabela} ENABLE ROW LEVEL SECURITY`);

            for (const perfil of PERFIS_SISTEMA) {
                await client.query(
                    `INSERT INTO perfis_acesso (chave, nome, descricao, sistema) VALUES ($1, $2, $3, true) ON CONFLICT (chave) DO NOTHING`,
                    [perfil.chave, perfil.nome, perfil.descricao]
                );
            }
            // Permissões novas do catálogo: registra e concede o padrão aos perfis
            // de sistema, SEM mexer no que já foi editado no painel.
            const conhecidas = new Set((await client.query(`SELECT chave FROM permissoes_conhecidas`)).rows.map((r) => r.chave));
            for (const p of CATALOGO.filter((c) => !conhecidas.has(c.chave))) {
                await client.query(`INSERT INTO permissoes_conhecidas (chave) VALUES ($1) ON CONFLICT DO NOTHING`, [p.chave]);
                for (const perfil of PERFIS_SISTEMA) {
                    if (perfil.chave !== 'admin' && p.padrao.includes(perfil.chave)) {
                        await client.query(
                            `INSERT INTO perfil_permissoes (perfil, permissao) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [perfil.chave, p.chave]
                        );
                    }
                }
            }
            await client.query(
                `INSERT INTO acesso_config (chave, valor) VALUES ('modo', 'sombra') ON CONFLICT (chave) DO NOTHING`
            );
            await client.query('COMMIT');
        } catch (erro) {
            await client.query('ROLLBACK').catch(() => {});
            throw erro;
        } finally {
            await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
        }
    } finally {
        client.release();
    }
    limparCache();
    return { criadas };
}

async function definirModo(pool, modo, atorNome) {
    if (!MODOS_VALIDOS.includes(modo)) throw Object.assign(new Error('Modo inválido'), { status: 400 });
    const estado = await lerEstado(pool);
    if (!estado.preparado) throw Object.assign(new Error('Prepare o banco antes de trocar o modo.'), { status: 409 });
    await pool.query(
        `INSERT INTO acesso_config (chave, valor, atualizado_por) VALUES ('modo', $1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
        [modo, atorNome || null]
    );
    limparCache();
}

// ------------------------------------------------------------
// Permissões efetivas de um colaborador (cache curto)
// ------------------------------------------------------------
const CACHE_PESSOA_MS = 10000;
const cachePessoas = new Map(); // colaboradorId -> { ate, valor }

// Calcula pelo banco (perfil + exceções). Lança erro se o banco falhar -
// quem chama decide o fallback.
async function carregarEfetivasDoBanco(pool, colaboradorId) {
    const { rows } = await pool.query(
        `SELECT c.id, c.cargo, c.ativo, cp.perfil AS perfil_personalizado,
                COALESCE((SELECT array_agg(pp.permissao) FROM perfil_permissoes pp
                          WHERE pp.perfil = COALESCE(cp.perfil, c.cargo)), '{}') AS permissoes_perfil,
                COALESCE((SELECT json_agg(json_build_object('permissao', x.permissao, 'efeito', x.efeito))
                          FROM colaborador_permissoes x WHERE x.colaborador_id = c.id), '[]'::json) AS excecoes
         FROM colaboradores c
         LEFT JOIN colaborador_perfil cp ON cp.colaborador_id = c.id
         WHERE c.id = $1`,
        [colaboradorId]
    );
    const c = rows[0];
    if (!c || !c.ativo) return { inativo: true, cargo: c?.cargo, permissoes: new Set() };
    const perfil = c.perfil_personalizado || c.cargo;
    if (c.cargo === 'admin') {
        return { cargo: c.cargo, perfil: 'admin', admin: true, permissoes: new Set(CATALOGO.map((p) => p.chave)), doBanco: true };
    }
    const permissoes = new Set(c.permissoes_perfil);
    const excecoes = c.excecoes || [];
    for (const e of excecoes) {
        if (e.efeito === 'liberar' && CATALOGO_POR_CHAVE.has(e.permissao)) permissoes.add(e.permissao);
        else if (e.efeito === 'bloquear') permissoes.delete(e.permissao);
    }
    return { cargo: c.cargo, perfil, permissoes, excecoes, doBanco: true };
}

// Permissões que valem DE VERDADE agora (modo ativo): banco; se falhar,
// padrão por cargo (nunca trava todo mundo).
async function permissoesDoColaborador(pool, colaboradorId) {
    const agora = Date.now();
    const guardado = cachePessoas.get(colaboradorId);
    if (guardado && guardado.ate > agora) return guardado.valor;
    let valor;
    try {
        valor = await carregarEfetivasDoBanco(pool, colaboradorId);
    } catch (erro) {
        console.error('[permissoes] falha ao ler permissões do banco (usando padrão por cargo):', erro.message);
        const c = await pool.query(`SELECT id, cargo, ativo FROM colaboradores WHERE id = $1`, [colaboradorId]);
        const col = c.rows[0];
        if (!col || !col.ativo) valor = { inativo: true, permissoes: new Set() };
        else valor = { cargo: col.cargo, perfil: col.cargo, admin: col.cargo === 'admin', permissoes: new Set(padraoDoPerfil(col.cargo)), doBanco: false };
    }
    cachePessoas.set(colaboradorId, { ate: agora + CACHE_PESSOA_MS, valor });
    return valor;
}

// ------------------------------------------------------------
// Sombra: registra onde a regra nova divergiria da antiga.
// ------------------------------------------------------------
const divergenciasVistas = new Map(); // chave -> instante do último registro
const REPETIR_DIVERGENCIA_MS = 10 * 60 * 1000;

function rotaGenerica(caminho) {
    return normalizarCaminho(caminho)
        .split('/')
        .map((p) => (/^\d+$/.test(p) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(p) ? ':id' : p))
        .join('/');
}

function registrarDivergencia(pool, estado, info) {
    const chave = [estado.preparado ? 'banco' : 'log', info.cargo, info.metodo, info.rota, info.regraNova, info.regraAntiga].join('|');
    const agora = Date.now();
    if ((divergenciasVistas.get(chave) || 0) > agora - REPETIR_DIVERGENCIA_MS) return;
    divergenciasVistas.set(chave, agora);
    if (divergenciasVistas.size > 2000) divergenciasVistas.clear();
    console.warn(`[acesso-sombra] ${info.cargo} ${info.metodo} ${info.rota}: regra antiga=${info.regraAntiga} regra nova=${info.regraNova} (status ${info.status})`);
    if (!estado.preparado) return;
    pool
        .query(
            `INSERT INTO acesso_divergencias (colaborador_id, cargo, metodo, rota, regra_antiga, regra_nova, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [info.colaboradorId, info.cargo, info.metodo, info.rota.slice(0, 200), info.regraAntiga, info.regraNova, info.status]
        )
        .catch((erro) => console.error('[acesso-sombra] não consegui gravar a divergência:', erro.message));
}

// Decisão da regra NOVA com o padrão por cargo (é isso que a sombra valida).
function decidirComPadrao(cargo, exigida) {
    if (cargo === 'admin' || !exigida) return true;
    const perm = new Set(padraoDoPerfil(cargo));
    return exigida.chaves.some((c) => perm.has(c));
}

// ------------------------------------------------------------
// Middleware global (depois do exigirLogin)
// ------------------------------------------------------------
function criarGate(pool) {
    return async function gatePermissao(req, res, next) {
        let estado;
        try {
            estado = await lerEstado(pool);
            req.acessoModo = estado.modo;
            if (estado.modo === 'legado') return next();

            const exigida = resolverRota(req.method, req.originalUrl || req.url);
            if (exigida && exigida.desconhecido) return next();

            if (estado.modo === 'sombra') {
                const cargo = req.usuario.cargo;
                const novaPermite = decidirComPadrao(cargo, exigida);
                res.on('finish', () => {
                    try {
                        const antigaPermitiu = !req.legadoNegou;
                        if (novaPermite !== antigaPermitiu) {
                            registrarDivergencia(pool, estado, {
                                colaboradorId: req.usuario.id,
                                cargo,
                                metodo: req.method,
                                rota: rotaGenerica(req.originalUrl || req.url),
                                regraAntiga: antigaPermitiu ? 'permite' : 'nega',
                                regraNova: novaPermite ? 'permite' : 'nega',
                                status: res.statusCode,
                            });
                        }
                    } catch (e) {
                        /* a sombra nunca pode atrapalhar */
                    }
                });
                return next();
            }

            // modo ativo: quem decide é a regra nova
            const ctx = await permissoesDoColaborador(pool, req.usuario.id);
            if (ctx.inativo) {
                return res.status(401).json({ erro: 'Sessão inválida ou usuário desativado' });
            }
            req.permissoes = ctx.permissoes;
            req.acessoAtivo = true;
            if (!exigida || ctx.admin) return next();
            if (exigida.chaves.some((chave) => ctx.permissoes.has(chave))) return next();
            const rotulos = exigida.chaves.map((chave) => CATALOGO_POR_CHAVE.get(chave)?.rotulo || chave);
            return res.status(403).json({ erro: `Seu acesso não permite essa ação (${rotulos.join(' ou ')}). Fale com um administrador.` });
        } catch (erro) {
            // Falha inesperada: nunca trava ninguém - cai nas checagens antigas.
            console.error('[permissoes] erro no gate (seguindo com as checagens antigas):', erro);
            req.acessoAtivo = false;
            return next();
        }
    };
}

// ------------------------------------------------------------
// O que o front recebe no login e em /auth/me
// ------------------------------------------------------------
// Fora do modo ativo o front recebe o padrão do cargo (= comporta-se
// exatamente como antes); no ativo, as permissões reais da pessoa.
// Menus editáveis (Fase 2): nome/ordem/visibilidade dos itens. Qualquer falha
// = menu padrão (nunca derruba o login). Require tardio: menu-config não
// depende deste arquivo.
async function menuParaFrontSeguro(pool, estado) {
    try {
        return await require('./menu-config').menuParaFront(pool, estado);
    } catch (erro) {
        console.error('[permissoes] falha ao montar o menu (usando menu padrão):', erro.message);
        return { dashboard: {}, coletor: {} };
    }
}

async function infoAcessoParaFront(pool, colaborador) {
    const padrao = () => (colaborador.cargo === 'admin' ? ['*'] : padraoDoPerfil(colaborador.cargo).sort());
    try {
        const estado = await lerEstado(pool);
        let perfil = colaborador.cargo;
        let permissoes = padrao();
        if (estado.modo === 'ativo') {
            const ctx = await permissoesDoColaborador(pool, colaborador.id);
            perfil = ctx.perfil || colaborador.cargo;
            permissoes = ctx.admin ? ['*'] : [...ctx.permissoes].sort();
        } else if (estado.preparado) {
            const r = await pool.query(`SELECT perfil FROM colaborador_perfil WHERE colaborador_id = $1`, [colaborador.id]);
            perfil = r.rows[0]?.perfil || colaborador.cargo;
        }
        const perfis = await listarPerfis(pool);
        return {
            permissoes,
            acessoModo: estado.modo,
            perfil,
            perfilNome: perfis.find((p) => p.chave === perfil)?.nome || perfil,
            menu: await menuParaFrontSeguro(pool, estado),
        };
    } catch (erro) {
        console.error('[permissoes] falha ao montar o acesso do front (usando padrão por cargo):', erro.message);
        return { permissoes: padrao(), acessoModo: 'sombra', perfil: colaborador.cargo, perfilNome: colaborador.cargo, menu: { dashboard: {}, coletor: {} } };
    }
}

// Lista de perfis (com fallback pros 5 de sistema se o banco não está pronto).
async function listarPerfis(pool) {
    try {
        const estado = await lerEstado(pool);
        if (!estado.preparado) throw new Error('banco não preparado');
        const { rows } = await pool.query(`SELECT chave, nome, descricao, sistema FROM perfis_acesso ORDER BY sistema DESC, nome ASC`);
        return rows;
    } catch (erro) {
        return PERFIS_SISTEMA.map((p) => ({ ...p, sistema: true }));
    }
}

async function nomeDoPerfil(pool, chave) {
    const perfis = await listarPerfis(pool);
    return perfis.find((p) => p.chave === chave)?.nome || chave;
}

// ------------------------------------------------------------
// Auditoria administrativa (só grava com o banco preparado)
// ------------------------------------------------------------
function dadosDaRequisicao(req) {
    const encaminhado = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return {
        ip: (encaminhado || req?.ip || req?.socket?.remoteAddress || '').slice(0, 80) || null,
        origem: String(req?.headers?.['user-agent'] || '').slice(0, 200) || null,
    };
}

async function auditar(pool, req, acao, { tela, alvo, antes, depois, motivo } = {}) {
    const ator = req?.usuario;
    const { ip, origem } = dadosDaRequisicao(req);
    try {
        const estado = await lerEstado(pool);
        if (!estado.preparado) {
            console.log('[auditoria-admin]', JSON.stringify({ ator: ator?.nome, acao, tela, alvo, antes, depois, motivo }));
            return;
        }
        await pool.query(
            `INSERT INTO auditoria_admin (ator_id, ator_nome, acao, tela, alvo, antes, depois, motivo, origem, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                ator?.id ?? null,
                ator?.nome ?? null,
                acao,
                tela ?? null,
                alvo ?? null,
                antes === undefined ? null : JSON.stringify(antes),
                depois === undefined ? null : JSON.stringify(depois),
                motivo ?? null,
                origem,
                ip,
            ]
        );
    } catch (erro) {
        console.error('[permissoes] falha ao gravar auditoria:', erro.message);
    }
}

// Quem pode mexer em perfis/administradores: admin sempre; no modo ativo,
// também quem recebeu a permissão 'acessos.gerenciar'.
async function podeGerenciarAcessos(pool, usuario) {
    if (usuario?.cargo === 'admin') return true;
    try {
        const estado = await lerEstado(pool);
        if (estado.modo !== 'ativo') return false;
        const ctx = await permissoesDoColaborador(pool, usuario.id);
        return Boolean(ctx.admin || ctx.permissoes.has('acessos.gerenciar'));
    } catch (erro) {
        return false;
    }
}

module.exports = {
    CATALOGO,
    CATALOGO_POR_CHAVE,
    PERFIS_SISTEMA,
    CARGOS_SISTEMA,
    TABELAS_ACESSO,
    MODOS_VALIDOS,
    MODULOS,
    resolverRota,
    normalizarCaminho,
    padraoDoPerfil,
    decidirComPadrao,
    lerEstado,
    prepararBanco,
    definirModo,
    permissoesDoColaborador,
    carregarEfetivasDoBanco,
    infoAcessoParaFront,
    listarPerfis,
    nomeDoPerfil,
    limparCache,
    criarGate,
    auditar,
    dadosDaRequisicao,
    podeGerenciarAcessos,
};
