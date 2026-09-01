import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    Map, ClipboardList, AlertTriangle, Package, Boxes, MapPin, PackagePlus, History, Cpu,
    ChevronsLeft, ChevronsRight, Users, LogOut, Lock, Kanban,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import TrocarSenha from '../pages/TrocarSenha.jsx';

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

// "cargos" ausente = qualquer colaborador logado ve o item.
// 'admin' sempre ve tudo, mesmo sem estar na lista - mesma regra do
// backend (exigirCargo, em wms-api/auth.js).
const itens = [
    { to: '/', label: 'Mapa de ruas', fim: true, Icone: Map },
    { to: '/pedidos', label: 'Pedidos', Icone: ClipboardList },
    { to: '/divergencias', label: 'Divergências', Icone: AlertTriangle },
    { to: '/produtos', label: 'Produtos', Icone: Package },
    { to: '/areas-flutuante', label: 'Áreas do flutuante', Icone: Boxes },
    { to: '/cadastro-enderecos', label: 'Cadastro de endereços', Icone: MapPin },
    { to: '/entradas-manuais', label: 'Entradas manuais', Icone: PackagePlus, cargos: ['recebimento_reposicao'] },
    { to: '/reposicao-kanban', label: 'Reposição (Kanban)', Icone: Kanban, cargos: ['recebimento_reposicao'] },
    { to: '/unidades', label: 'Unidades', Icone: Cpu },
    { to: '/historico', label: 'Histórico', Icone: History },
    { to: '/colaboradores', label: 'Colaboradores', Icone: Users, cargos: ['admin'] },
];

export default function Sidebar() {
    const { colaborador, sair } = useAuth();
    const [recolhida, setRecolhida] = useState(
        () => localStorage.getItem('wms-sidebar-recolhida') === 'true'
    );
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    function alternar() {
        const novo = !recolhida;
        setRecolhida(novo);
        localStorage.setItem('wms-sidebar-recolhida', String(novo));
    }

    const itensVisiveis = itens.filter(
        (item) => !item.cargos || colaborador.cargo === 'admin' || item.cargos.includes(colaborador.cargo)
    );

    return (
        <aside
            style={{
                width: recolhida ? 64 : 220,
                background: 'var(--boxer-navy)',
                color: '#fff',
                minHeight: '100vh',
                padding: '1.5rem 0.75rem',
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
                    marginBottom: '2rem',
                }}
            >
                {!recolhida && <h1 style={{ fontSize: 22, color: '#fff', margin: 0 }}>WMS Boxer</h1>}
                <button
                    onClick={alternar}
                    title={recolhida ? 'Expandir menu' : 'Recolher menu'}
                    style={estiloBotaoIcone}
                >
                    {recolhida ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
                </button>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                {itensVisiveis.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.fim}
                        title={recolhida ? item.label : undefined}
                        style={({ isActive }) => ({
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            justifyContent: recolhida ? 'center' : 'flex-start',
                            padding: recolhida ? '10px' : '10px 12px',
                            borderRadius: 8,
                            color: isActive ? 'var(--boxer-navy)' : '#cfd3f0',
                            background: isActive ? 'var(--boxer-cyan)' : 'transparent',
                            textDecoration: 'none',
                            fontWeight: 500,
                            fontSize: 14,
                        })}
                    >
                        <item.Icone size={18} style={{ flexShrink: 0 }} />
                        {!recolhida && <span>{item.label}</span>}
                    </NavLink>
                ))}
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
