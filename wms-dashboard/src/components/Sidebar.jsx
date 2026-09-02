import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    Map, ClipboardList, AlertTriangle, Package, PackagePlus, History, Cpu, Boxes, Settings, FileText,
    ChevronsLeft, ChevronsRight, ChevronDown, Users, LogOut, Lock, Kanban,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import TrocarSenha from '../pages/TrocarSenha.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

const ROTULOS_CARGO = {
    admin: 'Admin',
    conferente: 'Conferente',
    picking: 'Picking',
    recebimento_reposicao: 'Recebimento / Repositor Picking',
};

const estiloBotaoIcone = {
    background: 'transparent',
    border: 'none',
    color: '#cfd3f0',
    cursor: 'pointer',
    padding: 6,
    minHeight: 'auto',
    display: 'flex',
};

// Estrutura do menu: itens soltos (tipo 'link') ou agrupados por
// assunto (tipo 'grupo', com uma lista de sub-itens que abre/fecha).
// "cargos" ausente = qualquer colaborador logado ve o item; 'admin'
// sempre ve tudo, mesma regra do backend (exigirCargo, em
// wms-api/auth.js). Um grupo inteiro some se nenhum sub-item sobrar
// depois do filtro por cargo (ex.: "Sistema" some pra quem não é
// admin, já que hoje só tem Colaboradores dentro).
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

