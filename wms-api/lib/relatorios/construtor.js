// ============================================================
// Construtor de relatórios (26/11/2026, pedido do Dhiefferton: "quero
// em configurações botões pra ligar o que eu quero que apareça no
// relatório, e não esses já prontos").
//
// Cada BASE descreve um assunto do WMS: a tabela principal (from), as
// junções opcionais (joins - só entram na consulta se alguma coluna ou
// filtro ligado precisar delas), as COLUNAS que dá pra ligar e os
// FILTROS que dá pra mostrar. A pessoa monta o relatório escolhendo a
// base + colunas + filtros, e salva (relatorios_salvos, por pessoa).
//
// Segurança: só SELECT. Valor digitado entra SEMPRE como parâmetro
// ($n); a pessoa só escolhe chaves que existem aqui - nunca escreve SQL.
// ============================================================

const TIPO_MOV = {
    recebimento: 'Recebimento', separacao: 'Separação', reposicao: 'Reposição', conferencia: 'Conferência',
    embarque: 'Embarque', transferencia_deposito: 'Transferência de depósito',
    transferencia_deposito_retorno: 'Transferência de depósito (retorno)', ajuste_inventario: 'Ajuste de inventário',
    ajuste_manual: 'Ajuste manual', devolucao_avaria: 'Devolução (avaria)', devolucao_estoque: 'Devolução (estoque devolução)',
    devolucao_picking: 'Devolução (para o picking)', devolucao_alocacao_zen: 'Devolução (alocação Zen)',
    cancelamento_separacao: 'Cancelamento de separação', op_producao: 'OP - produção', op_consumo: 'OP - consumo',
};
const caso = (col, mapa) => `CASE ${col} ${Object.entries(mapa).map(([k, v]) => `WHEN '${k}' THEN '${v.replace(/'/g, "''")}'`).join(' ')} ELSE ${col} END`;
const simNao = (expr) => `CASE WHEN ${expr} THEN 'Sim' ELSE 'Não' END`;
const DEPOSITOS = [{ valor: 'MAQ', label: 'MAQ' }, { valor: 'ALM', label: 'ALM' }, { valor: 'PEC', label: 'PEC' }];

const local = (tipo, end, ped, nf, nd) => `CASE ${tipo}
    WHEN 'vertical' THEN COALESCE(${end}, '—') WHEN 'picking' THEN COALESCE(${end}, '—')
    WHEN 'devolucao' THEN 'Estoque devolução (' || COALESCE(${end}, '—') || ')' WHEN 'pulmao' THEN 'Estoque pulmão'
    WHEN 'flutuante' THEN 'Etiqueta mestre / flutuante' WHEN 'externo' THEN 'Externo' WHEN 'conferencia' THEN 'Conferência'
    WHEN 'embarque' THEN 'Embarque' WHEN 'pedido' THEN 'Ordem ' || COALESCE(${ped}, '')
    WHEN 'nota_importacao' THEN 'NF ' || COALESCE(${nf}, '') WHEN 'nota_devolucao' THEN 'Devolução ' || COALESCE(${nd}, '')
    ELSE COALESCE(${tipo}, '—') END`;

// atalhos: col(chave, label, sql, { tipo, padrao, joins })
const col = (chave, label, sql, o = {}) => ({ chave, label, sql, tipo: o.tipo || 'texto', padrao: !!o.padrao, joins: o.joins || [] });
// filtros: texto (ILIKE em uma ou mais expressões), periodo, opcoes, flag (condição fixa)
const fTexto = (chave, label, exprs, o = {}) => ({ chave, label, tipo: 'texto', exprs: [].concat(exprs), padrao: !!o.padrao, joins: o.joins || [] });
const fPeriodo = (chave, label, expr, o = {}) => ({ chave, label, tipo: 'periodo', expr, padrao: !!o.padrao, joins: o.joins || [] });
const fOpcoes = (chave, label, expr, opcoes, o = {}) => ({ chave, label, tipo: 'opcoes', expr, opcoes, padrao: !!o.padrao, joins: o.joins || [] });
const fFlag = (chave, label, cond, o = {}) => ({ chave, label, tipo: 'flag', cond, padrao: !!o.padrao, joins: o.joins || [] });

const lotesDe = (notaExpr, skuExpr, campo = 'lote') =>
    `(SELECT string_agg(DISTINCT cl.${campo}, ', ') FROM controle_lote cl WHERE cl.nota_id = ${notaExpr} AND cl.sku = ${skuExpr})`;

