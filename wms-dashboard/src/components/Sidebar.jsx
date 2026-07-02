import { NavLink } from 'react-router-dom';

const itens = [
    { to: '/', label: 'Mapa de ruas', fim: true },
    { to: '/pedidos', label: 'Pedidos' },
    { to: '/divergencias', label: 'Divergências' },
    { to: '/produtos', label: 'Produtos' },
    { to: '/areas-flutuante', label: 'Áreas do flutuante' },
    { to: '/cadastro-enderecos', label: 'Cadastro de endereços' },
];

export default function Sidebar() {
    return (
        <aside
            style={{
                width: 220,
                background: 'var(--boxer-navy)',
                color: '#fff',
                minHeight: '100vh',
                padding: '1.5rem 1rem',
            }}
        >
            <h1 style={{ fontSize: 22, color: '#fff', marginBottom: '2rem' }}>WMS Boxer</h1>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {itens.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.fim}
                        style={({ isActive }) => ({
                            padding: '10px 12px',
                            borderRadius: 8,
                            color: isActive ? 'var(--boxer-navy)' : '#cfd3f0',
                            background: isActive ? 'var(--boxer-cyan)' : 'transparent',
                            textDecoration: 'none',
                            fontWeight: 500,
                            fontSize: 14,
                        })}
                    >
                        {item.label}
                    </NavLink>
                ))}
            </nav>
        </aside>
    );
}