export default function Sidebar() {
    const { colaborador, sair } = useAuth();
    const location = useLocation();
    const [recolhida, setRecolhida] = useState(
        () => localStorage.getItem('wms-sidebar-recolhida') === 'true'
    );
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    // O grupo que contém a rota atual já começa aberto - assim quem
    // entra direto numa tela (ex.: link salvo, F5) já vê onde está,
    // sem precisar clicar pra descobrir.
    const [gruposAbertos, setGruposAbertos] = useState(() => {
        const inicial = {};
        for (const item of MENU) {
            if (item.tipo === 'grupo') {
                inicial[item.id] = item.itens.some((sub) => sub.to === location.pathname);
            }
        }
        return inicial;
    });

    function alternar() {
        const novo = !recolhida;
        setRecolhida(novo);
        localStorage.setItem('wms-sidebar-recolhida', String(novo));
    }

    function alternarGrupo(id) {
        if (recolhida) {
            // Clicar num grupo com o menu recolhido não tem onde
            // mostrar os sub-itens - expande o menu inteiro e já
            // abre esse grupo, em vez de não fazer nada visível.
            setRecolhida(false);
            localStorage.setItem('wms-sidebar-recolhida', 'false');
            setGruposAbertos((atual) => ({ ...atual, [id]: true }));
            return;
        }
        setGruposAbertos((atual) => ({ ...atual, [id]: !atual[id] }));
    }

    function estiloLink(isActive) {
        return {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            borderRadius: 10,
            color: isActive ? 'var(--boxer-navy)' : '#cfd3f0',
            background: isActive ? 'var(--boxer-cyan)' : 'transparent',
            textDecoration: 'none',
            fontWeight: isActive ? 600 : 500,
            fontSize: 14,
        };
    }

    return (
        <aside
            style={{
                width: recolhida ? 64 : 240,
                background: 'var(--boxer-navy)',
                color: '#fff',
                minHeight: '100vh',
                padding: '1.25rem 0.75rem',
                transition: 'width 0.15s ease',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: recolhida ? 'center' : 'space-between',
                    gap: 8,
                    marginBottom: '1.5rem',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <img
                        src={logoBoxer}
                        alt="Boxer"
                        style={{ width: 34, height: 34, flexShrink: 0 }}
                    />
                    {!recolhida && (
                        <div style={{ minWidth: 0 }}>
                            <h1 style={{ fontSize: 16, margin: 0, lineHeight: 1.2, whiteSpace: 'nowrap', color: '#fff' }}>Boxer WMS</h1>
                            <p style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9aa0c9', margin: 0, whiteSpace: 'nowrap' }}>
                                Gestão de armazém
                            </p>
                        </div>
                    )}
                </div>
                {!recolhida && (
                    <button onClick={alternar} title="Recolher menu" style={estiloBotaoIcone}>
                        <ChevronsLeft size={18} />
                    </button>
                )}
            </div>

            {recolhida && (
                <button
                    onClick={alternar}
                    title="Expandir menu"
                    style={{ ...estiloBotaoIcone, alignSelf: 'center', marginBottom: 12 }}
                >
                    <ChevronsRight size={18} />
                </button>
            )}

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto' }}>
                {MENU.map((item) => {
                    if (item.tipo === 'link') {
                        if (!podeVer(item, colaborador.cargo)) return null;
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.fim}
                                title={recolhida ? item.label : undefined}
                                style={({ isActive }) => ({
                                    ...estiloLink(isActive),
                                    justifyContent: recolhida ? 'center' : 'flex-start',
                                })}
                            >
                                <item.Icone size={18} style={{ flexShrink: 0 }} />
                                {!recolhida && <span>{item.label}</span>}
                            </NavLink>
                        );
                    }

                    const subItensVisiveis = item.itens.filter((sub) => podeVer(sub, colaborador.cargo));
                    if (subItensVisiveis.length === 0) return null;

                    const aberto = !recolhida && !!gruposAbertos[item.id];

                    return (
                        <div key={item.id}>
                            <button
                                onClick={() => alternarGrupo(item.id)}
                                title={recolhida ? item.label : undefined}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: recolhida ? 'center' : 'space-between',
                                    width: '100%',
                                    padding: '9px 12px',
                                    borderRadius: 10,
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#fff',
                                    fontFamily: 'var(--font-sans)',
                                    fontWeight: 600,
                                    fontSize: 14,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                    <item.Icone size={18} style={{ flexShrink: 0 }} />
                                    {!recolhida && <span>{item.label}</span>}
                                </span>
                                {!recolhida && (
                                    <ChevronDown
                                        size={15}
                                        style={{
                                            flexShrink: 0,
                                            color: '#9aa0c9',
                                            transform: aberto ? 'none' : 'rotate(-90deg)',
                                            transition: 'transform 0.15s ease',
                                        }}
                                    />
                                )}
                            </button>

                            {aberto && (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2,
                                        marginTop: 2,
                                        marginLeft: 15,
                                        paddingLeft: 11,
                                        borderLeft: '1px solid rgba(255,255,255,0.15)',
                                    }}
                                >
                                    {subItensVisiveis.map((sub) => (
                                        <NavLink
                                            key={sub.to}
                                            to={sub.to}
                                            style={({ isActive }) => ({
                                                ...estiloLink(isActive),
                                                padding: '7px 10px',
                                                fontSize: 13,
                                            })}
                                        >
                                            <sub.Icone size={15} style={{ flexShrink: 0 }} />
                                            <span>{sub.label}</span>
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div
                style={{
                    borderTop: '1px solid rgba(255,255,255,0.15)',
                    paddingTop: 12,
                    display: 'flex',
                    flexDirection: recolhida ? 'column' : 'row',
                    alignItems: 'center',
                    justifyContent: recolhida ? 'center' : 'space-between',
                    gap: 8,
                }}
            >
                {!recolhida && (
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {colaborador.nome}
                        </div>
                        <div style={{ fontSize: 11, color: '#9aa0c9' }}>{ROTULOS_CARGO[colaborador.cargo] || colaborador.cargo}</div>
                    </div>
                )}
                <div style={{ display: 'flex', gap: 2 }}>
                    <button onClick={() => setTrocandoSenha(true)} title="Trocar senha" style={estiloBotaoIcone}>
                        <Lock size={16} />
                    </button>
                    <button onClick={sair} title="Sair" style={estiloBotaoIcone}>
                        <LogOut size={16} />
                    </button>
                </div>
            </div>

            {trocandoSenha && <TrocarSenha aoFechar={() => setTrocandoSenha(false)} />}
        </aside>
    );
}
