import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Map, ClipboardList, AlertTriangle, Package, Boxes, MapPin, ChevronsLeft, ChevronsRight } from 'lucide-react';

const itens = [
    { to: '/', label: 'Mapa de ruas', fim: true, Icone: Map },
    { to: '/pedidos', label: 'Pedidos', Icone: ClipboardList },
    { to: '/divergencias', label: 'Divergências', Icone: AlertTriangle },
    { to: '/produtos', label: 'Produtos', Icone: Package },
    { to: '/areas-flutuante', label: 'Áreas do flutuante', Icone: Boxes },
    { to: '/cadastro-enderecos', label: 'Cadastro de endereços', Icone: MapPin },
];

export default function Sidebar() {
    const [recolhida, setRecolhida] = useState(
        () => localStorage.getItem('wms-sidebar-recolhida') === 'true'
    );

    function alternar() {
        const novo = !recolhida;
        setRecolhida(novo);
        localStorage.setItem('wms-sidebar-recolhida', String(novo));
    }

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
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#cfd3f0',
                        cursor: 'pointer',
                        padding: 6,
                        display: 'flex',
                    }}
                >
                    {recolhida ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
                </button>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {itens.map((item) => (
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
        </aside>
    );
}
