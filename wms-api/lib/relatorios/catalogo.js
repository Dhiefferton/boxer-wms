// ============================================================
// Catálogo de relatórios (30/09/2026, a pedido do Dhiefferton -
// "aba de relatórios onde eu posso tirar relatório de qualquer coisa
// dentro do sistema... não quero ter retrabalho com essa aba").
//
// Em vez de criar uma tela nova (rota + página + formulário + tabela)
// pra cada relatório novo, existe SÓ ISSO: um catálogo de definições.
// Cada item aqui descreve um relatório (filtros que ele aceita, quais
// colunas devolve e a consulta SQL que monta a partir dos filtros). A
// rota (relatorios.js), o motor de execução/paginação (executor.js) e
// a tela do dashboard (Relatorios.jsx) são 100% genéricos - não sabem
// nada sobre "pedido", "produto" etc., só sabem executar qualquer
// definição daqui e desenhar filtro/tabela a partir dos metadados.
//
// Pra adicionar um relatório novo no futuro: copiar um item abaixo,
// trocar id/titulo/categoria/filtros/colunas/montarConsulta - não
// precisa mexer em mais nenhum arquivo (nem rota, nem front-end).
//
// Toda consulta aqui é só leitura (SELECT) e todo valor que vem do
// usuário entra como parâmetro ($1, $2...), nunca concatenado direto
// na string SQL - os filtros escolhem QUAL valor usar num WHERE fixo
// que a gente já escreveu, nunca escrevem SQL novo.
// ============================================================

// Mesmo mapa de rótulos usado na tela de Histórico
// (wms-dashboard/src/pages/Historico.jsx, TIPO_LABEL) - mantER OS DOIS
// EM SINCRONIA se um tipo novo de movimentação for criado.
const TIPO_MOVIMENTACAO_LABEL = {
    recebimento: 'Recebimento',
    separacao: 'Separação',
    reposicao: 'Reposição',
    conferencia: 'Conferência',
    embarque: 'Embarque',
    transferencia_deposito: 'Transferência de Depósito',
    transferencia_deposito_retorno: 'Transferência de Depósito (retorno)',
    ajuste_inventario: 'Ajuste de inventário',
    ajuste_manual: 'Ajuste manual',
    devolucao_avaria: 'Devolução (avaria)',
    devolucao_estoque: 'Devolução (Estoque Devolução)',
    devolucao_picking: 'Devolução (Estoque Devolução → picking)',
    devolucao_alocacao_zen: 'Devolução (alocação ZenERP)',
    cancelamento_separacao: 'Cancelamento de separação (devolvido ao estoque)',
};

// Monta um "CASE m.tipo WHEN 'x' THEN 'Rótulo x' ... ELSE m.tipo END"
// a partir do mapa acima - só textos fixos nossos entram na string (os
// valores digitados pelo usuário nunca passam por aqui), por isso não
// tem risco de injeção mesmo montando a string na mão.
function casoRotuloTipoMovimentacao(coluna) {
    const quando = Object.entries(TIPO_MOVIMENTACAO_LABEL)
        .map(([chave, label]) => `WHEN '${chave}' THEN '${label.replace(/'/g, "''")}'`)
        .join(' ');
    return `CASE ${coluna} ${quando} ELSE ${coluna} END`;
}

// Texto resolvido de origem/destino de uma movimentação (versão
// resumida do formatarLocal() do Histórico - cobre os casos comuns
// pra um relatório exportável; a tela de Histórico continua sendo a
// referência pra todo detalhe fino de cada tipo de reserva ZenERP).
function casoLocalMovimentacao(tipoCol, enderecoCodigoCol, pedidoNumeroCol, notaNumeroCol, notaDevolucaoNumeroCol) {
    return `CASE ${tipoCol}
        WHEN 'vertical' THEN COALESCE(${enderecoCodigoCol}, '—')
        WHEN 'picking' THEN COALESCE(${enderecoCodigoCol}, '—')
        WHEN 'devolucao' THEN 'Estoque Devolução (' || COALESCE(${enderecoCodigoCol}, '—') || ')'
        WHEN 'pulmao' THEN 'Estoque Pulmão'
        WHEN 'externo' THEN 'Externo'
        WHEN 'conferencia' THEN 'Conferência'
        WHEN 'embarque' THEN 'Embarque'
        WHEN 'pedido' THEN 'Ordem ' || COALESCE(${pedidoNumeroCol}, '')
        WHEN 'nota_importacao' THEN 'NF ' || COALESCE(${notaNumeroCol}, '')
        WHEN 'nota_devolucao' THEN 'Devolução ' || COALESCE(${notaDevolucaoNumeroCol}, '')
        WHEN 'reserva_zen' THEN 'Reserva ZenERP'
        ELSE COALESCE(${tipoCol}, '—')
    END`;
}

