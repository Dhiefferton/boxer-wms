import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { montarMenu, podeVer } from './Topbar.jsx';

// ============================================================
// Busca global (19/11/2026, pedido do Dhiefferton: "um campo de busca global onde eu consiga
// buscar qualquer coisa" - e, ao detalhar, "tudo que tem na tela Controle de acesso").
// Abre com Ctrl+K (ou o botão "Buscar"). Procura, ao mesmo tempo:
//   - telas do sistema (o mesmo menu da sidebar, já respeitando permissão e menus editados);
//   - tudo que existe no Controle de acesso: abas, perfis, colaboradores, permissões, funções,
//     configurações, rótulos de status e setores (só aparece pra quem tem "dash.acessos").
// Só LEITURA: usa as mesmas rotas GET que as abas do Controle de acesso já usam, uma vez por
// abertura (guarda 2 minutos na memória). Clicar leva pra tela/aba certa; colaborador abre a
// pessoa. Não grava nada em lugar nenhum.
// ============================================================

const ABAS_ACESSO = [
    { aba: 'modo', label: 'Modo e banco', detalhe: 'Preparar banco, modo legado/sombra/ativo, divergências' },
    { aba: 'perfis', label: 'Perfis', detalhe: 'Perfis de acesso e suas permissões' },
    { aba: 'colaboradores', label: 'Colaboradores', detalhe: 'Perfil e exceções de cada pessoa' },
    { aba: 'menus', label: 'Menus', detalhe: 'Rótulo, ordem e visibilidade dos menus' },
    { aba: 'flags', label: 'Funções', detalhe: 'Liga/desliga funções do sistema' },
    { aba: 'configuracoes', label: 'Configurações', detalhe: 'Valores configuráveis (reservas, endereços do Zen, prazos...)' },
    { aba: 'rotulos', label: 'Rótulos de status', detalhe: 'Textos dos status exibidos nas telas' },
    { aba: 'prazos', label: 'Prazos e setores', detalhe: 'Permissões temporárias e setores' },
    { aba: 'auditoria', label: 'Auditoria', detalhe: 'Quem mudou o quê no controle de acesso' },
];

const ORDEM_TIPOS = ['Tela', 'Controle de acesso', 'Colaborador', 'Perfil', 'Função', 'Configuração', 'Rótulo de status', 'Setor', 'Permissão'];
const LIMITE_POR_TIPO = 6;
const VALIDADE_CACHE_MS = 2 * 60 * 1000;

let cacheAcesso = null; // { quando, itens }

function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

function preparar(item) {
    const busca = [item.titulo, item.detalhe, item.extra, item.tipo].filter(Boolean).join(' ');
    return { ...item, _t: normalizar(item.titulo), _h: normalizar(busca) };
}

