import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    Map, ClipboardList, AlertTriangle, Package, PackagePlus, History, Cpu, Boxes, Settings, FileText,
    ChevronDown, Users, LogOut, Lock, Kanban, Sun, Moon, Menu, Building2, Mail,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTema } from '../theme/TemaContext.jsx';
import { useTituloPaginaAtual } from '../contexts/TituloPaginaContext.jsx';
import TrocarSenha from '../pages/TrocarSenha.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

const ROTULOS_CARGO = {
    admin: 'Admin',
    conferente: 'Conferente',
    picking: 'Picking',
    recebimento_reposicao: 'Recebimento / Repositor Picking',
};

// Mesma estrutura de menu que a sidebar antiga usava: itens soltos
// (tipo 'link') ou agrupados por assunto (tipo 'grupo'). "cargos"
// ausente = qualquer colaborador logado vê o item; 'admin' sempre vê
// tudo, mesma regra do backend (exigirCargo, em wms-api/auth.js).
const MENU = [
    { tipo: 'link', to: '/', label: 'Mapa de ruas', fim: true, Icone: Map },
    {
        tipo: 'grupo', id: 'estoque', label: 'Estoque', Icone: Boxes,
        itens: [
            { to: '/produtos', label: 'Produtos', Icone: Package },
            { to: '/unidades', label: 'Unidades', Icone: Cpu },
            { to: '/entradas-manuais', label: 'Entradas manuais', Icone: PackagePlus, cargos: ['recebimento_reposicao'] },
            { to: '/reposicao-kanban', label: 'Reposição (Kanban)', Icone: Kanban, cargos: ['recebimento_reposicao'] },
        ],
    },
    {
        tipo: 'grupo', id: 'operacao', label: 'Operação', Icone: ClipboardList,
        itens: [
            { to: '/pedidos', label: 'Pedidos', Icone: FileText },
            { to: '/divergencias', label: 'Divergências', Icone: AlertTriangle },
        ],
    },
    { tipo: 'link', to: '/historico', label: 'Histórico', Icone: History },
    {
        tipo: 'grupo', id: 'sistema', label: 'Sistema', Icone: Settings,
        itens: [
            { to: '/colaboradores', label: 'Colaboradores', Icone: Users, cargos: ['admin'] },
        ],
    },
];

function podeVer(item, cargo) {
    return !item.cargos || cargo === 'admin' || item.cargos.includes(cargo);
}

function estiloLink(isActive) {
    return {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        borderRadius: 8,
        color: isActive ? '#fff' : 'var(--text-secondary)',
        background: isActive ? 'rgba(79,110,247,0.16)' : 'transparent',
        borderLeft: isActive ? '3px solid var(--boxer-vibrante)' : '3px solid transparent',
        textDecoration: 'none',
        fontWeight: isActive ? 600 : 500,
        fontSize: 13.5,
    };
}