const RELATORIOS = [
    // ------------------------------------------------------------
    {
        id: 'movimentacoes',
        titulo: 'Movimentações',
        categoria: 'Operação',
        descricao: 'Todo evento de estoque já registrado no sistema (recebimento, separação, reposição, devolução, transferência etc.) - a mesma base da tela de Histórico, com filtro de período e exportação.',
        filtros: [
            { chave: 'dataInicio', label: 'Data início', tipo: 'data' },
            { chave: 'dataFim', label: 'Data fim', tipo: 'data' },
            {
                chave: 'tipo', label: 'Tipo de movimentação', tipo: 'select',
                opcoes: Object.entries(TIPO_MOVIMENTACAO_LABEL).map(([valor, label]) => ({ valor, label })),
            },
            { chave: 'sku', label: 'SKU', tipo: 'texto' },
            { chave: 'numeroSerie', label: 'Número de série', tipo: 'texto' },
            { chave: 'numeroPedido', label: 'Pedido (nº ERP)', tipo: 'texto' },
            { chave: 'operador', label: 'Operador', tipo: 'texto' },
        ],
        colunas: [
            { chave: 'criado_em', label: 'Data/Hora', tipo: 'datahora' },
            { chave: 'tipo_label', label: 'Tipo' },
            { chave: 'sku', label: 'SKU' },
            { chave: 'descricao', label: 'Descrição' },
            { chave: 'quantidade', label: 'Qtd', tipo: 'numero' },
            { chave: 'numero_serie_snapshot', label: 'Série' },
            { chave: 'origem', label: 'Origem' },
            { chave: 'destino', label: 'Destino' },
            { chave: 'operador', label: 'Operador' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            if (filtros.dataInicio) {
                valores.push(filtros.dataInicio);
                condicoes.push(`m.criado_em >= $${valores.length}::date`);
            }
            if (filtros.dataFim) {
                valores.push(filtros.dataFim);
                condicoes.push(`m.criado_em < ($${valores.length}::date + INTERVAL '1 day')`);
            }
            if (filtros.tipo) {
                valores.push(filtros.tipo);
                condicoes.push(`m.tipo = $${valores.length}`);
            }
            if (filtros.sku) {
                valores.push(`%${filtros.sku}%`);
                condicoes.push(`p.sku ILIKE $${valores.length}`);
            }
            if (filtros.numeroSerie) {
                const semHash = String(filtros.numeroSerie).replace(/^#/, '');
                valores.push(`%${filtros.numeroSerie}%`);
                const idxCom = valores.length;
                valores.push(`%${semHash}%`);
                const idxSem = valores.length;
                condicoes.push(`(m.numero_serie_snapshot ILIKE $${idxCom} OR m.numero_serie_snapshot ILIKE $${idxSem})`);
            }
            if (filtros.numeroPedido) {
                valores.push(`%${filtros.numeroPedido}%`);
                const idx = valores.length;
                condicoes.push(`(po.numero_erp ILIKE $${idx} OR pd.numero_erp ILIKE $${idx})`);
            }
            if (filtros.operador) {
                valores.push(`%${filtros.operador}%`);
                condicoes.push(`m.operador ILIKE $${valores.length}`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT
                    m.criado_em,
                    ${casoRotuloTipoMovimentacao('m.tipo')} AS tipo_label,
                    p.sku, p.descricao, m.quantidade, m.numero_serie_snapshot, m.operador,
                    ${casoLocalMovimentacao('m.origem_tipo', 'eo.codigo', 'po.numero_erp', 'ni.numero', 'nd.numero')} AS origem,
                    ${casoLocalMovimentacao('m.destino_tipo', 'ed.codigo', 'pd.numero_erp', 'NULL', 'NULL')} AS destino
                FROM movimentacoes m
                JOIN produtos p ON p.id = m.produto_id
                LEFT JOIN enderecos eo ON m.origem_tipo IN ('vertical', 'picking', 'devolucao') AND eo.id = m.origem_id
                LEFT JOIN enderecos ed ON m.destino_tipo IN ('vertical', 'picking', 'devolucao') AND ed.id = m.destino_id
                LEFT JOIN pedidos po ON m.origem_tipo = 'pedido' AND po.id = m.origem_id
                LEFT JOIN pedidos pd ON m.destino_tipo = 'pedido' AND pd.id = m.destino_id
                LEFT JOIN notas_importacao ni ON m.origem_tipo = 'nota_importacao' AND ni.id = m.origem_id
                LEFT JOIN notas_devolucao nd ON m.origem_tipo = 'nota_devolucao' AND nd.id = m.origem_id
                ${where}
                ORDER BY m.criado_em DESC
            `;
            return { texto, valores };
        },
    },

    // ------------------------------------------------------------
    {
        id: 'estoque_atual',
        titulo: 'Estoque atual',
        categoria: 'Estoque',
        descricao: 'Quanto tem de cada produto agora, separado por onde está guardado (pallet no vertical, picking, unidade serializada em estoque).',
        filtros: [
            { chave: 'sku', label: 'SKU ou descrição', tipo: 'texto' },
            {
                chave: 'ativo', label: 'Situação do produto', tipo: 'select', padrao: 'ativos',
                opcoes: [{ valor: 'ativos', label: 'Só ativos' }, { valor: 'inativos', label: 'Só excluídos' }, { valor: 'todos', label: 'Todos' }],
            },
            {
                chave: 'serializado', label: 'Serializado?', tipo: 'select', padrao: 'todos',
                opcoes: [{ valor: 'sim', label: 'Sim' }, { valor: 'nao', label: 'Não' }, { valor: 'todos', label: 'Todos' }],
            },
        ],
        colunas: [
            { chave: 'sku', label: 'SKU' },
            { chave: 'descricao', label: 'Descrição' },
            { chave: 'serializado', label: 'Serializado?' },
            { chave: 'ativo', label: 'Ativo?' },
            { chave: 'quantidade_pallet_vertical', label: 'Qtd em pallet (vertical)', tipo: 'numero' },
            { chave: 'quantidade_picking', label: 'Qtd no picking', tipo: 'numero' },
            { chave: 'quantidade_serializada_em_estoque', label: 'Unidades serializadas em estoque', tipo: 'numero' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            const situacao = filtros.ativo || 'ativos';
            if (situacao === 'ativos') condicoes.push('p.ativo = true');
            else if (situacao === 'inativos') condicoes.push('p.ativo = false');
            if (filtros.serializado === 'sim') condicoes.push('p.serializado = true');
            else if (filtros.serializado === 'nao') condicoes.push('p.serializado = false');
            if (filtros.sku) {
                valores.push(`%${filtros.sku}%`);
                condicoes.push(`(p.sku ILIKE $${valores.length} OR p.descricao ILIKE $${valores.length})`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT
                    p.sku, p.descricao,
                    CASE WHEN p.serializado THEN 'Sim' ELSE 'Não' END AS serializado,
                    CASE WHEN p.ativo THEN 'Sim' ELSE 'Não' END AS ativo,
                    COALESCE(pv.total, 0) AS quantidade_pallet_vertical,
                    COALESCE(up.total, 0) AS quantidade_picking,
                    COALESCE(us.total, 0) AS quantidade_serializada_em_estoque
                FROM produtos p
                LEFT JOIN (SELECT produto_id, SUM(quantidade) AS total FROM pallets_vertical WHERE quantidade > 0 GROUP BY produto_id) pv ON pv.produto_id = p.id
                LEFT JOIN (SELECT produto_id, SUM(quantidade) AS total FROM unidades_picking GROUP BY produto_id) up ON up.produto_id = p.id
                LEFT JOIN (SELECT produto_id, COUNT(*) AS total FROM unidades_serializadas WHERE status = 'em_estoque' GROUP BY produto_id) us ON us.produto_id = p.id
                ${where}
                ORDER BY p.sku ASC
            `;
            return { texto, valores };
        },
    },

    // ------------------------------------------------------------
    {
        id: 'pedidos_separacao',
        titulo: 'Pedidos / Separação',
        categoria: 'Operação',
        descricao: 'Ordens de separação (pedidos vindos do ZenERP) com cliente, transportadora, status e progresso de separação.',
        filtros: [
            { chave: 'dataInicio', label: 'Data início', tipo: 'data' },
            { chave: 'dataFim', label: 'Data fim', tipo: 'data' },
            {
                chave: 'status', label: 'Status', tipo: 'select',
                opcoes: [{ valor: 'aberto', label: 'Aberto' }, { valor: 'parcial', label: 'Parcial' }, { valor: 'completo', label: 'Completo' }],
            },
            {
                chave: 'etapaSeparacao', label: 'Etapa de separação', tipo: 'select',
                opcoes: [
                    { valor: 'pendente', label: 'Pendente' },
                    { valor: 'nota_liberada', label: 'Nota liberada' },
                    { valor: 'embarque_liberado', label: 'Embarque liberado' },
                    { valor: 'processado_externamente', label: 'Processado externamente' },
                    { valor: 'revertido_no_zen', label: 'Revertido no ZenERP' },
                ],
            },
            { chave: 'numeroPedido', label: 'Pedido (nº ERP)', tipo: 'texto' },
            { chave: 'cliente', label: 'Cliente', tipo: 'texto' },
            { chave: 'transportadora', label: 'Transportadora', tipo: 'texto' },
        ],
        colunas: [
            { chave: 'numero_erp', label: 'Pedido' },
            { chave: 'cliente_nome', label: 'Cliente' },
            { chave: 'transportadora_nome', label: 'Transportadora' },
            { chave: 'status', label: 'Status' },
            { chave: 'etapa_separacao', label: 'Etapa de separação' },
            { chave: 'criado_em', label: 'Criado em', tipo: 'datahora' },
            { chave: 'quantidade_itens', label: 'Itens', tipo: 'numero' },
            { chave: 'quantidade_total_pedida', label: 'Qtd pedida', tipo: 'numero' },
            { chave: 'quantidade_total_separada', label: 'Qtd separada', tipo: 'numero' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            if (filtros.dataInicio) {
                valores.push(filtros.dataInicio);
                condicoes.push(`pe.criado_em >= $${valores.length}::date`);
            }
            if (filtros.dataFim) {
                valores.push(filtros.dataFim);
                condicoes.push(`pe.criado_em < ($${valores.length}::date + INTERVAL '1 day')`);
            }
            if (filtros.status) {
                valores.push(filtros.status);
                condicoes.push(`pe.status = $${valores.length}`);
            }
            if (filtros.etapaSeparacao) {
                valores.push(filtros.etapaSeparacao);
                condicoes.push(`pe.etapa_separacao = $${valores.length}`);
            }
            if (filtros.numeroPedido) {
                valores.push(`%${filtros.numeroPedido}%`);
                condicoes.push(`pe.numero_erp ILIKE $${valores.length}`);
            }
            if (filtros.cliente) {
                valores.push(`%${filtros.cliente}%`);
                condicoes.push(`pe.cliente_nome ILIKE $${valores.length}`);
            }
            if (filtros.transportadora) {
                valores.push(`%${filtros.transportadora}%`);
                condicoes.push(`pe.transportadora_nome ILIKE $${valores.length}`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT
                    pe.numero_erp, pe.cliente_nome, pe.transportadora_nome, pe.status, pe.etapa_separacao, pe.criado_em,
                    COUNT(ip.id) AS quantidade_itens,
                    COALESCE(SUM(ip.quantidade_x), 0) AS quantidade_total_pedida,
                    COALESCE(SUM(ip.quantidade_separada), 0) AS quantidade_total_separada
                FROM pedidos pe
                LEFT JOIN itens_pedido ip ON ip.pedido_id = pe.id
                ${where}
                GROUP BY pe.id
                ORDER BY pe.criado_em DESC
            `;
            return { texto, valores };
        },
    },

    // ------------------------------------------------------------
    {
        id: 'devolucoes_nf',
        titulo: 'Devoluções por NF',
        categoria: 'Devoluções',
        descricao: 'Itens de nota fiscal de devolução (cliente devolvendo mercadoria) já processados na triagem, com quantidade boa/defeituosa por item.',
        filtros: [
            { chave: 'dataInicio', label: 'Data início (data da NF)', tipo: 'data' },
            { chave: 'dataFim', label: 'Data fim (data da NF)', tipo: 'data' },
            { chave: 'numeroNF', label: 'Número da NF', tipo: 'texto' },
            { chave: 'cliente', label: 'Cliente', tipo: 'texto' },
            { chave: 'sku', label: 'SKU', tipo: 'texto' },
        ],
        colunas: [
            { chave: 'numero', label: 'NF' },
            { chave: 'cliente', label: 'Cliente' },
            { chave: 'data_nota', label: 'Data da NF', tipo: 'data' },
            { chave: 'status_nota', label: 'Status da NF' },
            { chave: 'sku', label: 'SKU' },
            { chave: 'descricao', label: 'Descrição' },
            { chave: 'quantidade_esperada', label: 'Qtd esperada', tipo: 'numero' },
            { chave: 'quantidade_boa', label: 'Qtd boa', tipo: 'numero' },
            { chave: 'quantidade_defeituosa', label: 'Qtd defeituosa', tipo: 'numero' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            if (filtros.dataInicio) {
                valores.push(filtros.dataInicio);
                condicoes.push(`nd.data_nota >= $${valores.length}::date`);
            }
            if (filtros.dataFim) {
                valores.push(filtros.dataFim);
                condicoes.push(`nd.data_nota <= $${valores.length}::date`);
            }
            if (filtros.numeroNF) {
                valores.push(`%${filtros.numeroNF}%`);
                condicoes.push(`nd.numero ILIKE $${valores.length}`);
            }
            if (filtros.cliente) {
                valores.push(`%${filtros.cliente}%`);
                condicoes.push(`nd.cliente ILIKE $${valores.length}`);
            }
            if (filtros.sku) {
                valores.push(`%${filtros.sku}%`);
                condicoes.push(`ndi.sku ILIKE $${valores.length}`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT
                    nd.numero, nd.cliente, nd.data_nota, nd.status AS status_nota,
                    ndi.sku, ndi.descricao, ndi.quantidade_esperada, ndi.quantidade_boa, ndi.quantidade_defeituosa
                FROM notas_devolucao nd
                JOIN nf_devolucao_itens ndi ON ndi.nota_id = nd.id
                ${where}
                ORDER BY nd.data_nota DESC, nd.numero, ndi.sku
            `;
            return { texto, valores };
        },
    },

    // ------------------------------------------------------------
    {
        id: 'produtos',
        titulo: 'Produtos (cadastro)',
        categoria: 'Cadastro',
        descricao: 'Cadastro de produtos com código de barras, tipo (serializado ou não) e parâmetros de estoque/pallet.',
        filtros: [
            { chave: 'sku', label: 'SKU ou descrição', tipo: 'texto' },
            {
                chave: 'ativo', label: 'Situação', tipo: 'select', padrao: 'ativos',
                opcoes: [{ valor: 'ativos', label: 'Só ativos' }, { valor: 'inativos', label: 'Só excluídos' }, { valor: 'todos', label: 'Todos' }],
            },
            {
                chave: 'serializado', label: 'Serializado?', tipo: 'select', padrao: 'todos',
                opcoes: [{ valor: 'sim', label: 'Sim' }, { valor: 'nao', label: 'Não' }, { valor: 'todos', label: 'Todos' }],
            },
        ],
        colunas: [
            { chave: 'sku', label: 'SKU' },
            { chave: 'descricao', label: 'Descrição' },
            { chave: 'codigo_barras', label: 'Código de barras' },
            { chave: 'serializado', label: 'Serializado?' },
            { chave: 'ativo', label: 'Ativo?' },
            { chave: 'estoque_minimo', label: 'Estoque mínimo', tipo: 'numero' },
            { chave: 'estoque_maximo', label: 'Estoque máximo', tipo: 'numero' },
            { chave: 'quantidade_por_pallet', label: 'Qtd por pallet', tipo: 'numero' },
            { chave: 'criado_em', label: 'Cadastrado em', tipo: 'datahora' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            const situacao = filtros.ativo || 'ativos';
            if (situacao === 'ativos') condicoes.push('p.ativo = true');
            else if (situacao === 'inativos') condicoes.push('p.ativo = false');
            if (filtros.serializado === 'sim') condicoes.push('p.serializado = true');
            else if (filtros.serializado === 'nao') condicoes.push('p.serializado = false');
            if (filtros.sku) {
                valores.push(`%${filtros.sku}%`);
                condicoes.push(`(p.sku ILIKE $${valores.length} OR p.descricao ILIKE $${valores.length})`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT
                    p.sku, p.descricao, p.codigo_barras,
                    CASE WHEN p.serializado THEN 'Sim' ELSE 'Não' END AS serializado,
                    CASE WHEN p.ativo THEN 'Sim' ELSE 'Não' END AS ativo,
                    p.estoque_minimo, p.estoque_maximo, p.quantidade_por_pallet, p.criado_em
                FROM produtos p
                ${where}
                ORDER BY p.sku ASC
            `;
            return { texto, valores };
        },
    },

    // ------------------------------------------------------------
    {
        id: 'unidades_serializadas',
        titulo: 'Unidades serializadas',
        categoria: 'Estoque',
        descricao: 'Toda unidade com número de série individual, status atual (em estoque, separada, removida) e onde está.',
        filtros: [
            { chave: 'sku', label: 'SKU', tipo: 'texto' },
            { chave: 'numeroSerie', label: 'Número de série', tipo: 'texto' },
            {
                chave: 'status', label: 'Status', tipo: 'select',
                opcoes: [
                    { valor: 'em_estoque', label: 'Em estoque' },
                    { valor: 'separado', label: 'Separado' },
                    { valor: 'removido', label: 'Removido' },
                ],
            },
            { chave: 'dataInicio', label: 'Atualizado a partir de', tipo: 'data' },
            { chave: 'dataFim', label: 'Atualizado até', tipo: 'data' },
        ],
        colunas: [
            { chave: 'numero_serie', label: 'Série' },
            { chave: 'sku', label: 'SKU' },
            { chave: 'descricao', label: 'Descrição' },
            { chave: 'status', label: 'Status' },
            { chave: 'endereco_codigo', label: 'Endereço atual' },
            { chave: 'criado_em', label: 'Entrou em', tipo: 'datahora' },
            { chave: 'atualizado_em', label: 'Última atualização', tipo: 'datahora' },
        ],
        montarConsulta(filtros = {}) {
            const condicoes = [];
            const valores = [];
            if (filtros.sku) {
                valores.push(`%${filtros.sku}%`);
                condicoes.push(`p.sku ILIKE $${valores.length}`);
            }
            if (filtros.numeroSerie) {
                const semHash = String(filtros.numeroSerie).replace(/^#/, '');
                valores.push(`%${filtros.numeroSerie}%`);
                const idxCom = valores.length;
                valores.push(`%${semHash}%`);
                const idxSem = valores.length;
                condicoes.push(`(us.numero_serie ILIKE $${idxCom} OR us.numero_serie ILIKE $${idxSem})`);
            }
            if (filtros.status) {
                valores.push(filtros.status);
                condicoes.push(`us.status = $${valores.length}`);
            }
            if (filtros.dataInicio) {
                valores.push(filtros.dataInicio);
                condicoes.push(`us.atualizado_em >= $${valores.length}::date`);
            }
            if (filtros.dataFim) {
                valores.push(filtros.dataFim);
                condicoes.push(`us.atualizado_em < ($${valores.length}::date + INTERVAL '1 day')`);
            }
            const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
            const texto = `
                SELECT us.numero_serie, p.sku, p.descricao, us.status, e.codigo AS endereco_codigo, us.criado_em, us.atualizado_em
                FROM unidades_serializadas us
                JOIN produtos p ON p.id = us.produto_id
                LEFT JOIN enderecos e ON e.id = us.endereco_id
                ${where}
                ORDER BY us.atualizado_em DESC
            `;
            return { texto, valores };
        },
    },
];

function buscarDefinicao(id) {
    return RELATORIOS.find((relatorio) => relatorio.id === id) || null;
}

module.exports = { RELATORIOS, buscarDefinicao };
