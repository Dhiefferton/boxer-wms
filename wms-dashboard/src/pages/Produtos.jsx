import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Produtos() {
    const [produtos, setProdutos] = useState([]);
    const [busca, setBusca] = useState('');
    const [selecionado, setSelecionado] = useState(null);
    const [selecionados, setSelecionados] = useState(new Set());
    const [form, setForm] = useState({
        sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '', serializado: false,
        comprimentoCm: '', larguraCm: '', alturaCm: '', pesoKg: '', lastroManualPallet: '',
    });
    const [salvando, setSalvando] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [excluindoVarios, setExcluindoVarios] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [saldoZenErp, setSaldoZenErp] = useState(null);
    const [consultandoSaldo, setConsultandoSaldo] = useState(false);
    const [consultandoDimensoes, setConsultandoDimensoes] = useState(false);

    // Sincronizacao em massa
    const [sincronizando, setSincronizando] = useState(false);
    const [progressoSync, setProgressoSync] = useState(null);
    const [resultadosSync, setResultadosSync] = useState(null);

    // Capacidade por pallet (Fase B)
    const [capacidade, setCapacidade] = useState(null);
    const [erroCapacidade, setErroCapacidade] = useState(null);
    const [calculandoCapacidade, setCalculandoCapacidade] = useState(false);

    function carregar() {
        api.get('/produtos').then(setProdutos);
    }

    useEffect(carregar, []);

    const produtosFiltrados = produtos.filter((p) => {
        if (!busca) return true;
        const termo = busca.toLowerCase();
        return (
            p.sku.toLowerCase().includes(termo) ||
            p.descricao.toLowerCase().includes(termo) ||
            (p.codigo_barras || '').toLowerCase().includes(termo)
        );
    });

    async function calcularCapacidade(produtoId) {
        setCalculandoCapacidade(true);
        setCapacidade(null);
        setErroCapacidade(null);
        try {
            const resposta = await api.get(`/produtos/${produtoId}/capacidade-pallet`);
            setCapacidade(resposta);
        } catch (e) {
            setErroCapacidade(e.message);
        } finally {
            setCalculandoCapacidade(false);
        }
    }

    function selecionar(produto) {
        setSelecionado(produto);
        setForm({
            sku: produto.sku,
            descricao: produto.descricao,
            codigoBarras: produto.codigo_barras ?? '',
            estoqueMinimo: produto.estoque_minimo,
            quantidadePorPallet: produto.quantidade_por_pallet ?? '',
            serializado: !!produto.serializado,
            comprimentoCm: produto.comprimento_cm ?? '',
            larguraCm: produto.largura_cm ?? '',
            alturaCm: produto.altura_cm ?? '',
            pesoKg: produto.peso_kg ?? '',
            lastroManualPallet: produto.lastro_manual_pallet ?? '',
        });
        setSaldoZenErp(null);
        setMensagem(null);
        calcularCapacidade(produto.id);
    }

    function novoProduto() {
        setSelecionado(null);
        setForm({
            sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '', serializado: false,
            comprimentoCm: '', larguraCm: '', alturaCm: '', pesoKg: '', lastroManualPallet: '',
        });
        setSaldoZenErp(null);
        setMensagem(null);
        setCapacidade(null);
        setErroCapacidade(null);
    }

    function alternarSelecao(id) {
        setSelecionados((atual) => {
            const novo = new Set(atual);
            if (novo.has(id)) novo.delete(id);
            else novo.add(id);
            return novo;
        });
    }

    function alternarSelecaoTodos() {
        setSelecionados((atual) =>
            atual.size === produtosFiltrados.length ? new Set() : new Set(produtosFiltrados.map((p) => p.id))
        );
    }

    async function consultarSaldoZenErp() {
        setConsultandoSaldo(true);
        setSaldoZenErp(null);
        try {
            const resposta = await api.get(`/produtos/${selecionado.id}/saldo-zenerp`);
            setSaldoZenErp(resposta.saldo);
        } catch (e) {
            setSaldoZenErp(`Erro: ${e.message}`);
        } finally {
            setConsultandoSaldo(false);
        }
    }

    async function puxarDimensoesZenErp() {
        setConsultandoDimensoes(true);
        setMensagem(null);
        try {
            const resposta = await api.get(`/produtos/${selecionado.id}/dimensoes-zenerp`);
            setForm((atual) => ({
                ...atual,
                comprimentoCm: resposta.comprimentoCm ?? atual.comprimentoCm,
                larguraCm: resposta.larguraCm ?? atual.larguraCm,
                alturaCm: resposta.alturaCm ?? atual.alturaCm,
                pesoKg: resposta.pesoKg ?? atual.pesoKg,
            }));
            setMensagem('Dimensões preenchidas a partir do ZenERP. Revise antes de salvar.');
        } catch (e) {
            setMensagem(`Erro ao puxar do ERP: ${e.message}`);
        } finally {
            setConsultandoDimensoes(false);
        }
    }

    async function sincronizarDimensoesEmMassa() {
        if (!confirm('Sincronizar dimensões de TODOS os produtos com o ZenERP? Isso pode levar alguns minutos.')) {
            return;
        }
        setSincronizando(true);
        setProgressoSync({ processados: 0, total: null });
        setResultadosSync(null);

        let offset = 0;
        let concluido = false;
        const acumulado = [];

        try {
            while (!concluido) {
                const resposta = await api.post(`/produtos/sincronizar-dimensoes-zenerp?limit=20&offset=${offset}`);
                acumulado.push(...resposta.resultados);
                setProgressoSync({ processados: resposta.proximoOffset, total: resposta.totalAtivos });
                offset = resposta.proximoOffset;
                concluido = resposta.concluido;
            }

            const atualizados = acumulado.filter((r) => r.status === 'atualizado').length;
            const naoEncontrados = acumulado.filter((r) => r.status === 'nao_encontrado').length;
            const erros = acumulado.filter((r) => r.status === 'erro').length;
            setResultadosSync({ atualizados, naoEncontrados, erros, total: acumulado.length });
            carregar();
        } catch (e) {
            setMensagem(`Erro na sincronização em massa: ${e.message}`);
        } finally {
            setSincronizando(false);
        }
    }

    async function excluir() {
        if (!confirm(`Excluir o produto "${selecionado.sku}"? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setExcluindo(true);
        setMensagem(null);
        try {
            await api.delete(`/produtos/${selecionado.id}`);
            novoProduto();
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindo(false);
        }
    }

    async function excluirSelecionados() {
        if (selecionados.size === 0) return;
        if (!confirm(`Excluir ${selecionados.size} produto(s) selecionado(s)? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setExcluindoVarios(true);
        setMensagem(null);
        try {
            const resposta = await api.post('/produtos/excluir-varios', { ids: [...selecionados] });
            if (resposta.bloqueados.length > 0) {
                setMensagem(
                    `${resposta.excluidos.length} excluído(s). ${resposta.bloqueados.length} bloqueado(s) por ainda ter estoque físico.`
                );
            } else {
                setMensagem(`${resposta.excluidos.length} produto(s) excluído(s).`);
            }
            setSelecionados(new Set());
            novoProduto();
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindoVarios(false);
        }
    }

    async function salvar() {
        setSalvando(true);
        setMensagem(null);
        try {
            const payload = {
                descricao: form.descricao,
                codigoBarras: form.codigoBarras || null,
                estoqueMinimo: Number(form.estoqueMinimo),
                quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
                serializado: form.serializado,
                comprimentoCm: form.comprimentoCm === '' ? null : Number(form.comprimentoCm),
                larguraCm: form.larguraCm === '' ? null : Number(form.larguraCm),
                alturaCm: form.alturaCm === '' ? null : Number(form.alturaCm),
                pesoKg: form.pesoKg === '' ? null : Number(form.pesoKg),
                lastroManualPallet: form.lastroManualPallet === '' ? null : Number(form.lastroManualPallet),
            };
            if (selecionado) {
                await api.put(`/produtos/${selecionado.id}`, payload);
            } else {
                await api.post('/produtos', { ...payload, sku: form.sku });
            }
            setMensagem('Salvo com sucesso.');
            carregar();
            if (selecionado) {
                calcularCapacidade(selecionado.id);
            }
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: 20 }}>Produtos</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={sincronizando} onClick={sincronizarDimensoesEmMassa}>
                        {sincronizando ? 'Sincronizando...' : 'Sincronizar dimensões (todos)'}
                    </button>
                    <button onClick={novoProduto}>+ Novo produto</button>
                </div>
            </div>

            {sincronizando && progressoSync && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>
                        Sincronizando: {progressoSync.processados} / {progressoSync.total ?? '...'}
                    </p>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                        <div
                            style={{
                                height: '100%',
                                background: 'var(--accent)',
                                width: progressoSync.total ? `${(progressoSync.processados / progressoSync.total) * 100}%` : '0%',
                                transition: 'width 0.3s',
                            }}
                        />
                    </div>
                </div>
            )}

            {resultadosSync && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>
                        Sincronização concluída: {resultadosSync.atualizados} atualizado(s), {resultadosSync.naoEncontrados} não
                        encontrado(s) no ERP, {resultadosSync.erros} erro(s). Total processado: {resultadosSync.total}.
                    </p>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
                <div>
                    <input
                        type="text"
                        placeholder="Buscar por código, descrição ou código de barras"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        style={{ width: '100%', marginBottom: 10 }}
                    />

                    {selecionados.size > 0 && (
                        <div
                            className="card"
                            style={{
                                padding: '8px 12px',
                                marginBottom: 10,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <span style={{ fontSize: 13 }}>{selecionados.size} selecionado(s)</span>
                            <button
                                style={{ color: 'var(--danger-text)', borderColor: 'var(--danger-text)', fontSize: 13 }}
                                disabled={excluindoVarios}
                                onClick={excluirSelecionados}
                            >
                                {excluindoVarios ? 'Excluindo...' : 'Excluir selecionados'}
                            </button>
                        </div>
                    )}

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card-bg, #fff)' }}>
                                        <th style={{ padding: 10, width: 32 }}>
                                            <input
                                                type="checkbox"
                                                checked={selecionados.size > 0 && selecionados.size === produtosFiltrados.length}
                                                onChange={alternarSelecaoTodos}
                                            />
                                        </th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>SKU</th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>Descrição</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Mín.</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Qtd/Pallet</th>
                                        <th style={{ textAlign: 'center', padding: 10 }}>Serial.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtosFiltrados.map((p) => (
                                        <tr
                                            key={p.id}
                                            style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: 'pointer',
                                                background: selecionado?.id === p.id ? 'var(--accent-bg)' : 'transparent',
                                            }}
                                        >
                                            <td style={{ padding: 10 }} onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selecionados.has(p.id)}
                                                    onChange={() => alternarSelecao(p.id)}
                                                />
                                            </td>
                                            <td style={{ padding: 10 }} onClick={() => selecionar(p)}>{p.sku}</td>
                                            <td style={{ padding: 10 }} onClick={() => selecionar(p)}>{p.descricao}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => selecionar(p)}>{p.estoque_minimo}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => selecionar(p)}>
                                                {p.quantidade_por_pallet ?? '—'}
                                            </td>
                                            <td style={{ padding: 10, textAlign: 'center' }} onClick={() => selecionar(p)}>
                                                {p.serializado ? '✓' : ''}
                                            </td>
                                        </tr>
                                    ))}
                                    {produtosFiltrados.length === 0 && (
                                        <tr>
                                            <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                                                Nenhum produto encontrado.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                        {selecionado ? `Editando ${selecionado.sku}` : 'Novo produto'}
                    </p>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>SKU</label>
                    <input
                        type="text"
                        value={form.sku}
                        disabled={!!selecionado}
                        onChange={(e) => setForm({ ...form, sku: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Descrição</label>
                    <input
                        type="text"
                        value={form.descricao}
                        onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Código de barras</label>
                    <input
                        type="text"
                        value={form.codigoBarras}
                        onChange={(e) => setForm({ ...form, codigoBarras: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque mínimo (flutuante)</label>
                    <input
                        type="number"
                        value={form.estoqueMinimo}
                        onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade por pallet</label>
                    <input
                        type="number"
                        value={form.quantidadePorPallet}
                        onChange={(e) => setForm({ ...form, quantidadePorPallet: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 14px' }}>
                        <input
                            type="checkbox"
                            checked={form.serializado}
                            onChange={(e) => setForm({ ...form, serializado: e.target.checked })}
                        />
                        Serializado (exige número de série por unidade no recebimento)
                    </label>

                    <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                                Dimensões e peso
                            </label>
                            {selecionado && (
                                <button
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    disabled={consultandoDimensoes}
                                    onClick={puxarDimensoesZenErp}
                                >
                                    {consultandoDimensoes ? 'Consultando...' : 'Puxar do ERP'}
                                </button>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Comprimento (cm)</label>
                                <input
                                    type="number"
                                    value={form.comprimentoCm}
                                    onChange={(e) => setForm({ ...form, comprimentoCm: e.target.value })}
                                    style={{ width: '100%', margin: '4px 0 0' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Largura (cm)</label>
                                <input
                                    type="number"
                                    value={form.larguraCm}
                                    onChange={(e) => setForm({ ...form, larguraCm: e.target.value })}
                                    style={{ width: '100%', margin: '4px 0 0' }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Altura (cm)</label>
                                <input
                                    type="number"
                                    value={form.alturaCm}
                                    onChange={(e) => setForm({ ...form, alturaCm: e.target.value })}
                                    style={{ width: '100%', margin: '4px 0 0' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Peso (kg)</label>
                                <input
                                    type="number"
                                    value={form.pesoKg}
                                    onChange={(e) => setForm({ ...form, pesoKg: e.target.value })}
                                    style={{ width: '100%', margin: '4px 0 0' }}
                                />
                            </div>
                        </div>
                    </div>

                    <button className="primary" style={{ width: '100%' }} disabled={salvando} onClick={salvar}>
                        {salvando ? 'Salvando...' : 'Salvar'}
                    </button>

                    {selecionado && (
                        <>
                            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Saldo estoque atual (ZenERP)
                                </label>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                                    <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                                        {saldoZenErp === null ? '—' : saldoZenErp}
                                    </p>
                                    <button
                                        style={{ fontSize: 12 }}
                                        disabled={consultandoSaldo}
                                        onClick={consultarSaldoZenErp}
                                    >
                                        {consultandoSaldo ? 'Consultando...' : 'Consultar'}
                                    </button>
                                </div>
                            </div>

                            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                                    Capacidade por pallet (calculado)
                                </label>

                                {calculandoCapacidade && (
                                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Calculando...</p>
                                )}

                                {erroCapacidade && (
                                    <p style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 6 }}>{erroCapacidade}</p>
                                )}

                                {capacidade && (
                                    <div style={{ marginTop: 8 }}>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                                            Pallet {capacidade.pallet.comprimentoCm}x{capacidade.pallet.larguraCm}cm, base +{' '}
                                            {capacidade.pallet.alturaCm}cm de altura própria
                                        </p>

                                        <div
                                            style={{
                                                display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10,
                                                background: 'var(--accent-bg)', padding: '8px 10px', borderRadius: 8,
                                            }}
                                        >
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                    Lastro manual (opcional)
                                                </label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    placeholder={`Calculado: ${capacidade.lastroCalculado}`}
                                                    value={form.lastroManualPallet}
                                                    onChange={(e) => setForm({ ...form, lastroManualPallet: e.target.value })}
                                                    style={{ width: '100%', margin: '4px 0 0' }}
                                                />
                                            </div>
                                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px', maxWidth: 170 }}>
                                                Use quando o encaixe físico real (ex.: caixas entrelaçadas) render mais
                                                unidades por camada do que o cálculo automático.
                                            </p>
                                        </div>

                                        {capacidade.lastroOrigem === 'manual' && (
                                            <p style={{ fontSize: 11, color: 'var(--accent-text)', margin: '0 0 8px' }}>
                                                Usando lastro manual ({capacidade.lastroManual}) no lugar do calculado (
                                                {capacidade.lastroCalculado}).
                                            </p>
                                        )}

                                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <th style={{ textAlign: 'left', padding: '4px 2px' }}>Andares</th>
                                                    <th style={{ textAlign: 'right', padding: '4px 2px' }}>Lastro</th>
                                                    <th style={{ textAlign: 'right', padding: '4px 2px' }}>Camadas</th>
                                                    <th style={{ textAlign: 'right', padding: '4px 2px' }}>Total</th>
                                                    <th style={{ textAlign: 'left', padding: '4px 2px' }}>Limita</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {capacidade.perfis.map((perfil, idx) => (
                                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '4px 2px' }}>{perfil.andares.join(', ')}</td>
                                                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{perfil.lastro}</td>
                                                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{perfil.camadas}</td>
                                                        <td style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>
                                                            {perfil.totalPorPallet}
                                                        </td>
                                                        <td style={{ padding: '4px 2px', fontSize: 11, color: 'var(--text-muted)' }}>
                                                            {perfil.limitantePor === 'altura' ? 'Altura' : 'Peso'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>

                                        <button
                                            style={{ fontSize: 11, padding: '4px 8px', marginTop: 8 }}
                                            disabled={salvando}
                                            onClick={salvar}
                                        >
                                            {salvando ? 'Salvando...' : 'Salvar lastro manual'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button
                                style={{
                                    width: '100%',
                                    marginTop: 16,
                                    color: 'var(--danger-text)',
                                    borderColor: 'var(--danger-text)',
                                }}
                                disabled={excluindo}
                                onClick={excluir}
                            >
                                {excluindo ? 'Excluindo...' : 'Excluir produto'}
                            </button>
                        </>
                    )}

                    {mensagem && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagem}</p>}
                </div>
            </div>
        </div>
    );
}