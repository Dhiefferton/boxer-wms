// Pill colorida usada pra destacar SKU/número de série nas tabelas
// (Unidades, Produtos) - mesma referência visual que o usuário mandou
// (chips sólidos coloridos, texto branco em negrito, mono). A cor é
// sempre a mesma pro mesmo texto (hash simples sobre a string), então
// o mesmo SKU/série fica com a cor igual em qualquer tela ou recarga.
const PALETA = ['#4f6ef7', '#25bbee', '#e0568c', '#f2a93c', '#8b5cf6', '#14b8a6'];

function corParaTexto(texto) {
    const str = String(texto ?? '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return PALETA[hash % PALETA.length];
}

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
                color: '#fff',
                background: corParaTexto(children),
                whiteSpace: 'nowrap',
                lineHeight: 1.5,
                ...style,
            }}
        >
            {children}
        </span>
    );
}