const BASES = [
    // ------------------------------------------------------------
    {
        id: 'movimentacoes', titulo: 'Movimentações',
        from: 'movimentacoes m JOIN produtos p ON p.id = m.produto_id', ordem: 'm.criado_em DESC',
        joins: {
            eo: "LEFT JOIN enderecos eo ON m.origem_tipo IN ('vertical','picking','devolucao') AND eo.id = m.origem_id",
            ed: "LEFT JOIN enderecos ed ON m.destino_tipo IN ('vertical','picking','devolucao') AND ed.id = m.destino_id",
            po: "LEFT JOIN pedidos po ON m.origem_tipo = 'pedido' AND po.id = m.origem_id",
            pd: "LEFT JOIN pedidos pd ON m.destino_tipo = 'pedido' AND pd.id = m.destino_id",
            ni: "LEFT JOIN notas_importacao ni ON m.origem_tipo = 'nota_importacao' AND ni.id = m.origem_id",
            nd: "LEFT JOIN notas_devolucao nd ON m.origem_tipo = 'nota_devolucao' AND nd.id = m.origem_id",
            us: 'LEFT JOIN unidades_serializadas us ON us.id = m.unidade_serializada_id',
            pal: { sql: 'LEFT JOIN pallets_vertical pal ON pal.id = us.ultimo_pallet_id', requer: ['us'] },
            nfu: { sql: `LEFT JOIN LATERAL (SELECT m2.origem_id AS nota_id FROM movimentacoes m2
                    WHERE m2.unidade_serializada_id = m.unidade_serializada_id AND m2.tipo = 'recebimento' AND m2.origem_tipo = 'nota_importacao'
                    LIMIT 1) nfu ON m.unidade_serializada_id IS NOT NULL` },
            nie: { sql: 'LEFT JOIN notas_importacao nie ON nie.id = COALESCE(ni.id, nfu.nota_id)', requer: ['ni', 'nfu'] },
        },
        colunas: [
            col('data', 'Data/hora', 'm.criado_em', { tipo: 'datahora', padrao: true }),
            col('tipo', 'Tipo', caso('m.tipo', TIPO_MOV), { padrao: true }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('quantidade', 'Qtd', 'm.quantidade', { tipo: 'numero', padrao: true }),
            col('serie', 'Série', 'm.numero_serie_snapshot'),
            col('pallet', 'Pallet', 'pal.etiqueta_codigo', { joins: ['pal'] }),
            col('lote', 'Lote', lotesDe('nie.id', 'p.sku'), { joins: ['nie'] }),
            col('romaneio', 'Romaneio', lotesDe('nie.id', 'p.sku', 'romaneio'), { joins: ['nie'] }),
            col('nf', 'NF de entrada', 'nie.numero', { joins: ['nie'] }),
            col('origem', 'Origem', local('m.origem_tipo', 'eo.codigo', 'po.numero_erp', 'ni.numero', 'nd.numero'), { padrao: true, joins: ['eo', 'po', 'ni', 'nd'] }),
            col('destino', 'Destino', local('m.destino_tipo', 'ed.codigo', 'pd.numero_erp', 'NULL', 'NULL'), { padrao: true, joins: ['ed', 'pd'] }),
            col('endereco', 'Endereço', 'COALESCE(ed.codigo, eo.codigo)', { joins: ['eo', 'ed'] }),
            col('deposito', 'Depósito do produto', 'p.deposito'),
            col('pedido', 'Pedido / OS', 'COALESCE(pd.numero_erp, po.numero_erp)', { joins: ['po', 'pd'] }),
            col('cliente', 'Cliente', 'COALESCE(pd.cliente_nome, po.cliente_nome)', { joins: ['po', 'pd'] }),
            col('operador', 'Operador', 'm.operador', { padrao: true }),
        ],
        filtros: [
            fPeriodo('periodo', 'Período', 'm.criado_em', { padrao: true }),
            fOpcoes('tipo', 'Tipo', 'm.tipo', Object.entries(TIPO_MOV).map(([valor, label]) => ({ valor, label })), { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fTexto('serie', 'Série', 'm.numero_serie_snapshot'),
            fTexto('lote', 'Lote', lotesDe('nie.id', 'p.sku'), { joins: ['nie'] }),
            fTexto('pallet', 'Pallet', 'pal.etiqueta_codigo', { joins: ['pal'] }),
            fTexto('nf', 'NF de entrada', 'nie.numero', { joins: ['nie'] }),
            fOpcoes('deposito', 'Depósito', 'p.deposito', DEPOSITOS),
            fTexto('pedido', 'Pedido / OS', ['po.numero_erp', 'pd.numero_erp'], { joins: ['po', 'pd'] }),
            fTexto('operador', 'Operador', 'm.operador'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'pallets', titulo: 'Pallets',
        from: 'pallets_vertical pv JOIN produtos p ON p.id = pv.produto_id LEFT JOIN enderecos e ON e.id = pv.endereco_id',
        ordem: 'pv.data_entrada DESC',
        joins: {
            nfp: { sql: `LEFT JOIN LATERAL (SELECT m2.origem_id AS nota_id FROM unidades_serializadas u
                    JOIN movimentacoes m2 ON m2.unidade_serializada_id = u.id AND m2.tipo = 'recebimento' AND m2.origem_tipo = 'nota_importacao'
                    WHERE u.ultimo_pallet_id = pv.id LIMIT 1) nfp ON true` },
            nip: { sql: 'LEFT JOIN notas_importacao nip ON nip.id = nfp.nota_id', requer: ['nfp'] },
        },
        colunas: [
            col('pallet', 'Pallet (etiqueta)', 'pv.etiqueta_codigo', { padrao: true }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('quantidade', 'Qtd no pallet', 'pv.quantidade', { tipo: 'numero', padrao: true }),
            col('lote', 'Lote', lotesDe('nip.id', 'p.sku'), { padrao: true, joins: ['nip'] }),
            col('romaneio', 'Romaneio', lotesDe('nip.id', 'p.sku', 'romaneio'), { joins: ['nip'] }),
            col('nf', 'NF de entrada', 'nip.numero', { padrao: true, joins: ['nip'] }),
            col('fornecedor', 'Fornecedor', 'nip.fornecedor', { joins: ['nip'] }),
            col('endereco', 'Endereço', "CASE WHEN pv.area_atual = 'pulmao' THEN 'Estoque pulmão' ELSE e.codigo END", { padrao: true }),
            col('area', 'Área', "CASE pv.area_atual WHEN 'pulmao' THEN 'Pulmão' WHEN 'vertical' THEN 'Vertical' ELSE pv.area_atual END", { padrao: true }),
            col('deposito', 'Depósito', 'pv.deposito', { padrao: true }),
            col('entrada', 'Data de entrada', 'pv.data_entrada', { tipo: 'datahora', padrao: true }),
            col('dias', 'Dias parado', '(CURRENT_DATE - pv.data_entrada::date)', { tipo: 'numero' }),
            col('testado', 'Testado', simNao("pv.teste_status = 'testado'")),
            col('hu', 'Cód. ERP (HU)', 'pv.zenerp_handling_unit_code'),
            col('seriais', 'Seriais no pallet', "(SELECT count(*) FROM unidades_serializadas u WHERE u.pallet_id = pv.id AND u.status = 'em_estoque')", { tipo: 'numero' }),
        ],
        filtros: [
            fFlag('com_qtd', 'Só pallets com quantidade', 'pv.quantidade > 0', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fTexto('lote', 'Lote', lotesDe('nip.id', 'p.sku'), { padrao: true, joins: ['nip'] }),
            fOpcoes('area', 'Área', 'pv.area_atual', [{ valor: 'vertical', label: 'Vertical' }, { valor: 'pulmao', label: 'Pulmão' }], { padrao: true }),
            fTexto('pallet', 'Pallet', 'pv.etiqueta_codigo'),
            fTexto('endereco', 'Endereço', 'e.codigo'),
            fTexto('deposito', 'Depósito', 'pv.deposito'),
            fTexto('nf', 'NF de entrada', 'nip.numero', { joins: ['nip'] }),
            fPeriodo('entrada', 'Data de entrada', 'pv.data_entrada'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'controle_lote', titulo: 'Controle de lote',
        from: 'controle_lote cl LEFT JOIN notas_importacao ni ON ni.id = cl.nota_id', ordem: 'cl.data_chegada DESC',
        joins: {},
        colunas: [
            col('chegada', 'Data de chegada', 'cl.data_chegada', { tipo: 'data', padrao: true }),
            col('nf', 'NF', 'cl.numero_nf', { padrao: true }),
            col('sku', 'Código', 'cl.sku', { padrao: true }),
            col('modelo', 'Modelo', 'cl.modelo', { padrao: true }),
            col('lote', 'Lote', 'cl.lote', { padrao: true }),
            col('romaneio', 'Romaneio', 'cl.romaneio', { padrao: true }),
            col('quantidade', 'Quantidade', 'cl.quantidade', { tipo: 'numero', padrao: true }),
            col('fornecedor', 'Fornecedor', 'ni.fornecedor'),
            col('origem', 'Origem', "CASE cl.origem WHEN 'recebimento_wms' THEN 'Recebimento WMS' WHEN 'importacao_historica' THEN 'Planilha antiga' ELSE cl.origem END"),
        ],
        filtros: [
            fPeriodo('periodo', 'Data de chegada', 'cl.data_chegada', { padrao: true }),
            fTexto('nf', 'NF', 'cl.numero_nf', { padrao: true }),
            fTexto('sku', 'Código ou modelo', ['cl.sku', 'cl.modelo'], { padrao: true }),
            fTexto('lote', 'Lote', 'cl.lote', { padrao: true }),
            fTexto('romaneio', 'Romaneio', 'cl.romaneio'),
            fTexto('fornecedor', 'Fornecedor', 'ni.fornecedor'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'estoque', titulo: 'Estoque',
        from: 'produtos p', ordem: 'p.sku',
        joins: {
            vt: "LEFT JOIN (SELECT produto_id, SUM(quantidade) t FROM pallets_vertical WHERE quantidade > 0 AND area_atual = 'vertical' GROUP BY produto_id) vt ON vt.produto_id = p.id",
            pu: "LEFT JOIN (SELECT produto_id, SUM(quantidade) t FROM pallets_vertical WHERE quantidade > 0 AND area_atual = 'pulmao' GROUP BY produto_id) pu ON pu.produto_id = p.id",
            pk: 'LEFT JOIN (SELECT produto_id, SUM(quantidade) t FROM unidades_picking GROUP BY produto_id) pk ON pk.produto_id = p.id',
            se: "LEFT JOIN (SELECT produto_id, COUNT(*) t FROM unidades_serializadas WHERE status = 'em_estoque' GROUP BY produto_id) se ON se.produto_id = p.id",
            em: 'LEFT JOIN etiquetas_mestre em ON em.produto_id = p.id',
        },
        colunas: [
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('deposito', 'Depósito', 'p.deposito', { padrao: true }),
            col('endereco', 'Endereço', 'p.endereco_picking', { padrao: true }),
            col('total', 'Saldo total', 'COALESCE(vt.t,0) + COALESCE(pu.t,0) + COALESCE(pk.t,0) + COALESCE(em.quantidade,0)', { tipo: 'numero', padrao: true, joins: ['vt', 'pu', 'pk', 'em'] }),
            col('vertical', 'Em pallet (vertical)', 'COALESCE(vt.t,0)', { tipo: 'numero', joins: ['vt'] }),
            col('pulmao', 'No pulmão', 'COALESCE(pu.t,0)', { tipo: 'numero', joins: ['pu'] }),
            col('picking', 'No picking', 'COALESCE(pk.t,0)', { tipo: 'numero', joins: ['pk'] }),
            col('etiqueta', 'Etiqueta mestre', 'em.codigo', { joins: ['em'] }),
            col('saldo_etiqueta', 'Saldo etiqueta mestre', 'COALESCE(em.quantidade,0)', { tipo: 'numero', joins: ['em'] }),
            col('seriais', 'Seriais em estoque', 'COALESCE(se.t,0)', { tipo: 'numero', joins: ['se'] }),
            col('minimo', 'Mínimo', 'p.estoque_minimo', { tipo: 'numero' }),
            col('maximo', 'Máximo', 'p.estoque_maximo', { tipo: 'numero' }),
            col('abaixo', 'Abaixo do mínimo', simNao('COALESCE(vt.t,0) + COALESCE(pu.t,0) + COALESCE(pk.t,0) + COALESCE(em.quantidade,0) < COALESCE(p.estoque_minimo,0)'), { joins: ['vt', 'pu', 'pk', 'em'] }),
            col('serializado', 'Serializado', simNao('p.serializado')),
        ],
        filtros: [
            fFlag('ativos', 'Só produtos ativos', 'p.ativo = true', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fOpcoes('deposito', 'Depósito', 'p.deposito', DEPOSITOS, { padrao: true }),
            fFlag('com_saldo', 'Só com saldo', 'COALESCE(vt.t,0) + COALESCE(pu.t,0) + COALESCE(pk.t,0) + COALESCE(em.quantidade,0) > 0', { padrao: true, joins: ['vt', 'pu', 'pk', 'em'] }),
            fTexto('endereco', 'Endereço', 'p.endereco_picking'),
            fFlag('abaixo', 'Só abaixo do mínimo', 'COALESCE(vt.t,0) + COALESCE(pu.t,0) + COALESCE(pk.t,0) + COALESCE(em.quantidade,0) < COALESCE(p.estoque_minimo,0)', { joins: ['vt', 'pu', 'pk', 'em'] }),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'unidades', titulo: 'Unidades (seriais)',
        from: 'unidades_serializadas u JOIN produtos p ON p.id = u.produto_id LEFT JOIN enderecos e ON e.id = u.endereco_id',
        ordem: 'u.criado_em DESC',
        joins: {
            pal: 'LEFT JOIN pallets_vertical pal ON pal.id = COALESCE(u.pallet_id, u.ultimo_pallet_id)',
            nfu: { sql: `LEFT JOIN LATERAL (SELECT m2.origem_id AS nota_id FROM movimentacoes m2 WHERE m2.unidade_serializada_id = u.id
                    AND m2.tipo = 'recebimento' AND m2.origem_tipo = 'nota_importacao' LIMIT 1) nfu ON true` },
            niu: { sql: 'LEFT JOIN notas_importacao niu ON niu.id = nfu.nota_id', requer: ['nfu'] },
            ult: { sql: `LEFT JOIN LATERAL (SELECT m3.criado_em, m3.tipo, CASE WHEN m3.destino_tipo = 'pedido' THEN m3.destino_id
                    WHEN m3.origem_tipo = 'pedido' THEN m3.origem_id END AS pedido_id FROM movimentacoes m3
                    WHERE m3.unidade_serializada_id = u.id ORDER BY m3.criado_em DESC LIMIT 1) ult ON true` },
            upe: { sql: 'LEFT JOIN pedidos upe ON upe.id = ult.pedido_id', requer: ['ult'] },
        },
        colunas: [
            col('serie', 'Série', 'u.numero_serie', { padrao: true }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('status', 'Status', "CASE u.status WHEN 'em_estoque' THEN 'Em estoque' WHEN 'separado' THEN 'Separado' ELSE u.status END", { padrao: true }),
            col('endereco', 'Endereço', 'e.codigo', { padrao: true }),
            col('pallet', 'Pallet', 'pal.etiqueta_codigo', { padrao: true, joins: ['pal'] }),
            col('lote', 'Lote', lotesDe('niu.id', 'p.sku'), { joins: ['niu'] }),
            col('nf', 'NF de entrada', 'niu.numero', { joins: ['niu'] }),
            col('deposito', 'Depósito do produto', 'p.deposito'),
            col('recebido', 'Recebido em', 'u.criado_em', { tipo: 'datahora' }),
            col('ult_data', 'Última movimentação', 'ult.criado_em', { tipo: 'datahora', joins: ['ult'] }),
            col('ult_tipo', 'Tipo da última movimentação', caso('ult.tipo', TIPO_MOV), { joins: ['ult'] }),
            col('pedido', 'Último pedido / OS', 'upe.numero_erp', { joins: ['upe'] }),
        ],
        filtros: [
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fOpcoes('status', 'Status', 'u.status', [{ valor: 'em_estoque', label: 'Em estoque' }, { valor: 'separado', label: 'Separado' }], { padrao: true }),
            fTexto('serie', 'Série', 'u.numero_serie'),
            fTexto('pallet', 'Pallet', 'pal.etiqueta_codigo', { joins: ['pal'] }),
            fTexto('lote', 'Lote', lotesDe('niu.id', 'p.sku'), { joins: ['niu'] }),
            fTexto('endereco', 'Endereço', 'e.codigo'),
            fPeriodo('recebido', 'Recebido em', 'u.criado_em'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'pedidos', titulo: 'Pedidos / OS',
        from: 'pedidos pe', ordem: 'pe.criado_em DESC',
        joins: {
            it: `LEFT JOIN LATERAL (SELECT count(*) n, COALESCE(sum(ip.quantidade_x),0) qp, COALESCE(sum(ip.quantidade_separada),0) qs,
                    bool_or(ip.produto_id IS NULL) almox FROM itens_pedido ip WHERE ip.pedido_id = pe.id) it ON true`,
            sep: `LEFT JOIN LATERAL (SELECT string_agg(DISTINCT m.operador, ', ') ops FROM movimentacoes m
                    WHERE m.tipo = 'separacao' AND m.destino_tipo = 'pedido' AND m.destino_id = pe.id) sep ON true`,
            conf: `LEFT JOIN LATERAL (SELECT string_agg(DISTINCT m.operador, ', ') ops FROM movimentacoes m
                    WHERE m.tipo = 'conferencia' AND (m.origem_id = pe.id OR m.destino_id = pe.id)) conf ON true`,
        },
        colunas: [
            col('os', 'OS', 'pe.numero_erp', { padrao: true }),
            col('cliente', 'Cliente', 'pe.cliente_nome', { padrao: true }),
            col('transportadora', 'Transportadora', 'pe.transportadora_nome', { padrao: true }),
            col('etapa', 'Etapa', 'pe.etapa_separacao', { padrao: true }),
            col('status', 'Status', 'pe.status'),
            col('itens', 'Itens', 'it.n', { tipo: 'numero', padrao: true, joins: ['it'] }),
            col('qtd_pedida', 'Qtd pedida', 'it.qp', { tipo: 'numero', joins: ['it'] }),
            col('qtd_separada', 'Qtd separada', 'it.qs', { tipo: 'numero', joins: ['it'] }),
            col('almox', 'Peças do almoxarifado', simNao('it.almox'), { joins: ['it'] }),
            col('impressa', 'Impressa em', 'pe.impresso_em', { tipo: 'datahora' }),
            col('separado_por', 'Separado por', 'sep.ops', { joins: ['sep'] }),
            col('conferido_por', 'Conferido por', 'conf.ops', { joins: ['conf'] }),
            col('criado', 'Criado em', 'pe.criado_em', { tipo: 'datahora', padrao: true }),
        ],
        filtros: [
            fPeriodo('periodo', 'Criado em', 'pe.criado_em', { padrao: true }),
            fTexto('etapa', 'Etapa', 'pe.etapa_separacao', { padrao: true }),
            fTexto('os', 'OS', 'pe.numero_erp', { padrao: true }),
            fTexto('cliente', 'Cliente', 'pe.cliente_nome'),
            fTexto('transportadora', 'Transportadora', 'pe.transportadora_nome'),
            fFlag('almox', 'Só com peças do almoxarifado', 'EXISTS (SELECT 1 FROM itens_pedido x WHERE x.pedido_id = pe.id AND x.produto_id IS NULL)'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'itens_pedidos', titulo: 'Itens dos pedidos',
        from: 'itens_pedido ip JOIN pedidos pe ON pe.id = ip.pedido_id LEFT JOIN produtos p ON p.id = ip.produto_id',
        ordem: 'pe.criado_em DESC, pe.numero_erp',
        joins: {},
        colunas: [
            col('os', 'OS', 'pe.numero_erp', { padrao: true }),
            col('sku', 'SKU', 'COALESCE(p.sku, ip.sku_zenerp)', { padrao: true }),
            col('descricao', 'Descrição', 'COALESCE(p.descricao, ip.descricao_zenerp)', { padrao: true }),
            col('qtd_pedida', 'Qtd pedida', 'ip.quantidade_x', { tipo: 'numero', padrao: true }),
            col('qtd_separada', 'Qtd separada', 'ip.quantidade_separada', { tipo: 'numero', padrao: true }),
            col('origem', 'Origem', "CASE WHEN ip.produto_id IS NULL OR p.separado_pelo_almoxarifado THEN 'Almoxarifado' ELSE 'Expedição' END", { padrao: true }),
            col('endereco', 'Endereço', 'p.endereco_picking', { padrao: true }),
            col('deposito', 'Depósito', 'p.deposito'),
            col('status', 'Status do item', 'ip.status'),
            col('cliente', 'Cliente', 'pe.cliente_nome'),
            col('etapa', 'Etapa do pedido', 'pe.etapa_separacao'),
            col('criado', 'Pedido criado em', 'pe.criado_em', { tipo: 'datahora' }),
        ],
        filtros: [
            fTexto('os', 'OS', 'pe.numero_erp', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'ip.sku_zenerp', 'p.descricao', 'ip.descricao_zenerp'], { padrao: true }),
            fOpcoes('origem', 'Origem', "CASE WHEN ip.produto_id IS NULL OR p.separado_pelo_almoxarifado THEN 'Almoxarifado' ELSE 'Expedição' END",
                [{ valor: 'Expedição', label: 'Expedição' }, { valor: 'Almoxarifado', label: 'Almoxarifado' }]),
            fOpcoes('status', 'Status do item', 'ip.status', [{ valor: 'pendente', label: 'Pendente' }, { valor: 'parcial', label: 'Parcial' }, { valor: 'completo', label: 'Completo' }]),
            fPeriodo('periodo', 'Pedido criado em', 'pe.criado_em'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'nf_importacao', titulo: 'NF de importação',
        from: 'nf_importacao_itens it JOIN notas_importacao ni ON ni.id = it.nota_id', ordem: 'ni.data_nota DESC, ni.numero',
        joins: {},
        colunas: [
            col('nf', 'NF', 'ni.numero', { padrao: true }),
            col('fornecedor', 'Fornecedor', 'ni.fornecedor', { padrao: true }),
            col('data', 'Data da NF', 'ni.data_nota', { tipo: 'data', padrao: true }),
            col('status', 'Status da NF', 'ni.status', { padrao: true }),
            col('sku', 'SKU', 'it.sku', { padrao: true }),
            col('descricao', 'Descrição', 'it.descricao', { padrao: true }),
            col('esperada', 'Qtd esperada', 'it.quantidade_esperada', { tipo: 'numero', padrao: true }),
            col('recebida', 'Qtd recebida', 'it.quantidade_recebida', { tipo: 'numero', padrao: true }),
            col('unidade', 'Unidade', 'it.unidade'),
            col('valor', 'Valor unitário', 'it.valor_unitario', { tipo: 'numero' }),
            col('lote', 'Lote', lotesDe('ni.id', 'it.sku')),
            col('romaneio', 'Romaneio', lotesDe('ni.id', 'it.sku', 'romaneio')),
            col('peso', 'Peso bruto (kg)', 'it.peso_bruto_kg', { tipo: 'numero' }),
        ],
        filtros: [
            fPeriodo('periodo', 'Data da NF', 'ni.data_nota', { padrao: true }),
            fTexto('nf', 'NF', 'ni.numero', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['it.sku', 'it.descricao'], { padrao: true }),
            fTexto('fornecedor', 'Fornecedor', 'ni.fornecedor'),
            fTexto('status', 'Status da NF', 'ni.status'),
            fFlag('pendente', 'Só itens não recebidos por completo', 'it.quantidade_recebida < it.quantidade_esperada'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'devolucoes', titulo: 'Devoluções',
        from: 'nf_devolucao_itens it JOIN notas_devolucao nd ON nd.id = it.nota_id', ordem: 'nd.data_nota DESC, nd.numero',
        joins: {},
        colunas: [
            col('nf', 'NF', 'nd.numero', { padrao: true }),
            col('cliente', 'Cliente', 'nd.cliente', { padrao: true }),
            col('data', 'Data da NF', 'nd.data_nota', { tipo: 'data', padrao: true }),
            col('status', 'Status da NF', 'nd.status'),
            col('sku', 'SKU', 'it.sku', { padrao: true }),
            col('descricao', 'Descrição', 'it.descricao', { padrao: true }),
            col('esperada', 'Qtd esperada', 'it.quantidade_esperada', { tipo: 'numero', padrao: true }),
            col('boa', 'Qtd boa', 'it.quantidade_boa', { tipo: 'numero', padrao: true }),
            col('defeituosa', 'Qtd defeituosa', 'it.quantidade_defeituosa', { tipo: 'numero', padrao: true }),
            col('valor', 'Valor unitário', 'it.valor_unitario', { tipo: 'numero' }),
        ],
        filtros: [
            fPeriodo('periodo', 'Data da NF', 'nd.data_nota', { padrao: true }),
            fTexto('nf', 'NF', 'nd.numero', { padrao: true }),
            fTexto('cliente', 'Cliente', 'nd.cliente', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['it.sku', 'it.descricao']),
            fFlag('defeito', 'Só com defeito', 'it.quantidade_defeituosa > 0'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'inventario', titulo: 'Inventário (contagens)',
        from: 'contagens_inventario c JOIN produtos p ON p.id = c.produto_id LEFT JOIN enderecos e ON e.id = c.endereco_id',
        ordem: 'c.criado_em DESC',
        joins: {},
        colunas: [
            col('data', 'Data', 'c.criado_em', { tipo: 'datahora', padrao: true }),
            col('tipo', 'Tipo', 'c.tipo'),
            col('numero', 'Nº da contagem', 'c.numero_contagem', { tipo: 'numero' }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('endereco', 'Endereço', 'e.codigo', { padrao: true }),
            col('esperado', 'Qtd sistema', 'c.saldo_esperado', { tipo: 'numero', padrao: true }),
            col('contado', 'Qtd contada', 'c.quantidade_contada', { tipo: 'numero', padrao: true }),
            col('diferenca', 'Diferença', '(c.quantidade_contada - c.saldo_esperado)', { tipo: 'numero', padrao: true }),
            col('status', 'Status', 'c.status'),
            col('operador', 'Contado por', 'c.operador', { padrao: true }),
            col('concluido', 'Concluído em', 'c.concluido_em', { tipo: 'datahora' }),
        ],
        filtros: [
            fPeriodo('periodo', 'Data', 'c.criado_em', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fFlag('diferenca', 'Só com diferença', 'c.quantidade_contada IS DISTINCT FROM c.saldo_esperado', { padrao: true }),
            fTexto('endereco', 'Endereço', 'e.codigo'),
            fTexto('status', 'Status', 'c.status'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'reposicao', titulo: 'Reposição',
        from: 'tarefas_reposicao t JOIN produtos p ON p.id = t.produto_id LEFT JOIN pallets_vertical pv ON pv.id = t.pallet_origem_id LEFT JOIN enderecos e ON e.id = pv.endereco_id',
        ordem: 't.criado_em DESC',
        joins: {},
        colunas: [
            col('criada', 'Criada em', 't.criado_em', { tipo: 'datahora', padrao: true }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('pallet', 'Pallet de origem', 'pv.etiqueta_codigo', { padrao: true }),
            col('de', 'Endereço de origem', 'e.codigo', { padrao: true }),
            col('quantidade', 'Qtd', 't.quantidade', { tipo: 'numero', padrao: true }),
            col('status', 'Status', 't.status', { padrao: true }),
            col('operador', 'Feito por', 't.operador'),
            col('concluida', 'Concluída em', 't.concluido_em', { tipo: 'datahora' }),
        ],
        filtros: [
            fPeriodo('periodo', 'Criada em', 't.criado_em', { padrao: true }),
            fTexto('status', 'Status', 't.status', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao']),
            fTexto('operador', 'Feito por', 't.operador'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'etiqueta_mestre', titulo: 'Etiqueta mestre (entradas e saídas)',
        from: 'etiquetas_mestre_movimentos mv JOIN etiquetas_mestre em ON em.id = mv.etiqueta_mestre_id JOIN produtos p ON p.id = em.produto_id LEFT JOIN notas_importacao ni ON mv.origem_tipo = \'nota_importacao\' AND ni.id = mv.origem_id',
        ordem: 'mv.criado_em DESC',
        joins: {},
        colunas: [
            col('data', 'Data/hora', 'mv.criado_em', { tipo: 'datahora', padrao: true }),
            col('etiqueta', 'Etiqueta', 'em.codigo', { padrao: true }),
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('tipo', 'Tipo', 'mv.tipo', { padrao: true }),
            col('quantidade', 'Qtd', 'mv.quantidade', { tipo: 'numero', padrao: true }),
            col('antes', 'Saldo antes', 'mv.saldo_antes', { tipo: 'numero' }),
            col('depois', 'Saldo depois', 'mv.saldo_depois', { tipo: 'numero', padrao: true }),
            col('endereco', 'Endereço', 'p.endereco_picking'),
            col('nf', 'NF', 'ni.numero'),
            col('lote', 'Lote', lotesDe('ni.id', 'p.sku')),
            col('observacao', 'Observação', 'mv.observacao'),
            col('operador', 'Operador', 'mv.operador', { padrao: true }),
        ],
        filtros: [
            fPeriodo('periodo', 'Período', 'mv.criado_em', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fTexto('nf', 'NF', 'ni.numero'),
            fTexto('operador', 'Operador', 'mv.operador'),
        ],
    },
    // ------------------------------------------------------------
    {
        id: 'produtos', titulo: 'Produtos (cadastro)',
        from: 'produtos p', ordem: 'p.sku',
        joins: {},
        colunas: [
            col('sku', 'SKU', 'p.sku', { padrao: true }),
            col('descricao', 'Descrição', 'p.descricao', { padrao: true }),
            col('deposito', 'Depósito', 'p.deposito', { padrao: true }),
            col('endereco', 'Endereço', 'p.endereco_picking', { padrao: true }),
            col('serializado', 'Serializado', simNao('p.serializado'), { padrao: true }),
            col('almox', 'Separado pelo almoxarifado', simNao('p.separado_pelo_almoxarifado')),
            col('barras', 'Código de barras', 'p.codigo_barras'),
            col('minimo', 'Estoque mínimo', 'p.estoque_minimo', { tipo: 'numero' }),
            col('maximo', 'Estoque máximo', 'p.estoque_maximo', { tipo: 'numero' }),
            col('por_pallet', 'Qtd por pallet', 'p.quantidade_por_pallet', { tipo: 'numero' }),
            col('comprimento', 'Comprimento (cm)', 'p.comprimento_cm', { tipo: 'numero' }),
            col('largura', 'Largura (cm)', 'p.largura_cm', { tipo: 'numero' }),
            col('altura', 'Altura (cm)', 'p.altura_cm', { tipo: 'numero' }),
            col('peso', 'Peso (kg)', 'p.peso_kg', { tipo: 'numero' }),
            col('ativo', 'Ativo', simNao('p.ativo')),
            col('criado', 'Cadastrado em', 'p.criado_em', { tipo: 'datahora' }),
        ],
        filtros: [
            fFlag('ativos', 'Só produtos ativos', 'p.ativo = true', { padrao: true }),
            fTexto('sku', 'SKU ou descrição', ['p.sku', 'p.descricao'], { padrao: true }),
            fOpcoes('deposito', 'Depósito', 'p.deposito', DEPOSITOS, { padrao: true }),
            fFlag('sem_endereco', 'Só sem endereço', "COALESCE(trim(p.endereco_picking), '') = ''"),
            fOpcoes('serializado', 'Serializado', "CASE WHEN p.serializado THEN 'sim' ELSE 'nao' END", [{ valor: 'sim', label: 'Sim' }, { valor: 'nao', label: 'Não' }]),
        ],
    },
];

const buscarBase = (id) => BASES.find((b) => b.id === id) || null;

// Metadados pra tela (sem SQL).
function catalogo() {
    return BASES.map((b) => ({
        id: b.id, titulo: b.titulo,
        colunas: b.colunas.map(({ chave, label, tipo, padrao }) => ({ chave, label, tipo, padrao })),
        filtros: b.filtros.map(({ chave, label, tipo, padrao, opcoes }) => ({ chave, label, tipo, padrao, opcoes })),
    }));
}

class ErroConstrutor extends Error {}

// Monta a consulta. colunasEscolhidas: [chave]; filtrosAtivos: [chave] (os que estão na tela);
// valores: { chave: valor | {de, ate} | true }.
function montar(baseId, colunasEscolhidas, filtrosAtivos, valores = {}) {
    const base = buscarBase(baseId);
    if (!base) throw new ErroConstrutor('Base de relatório não existe');
    const cols = (colunasEscolhidas || []).map((c) => base.colunas.find((x) => x.chave === c)).filter(Boolean);
    if (cols.length === 0) throw new ErroConstrutor('Ligue pelo menos uma coluna');

    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const condicoes = [];
    const joinsUsados = new Set();
    const usar = (lista) => lista.forEach((j) => {
        const def = base.joins[j];
        if (!def) return;
        if (typeof def === 'object' && def.requer) usar(def.requer);
        joinsUsados.add(j);
    });
    cols.forEach((c) => usar(c.joins));

    for (const chave of filtrosAtivos || []) {
        const f = base.filtros.find((x) => x.chave === chave);
        if (!f) continue;
        const v = valores[chave];
        if (f.tipo === 'flag') {
            // flag ligada na configuração = condição sempre aplicada (pode desligar na tela com false)
            if (v === false) continue;
            usar(f.joins); condicoes.push(`(${f.cond})`);
        } else if (f.tipo === 'texto') {
            const t = String(v ?? '').trim();
            if (!t) continue;
            usar(f.joins);
            const ph = p(`%${t.replace(/[\\%_]/g, '\\$&')}%`);
            condicoes.push(`(${f.exprs.map((e) => `(${e})::text ILIKE ${ph}`).join(' OR ')})`);
        } else if (f.tipo === 'opcoes') {
            if (v === undefined || v === null || v === '') continue;
            usar(f.joins); condicoes.push(`(${f.expr})::text = ${p(String(v))}`);
        } else if (f.tipo === 'periodo') {
            const de = v?.de; const ate = v?.ate;
            const data = /^\d{4}-\d{2}-\d{2}$/;
            if (de && data.test(de)) { usar(f.joins); condicoes.push(`${f.expr} >= ${p(de)}::date`); }
            if (ate && data.test(ate)) { usar(f.joins); condicoes.push(`${f.expr} < (${p(ate)}::date + INTERVAL '1 day')`); }
        }
    }

    const joinsSql = Object.keys(base.joins).filter((j) => joinsUsados.has(j))
        .map((j) => (typeof base.joins[j] === 'string' ? base.joins[j] : base.joins[j].sql)).join('\n');
    const texto = `SELECT ${cols.map((c, i) => `${c.sql} AS c${i}`).join(', ')}
        FROM ${base.from}
        ${joinsSql}
        ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
        ORDER BY ${base.ordem}`;
    return { base, cols, texto, params };
}

const LIMITE_TELA = 100;
const LIMITE_EXPORTACAO = 50000;

// Tela: paginado (sem COUNT, pra não varrer tabela grande - pede 1 a mais pra saber se tem próxima página).
async function executar(pool, { base, colunas, filtros, valores, pagina = 0, tamanho = LIMITE_TELA }) {
    const m = montar(base, colunas, filtros, valores);
    const tam = Math.min(500, Math.max(1, Number(tamanho) || LIMITE_TELA));
    const pag = Math.max(0, Number(pagina) || 0);
    const { rows } = await pool.query(`${m.texto} LIMIT ${tam + 1} OFFSET ${pag * tam}`, m.params);
    const linhas = rows.slice(0, tam).map((r) => Object.fromEntries(m.cols.map((c, i) => [c.chave, r[`c${i}`]])));
    return { colunas: m.cols.map(({ chave, label, tipo }) => ({ chave, label, tipo })), linhas, pagina: pag, tamanho: tam, temMais: rows.length > tam, titulo: m.base.titulo };
}

async function executarCompleto(pool, { base, colunas, filtros, valores }) {
    const m = montar(base, colunas, filtros, valores);
    const { rows } = await pool.query(`${m.texto} LIMIT ${LIMITE_EXPORTACAO}`, m.params);
    const linhas = rows.map((r) => Object.fromEntries(m.cols.map((c, i) => [c.chave, r[`c${i}`]])));
    return { colunas: m.cols.map(({ chave, label, tipo }) => ({ chave, label, tipo })), linhas, limiteAtingido: rows.length >= LIMITE_EXPORTACAO, titulo: m.base.titulo };
}

module.exports = { BASES, catalogo, montar, executar, executarCompleto, ErroConstrutor, LIMITE_EXPORTACAO };