export default function Topbar() {
    const { colaborador, sair } = useAuth();
    const { tema, alternarTema } = useTema();
    const location = useLocation();
    const tituloPagina = useTituloPaginaAtual();

    const [menuAberto, setMenuAberto] = useState(false);
    const [usuarioAberto, setUsuarioAberto] = useState(false);
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    const [gruposAbertos, setGruposAbertos] = useState(() => {
        const inicial = {};
        for (const item of MENU) {
            if (item.tipo === 'grupo') {
                inicial[item.id] = item.itens.some((sub) => sub.to === location.pathname);
            }
        }
        return inicial;
    });

    const menuRef = useRef(null);
    const usuarioRef = useRef(null);

    // Fecha os dois painéis ao clicar fora deles (o botão que abre
    // cada um fica fora do ref de propósito, senão o próprio clique
    // de abrir já fecharia na sequência).
    useEffect(() => {
        function aoClicarFora(evento) {
            if (menuAberto && menuRef.current && !menuRef.current.contains(evento.target) && !evento.target.closest('[data-botao-menu]')) {
                setMenuAberto(false);
            }
            if (usuarioAberto && usuarioRef.current && !usuarioRef.current.contains(evento.target) && !evento.target.closest('[data-botao-usuario]')) {
                setUsuarioAberto(false);
            }
        }
        document.addEventListener('mousedown', aoClicarFora);
        return () => document.removeEventListener('mousedown', aoClicarFora);
    }, [menuAberto, usuarioAberto]);

    // Troca de rota (clicou num link do menu) sempre fecha o painel -
    // ele é um overlay agora, não uma sidebar fixa.
    useEffect(() => {
        setMenuAberto(false);
    }, [location.pathname]);

    function alternarGrupo(id) {
        setGruposAbertos((atual) => ({ ...atual, [id]: !atual[id] }));
    }

    const iniciais = (colaborador.nome || '?').trim().charAt(0).toUpperCase();

    return (
        <>
            <header
                style={{
                    height: 56,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '0 16px',
                    background: 'var(--sidebar-bg)',
                    borderBottom: '1px solid var(--border)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 30,
                }}
            >
                <button
                    data-botao-menu
                    onClick={() => { setMenuAberto((v) => !v); setUsuarioAberto(false); }}
                    title="Menu"
                    style={{
                        width: 38, height: 38, borderRadius: 8, border: 'none', background: 'transparent',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                    }}
                >
                    <Menu size={20} />
                </button>

                {/* Marca reduzida (estrela + "Boxer WMS") - encolhida
                    pra abrir espaço pro título da página atual, que
                    antes cada página mostrava solto no corpo (agora
                    fica aqui, sempre visível mesmo com a tela rolada). */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <img src={logoBoxer} alt="Boxer" style={{ width: 18, height: 18 }} />
                    <span style={{ fontWeight: 800, fontSize: 12, color: '#fff', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                        Boxer WMS
                    </span>
                </div>

                {tituloPagina && (
                    <>
                        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
                        <h1
                            style={{
                                flex: 1, minWidth: 0, margin: 0, fontSize: 15, fontWeight: 700, color: '#fff',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                        >
                            {tituloPagina}
                        </h1>
                    </>
                )}
                {!tituloPagina && <div style={{ flex: 1 }} />}

                <button
                    data-botao-usuario
                    onClick={() => { setUsuarioAberto((v) => !v); setMenuAberto(false); }}
                    title={colaborador.nome}
                    style={{
                        width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--boxer-vibrante)',
                        color: '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                    }}
                >
                    {iniciais}
                </button>
            </header>

            {(menuAberto || usuarioAberto) && (
                <div
                    style={{ position: 'fixed', inset: 0, top: 56, background: 'rgba(0,0,0,0.45)', zIndex: 25 }}
                    onClick={() => { setMenuAberto(false); setUsuarioAberto(false); }}
                />
            )}

            {/* Menu de navegação (recolhido por padrão, abre por cima do conteúdo) */}
            <div
                ref={menuRef}
                style={{
                    position: 'fixed',
                    top: 56,
                    left: 0,
                    bottom: 0,
                    width: 240,
                    background: 'var(--sidebar-bg)',
                    borderRight: '1px solid var(--border)',
                    zIndex: 26,
                    padding: '10px 8px',
                    overflowY: 'auto',
                    transform: menuAberto ? 'translateX(0)' : 'translateX(-100%)',
                    transition: 'transform 0.18s ease',
                }}
            >
                {MENU.map((item) => {
                    if (item.tipo === 'link') {
                        if (!podeVer(item, colaborador.cargo)) return null;
                        return (
                            <NavLink key={item.to} to={item.to} end={item.fim} className="wms-menu-link" style={({ isActive }) => estiloLink(isActive)}>
                                <item.Icone size={17} style={{ flexShrink: 0 }} />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    }

                    const subItensVisiveis = item.itens.filter((sub) => podeVer(sub, colaborador.cargo));
                    if (subItensVisiveis.length === 0) return null;
                    const aberto = !!gruposAbertos[item.id];

                    return (
                        <div key={item.id}>
                            <button
                                onClick={() => alternarGrupo(item.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                                    padding: '9px 14px', borderRadius: 8, border: 'none', background: 'transparent',
                                    color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 600,
                                    fontSize: 13.5, textAlign: 'left', cursor: 'pointer',
                                }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <item.Icone size={17} style={{ flexShrink: 0 }} />
                                    <span>{item.label}</span>
                                </span>
                                <ChevronDown
                                    size={14}
                                    style={{ color: 'var(--text-muted)', transform: aberto ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}
                                />
                            </button>
                            {aberto && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 14, paddingLeft: 10, borderLeft: '1px solid var(--border)' }}>
                                    {subItensVisiveis.map((sub) => (
                                        <NavLink key={sub.to} to={sub.to} className="wms-menu-link" style={({ isActive }) => ({ ...estiloLink(isActive), padding: '7px 12px', fontSize: 13 })}>
                                            <sub.Icone size={15} style={{ flexShrink: 0 }} />
                                            <span>{sub.label}</span>
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Menu do usuário (canto direito) */}
            <div
                ref={usuarioRef}
                style={{
                    position: 'fixed',
                    top: 62,
                    right: 14,
                    width: 260,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
                    zIndex: 31,
                    padding: 6,
                    opacity: usuarioAberto ? 1 : 0,
                    transform: usuarioAberto ? 'translateY(0)' : 'translateY(-6px)',
                    pointerEvents: usuarioAberto ? 'auto' : 'none',
                    transition: 'opacity 0.15s ease, transform 0.15s ease',
                }}
            >
                <div style={{ padding: '8px 10px 10px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{colaborador.nome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ROTULOS_CARGO[colaborador.cargo] || colaborador.cargo}</div>
                </div>

                <div style={estiloItemMenu(true)}>
                    <Mail size={15} style={estiloIconeMenu} /> {colaborador.email}
                </div>
                <div style={estiloItemMenu(true)}>
                    <Building2 size={15} style={estiloIconeMenu} /> Organização: Boxer Soldas
                </div>

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

                <button
                    onClick={() => { alternarTema(); setUsuarioAberto(false); }}
                    className="wms-user-btn"
                    style={estiloBotaoMenu}
                >
                    {tema === 'claro' ? <Moon size={15} style={estiloIconeMenu} /> : <Sun size={15} style={estiloIconeMenu} />}
                    {tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
                </button>
                <button
                    onClick={() => { setTrocandoSenha(true); setUsuarioAberto(false); }}
                    className="wms-user-btn"
                    style={estiloBotaoMenu}
                >
                    <Lock size={15} style={estiloIconeMenu} /> Alterar senha
                </button>

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

                <button onClick={sair} className="wms-user-btn" style={{ ...estiloBotaoMenu, color: 'var(--danger-text)' }}>
                    <LogOut size={15} style={{ ...estiloIconeMenu, color: 'var(--danger-text)' }} /> Sair
                </button>
            </div>

            {trocandoSenha && <TrocarSenha aoFechar={() => setTrocandoSenha(false)} />}
        </>
    );
}

const estiloIconeMenu = { color: 'var(--text-muted)', flexShrink: 0 };

function estiloItemMenu(mudo) {
    return {
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', fontSize: 13,
        color: mudo ? 'var(--text-secondary)' : 'var(--text-primary)', borderRadius: 7,
    };
}

const estiloBotaoMenu = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px',
    fontSize: 13, color: 'var(--text-primary)', background: 'transparent', border: 'none',
    borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
};
