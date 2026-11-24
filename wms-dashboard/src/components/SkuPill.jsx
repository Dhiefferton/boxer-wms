// Pill usada pra destacar SKU/número de série nas tabelas (Unidades,
// Produtos, Produtos excluídos). 24/11/2026: deixou de ser colorida
// (pedido do Dhiefferton: "sem cor, em todo o WMS") - agora é neutra,
// só com borda, na cor do texto do tema (claro/escuro).
export default function SkuPill({ children, style }) {
    if (children === undefined || children === null || children === '') return null;
    return (
        <span
            style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: 999,
                fontFamily: "'SF Mono', ui-monospace, 'Courier New', monospace",
                fontSize: 12,
                fontWeight: 800,
                color: 'var(--text-primary)',
                background: 'transparent',
                border: '1px solid var(--border)',
                whiteSpace: 'nowrap',
                lineHeight: 1.5,
                ...style,
            }}
        >
            {children}
        </span>
    );
}