function primeiroTexto(...valores) {
    for (const v of valores) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

async function carregarItensAcesso() {
    const pegar = (caminho) => api.get(caminho).catch(() => null);
    const [perfis, colaboradores, catalogo, configuracoes, flags, rotulos, setores] = await Promise.all([
        pegar('/acessos/perfis'),
        pegar('/acessos/colaboradores'),
        pegar('/acessos/catalogo'),
        pegar('/acessos/configuracoes'),
        pegar('/acessos/flags'),
        pegar('/acessos/rotulos-status'),
        pegar('/acessos/setores'),
    ]);

    const itens = [];
    for (const p of Array.isArray(perfis) ? perfis : []) {
        itens.push({
            tipo: 'Perfil',
            titulo: primeiroTexto(p.nome, p.chave),
            detalhe: primeiroTexto(p.descricao) || `${p.colaboradores ?? 0} colaborador(es)`,
            extra: p.chave,
            destino: '/acessos?aba=perfis',
        });
    }
    for (const c of Array.isArray(colaboradores) ? colaboradores : []) {
        itens.push({
            tipo: 'Colaborador',
            titulo: primeiroTexto(c.nome),
            detalhe: [c.email, c.perfil && `perfil ${c.perfil}`, c.setor_nome].filter(Boolean).join(' · '),
            extra: `${c.cargo || ''} ${c.email || ''}`,
            destino: `/acessos?colaborador=${encodeURIComponent(c.id)}`,
        });
    }
    for (const p of Array.isArray(catalogo) ? catalogo : []) {
        itens.push({
            tipo: 'Permissão',
            titulo: primeiroTexto(p.rotulo, p.chave),
            detalhe: [p.grupo, p.descricao].filter(Boolean).join(' · '),
            extra: `${p.chave} ${(p.rotas || []).join(' ')}`,
            destino: '/acessos?aba=perfis',
        });
    }
    for (const c of configuracoes?.configuracoes || []) {
        itens.push({
            tipo: 'Configuração',
            titulo: primeiroTexto(c.nome, c.rotulo, c.chave),
            detalhe: primeiroTexto(c.descricao, c.grupo),
            extra: `${c.chave} ${c.grupo || ''}`,
            destino: '/acessos?aba=configuracoes',
        });
    }
    for (const f of flags?.flags || []) {
        itens.push({
            tipo: 'Função',
            titulo: primeiroTexto(f.nome, f.rotulo, f.titulo, f.chave),
            detalhe: primeiroTexto(f.descricao, f.grupo),
            extra: f.chave,
            destino: '/acessos?aba=flags',
        });
    }
    for (const g of rotulos?.grupos || []) {
        const nomeGrupo = primeiroTexto(g.nome, g.rotulo, g.titulo, g.chave);
        for (const it of g.itens || []) {
            itens.push({
                tipo: 'Rótulo de status',
                titulo: primeiroTexto(it.rotulo, it.nome, it.label, it.valor),
                detalhe: `${nomeGrupo} · ${it.valor ?? ''}`,
                extra: `${g.chave || ''} ${it.valor ?? ''}`,
                destino: '/acessos?aba=rotulos',
            });
        }
    }
    for (const s of setores?.setores || []) {
        itens.push({
            tipo: 'Setor',
            titulo: primeiroTexto(s.nome),
            detalhe: primeiroTexto(s.descricao) || `${(s.membros || []).length} pessoa(s)`,
            extra: (s.membros || []).map((m) => m.nome).join(' '),
            destino: '/acessos?aba=prazos',
        });
    }
    return itens.filter((i) => i.titulo).map(preparar);
}

export default function BuscaGlobal({ aberta, aoFechar }) {
    const { colaborador, pode } = useAuth();
    const navigate = useNavigate();
    const [consulta, setConsulta] = useState('');
    const [ativo, setAtivo] = useState(0);
    const [itensAcesso, setItensAcesso] = useState(cacheAcesso?.itens || []);
    const [carregando, setCarregando] = useState(false);
    const inputRef = useRef(null);
    const listaRef = useRef(null);
    const podeAcesso = pode('dash.acessos');
    const cfgMenu = colaborador?.menu?.dashboard;

    const telas = useMemo(() => {
        const itens = [];
        for (const item of montarMenu(cfgMenu)) {
            if (item.tipo === 'link') {
                if (podeVer(item, pode)) itens.push(preparar({ tipo: 'Tela', titulo: item.label, detalhe: 'Abrir tela', destino: item.to }));
                continue;
            }
            for (const sub of item.itens) {
                if (podeVer(sub, pode)) itens.push(preparar({ tipo: 'Tela', titulo: sub.label, detalhe: item.label, destino: sub.to }));
            }
        }
        if (podeAcesso) {
            for (const a of ABAS_ACESSO) {
                itens.push(preparar({ tipo: 'Controle de acesso', titulo: `Controle de acesso › ${a.label}`, detalhe: a.detalhe, destino: `/acessos?aba=${a.aba}` }));
            }
        }
        return itens;
    }, [cfgMenu, pode, podeAcesso]);

    // Ao abrir: limpa, foca o campo e (só quem pode) carrega os itens do Controle de acesso.
    useEffect(() => {
        if (!aberta) return undefined;
        setConsulta('');
        setAtivo(0);
        const t = setTimeout(() => inputRef.current?.focus(), 0);
        let cancelado = false;
        if (podeAcesso) {
            if (cacheAcesso && Date.now() - cacheAcesso.quando < VALIDADE_CACHE_MS) {
                setItensAcesso(cacheAcesso.itens);
            } else {
                setCarregando(true);
                carregarItensAcesso()
                    .then((itens) => {
                        cacheAcesso = { quando: Date.now(), itens };
                        if (!cancelado) setItensAcesso(itens);
                    })
                    .finally(() => !cancelado && setCarregando(false));
            }
        }
        return () => {
            cancelado = true;
            clearTimeout(t);
        };
    }, [aberta, podeAcesso]);

    const resultados = useMemo(() => {
        const termos = normalizar(consulta).split(/\s+/).filter(Boolean);
        const todos = [...telas, ...itensAcesso];
        if (termos.length === 0) return todos.filter((i) => i.tipo === 'Tela' || i.tipo === 'Controle de acesso').slice(0, 12);

        const achados = [];
        for (const item of todos) {
            if (!termos.every((t) => item._h.includes(t))) continue;
            const pontos = item._t.startsWith(termos[0]) ? 0 : termos.every((t) => item._t.includes(t)) ? 1 : 2;
            achados.push({ item, pontos });
        }
        achados.sort((a, b) => {
            const porTipo = ORDEM_TIPOS.indexOf(a.item.tipo) - ORDEM_TIPOS.indexOf(b.item.tipo);
            if (porTipo !== 0) return porTipo;
            if (a.pontos !== b.pontos) return a.pontos - b.pontos;
            return a.item.titulo.localeCompare(b.item.titulo, 'pt-BR');
        });
        const contagem = new Map();
        const saida = [];
        for (const { item } of achados) {
            const n = contagem.get(item.tipo) || 0;
            if (n >= LIMITE_POR_TIPO) continue;
            contagem.set(item.tipo, n + 1);
            saida.push(item);
        }
        return saida;
    }, [consulta, telas, itensAcesso]);

    useEffect(() => setAtivo(0), [consulta]);
    useEffect(() => {
        listaRef.current?.querySelector('[data-ativo="1"]')?.scrollIntoView({ block: 'nearest' });
    }, [ativo, resultados]);

    function abrir(item) {
        if (!item) return;
        aoFechar();
        navigate(item.destino);
    }

    function aoTeclar(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            aoFechar();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((v) => Math.min(v + 1, Math.max(resultados.length - 1, 0)));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((v) => Math.max(v - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            abrir(resultados[ativo]);
        }
    }

    if (!aberta) return null;

    let tipoAnterior = null;
    return createPortal(
        <div
            onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}
            style={{
                position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,8,59,0.45)',
                display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 12px 0',
            }}
        >
            <div
                role="dialog"
                aria-label="Busca global"
                style={{
                    width: 'min(640px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                    <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                        ref={inputRef}
                        value={consulta}
                        onChange={(e) => setConsulta(e.target.value)}
                        onKeyDown={aoTeclar}
                        placeholder={podeAcesso ? 'Buscar telas, perfis, colaboradores, configurações, permissões...' : 'Buscar telas...'}
                        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--text-primary)', minWidth: 0 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>Esc</span>
                </div>

                <div ref={listaRef} style={{ maxHeight: '60vh', overflowY: 'auto', padding: '6px 0' }}>
                    {resultados.length === 0 && (
                        <p style={{ margin: 0, padding: '18px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                            {carregando ? 'Carregando itens do Controle de acesso...' : `Nada encontrado para "${consulta}".`}
                        </p>
                    )}
                    {resultados.map((item, i) => {
                        const cabecalho = item.tipo !== tipoAnterior;
                        tipoAnterior = item.tipo;
                        return (
                            <div key={`${item.tipo}-${item.destino}-${item.titulo}-${i}`}>
                                {cabecalho && (
                                    <p style={{ margin: 0, padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                        {item.tipo}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    data-ativo={i === ativo ? '1' : '0'}
                                    onMouseEnter={() => setAtivo(i)}
                                    onClick={() => abrir(item)}
                                    style={{
                                        display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 0,
                                        padding: '8px 16px', cursor: 'pointer',
                                        background: i === ativo ? 'rgba(79,110,247,0.16)' : 'transparent', color: 'var(--text-primary)',
                                    }}
                                >
                                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{item.titulo}</span>
                                    {item.detalhe && (
                                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {item.detalhe}
                                        </span>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                    {resultados.length > 0 && carregando && (
                        <p style={{ margin: 0, padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando mais itens do Controle de acesso...</p>
                    )}
                </div>

                <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                    ↑↓ navegar · Enter abrir · Esc fechar · Ctrl+K abre de qualquer tela
                </div>
            </div>
        </div>,
        document.body
    );
}
