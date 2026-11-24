// Badge "NF 123" que abre a nota de entrada direto no ZenERP (nova aba).
const ZEN_APP_URL = 'https://boxer.zenerp.app.br';

export default function LinkNfZen({ nota }) {
    const texto = `NF ${nota?.numero ?? ''}`.trim();
    if (!nota?.id) return <span className="badge accent">{texto}</span>;
    return (
        <a
            className="badge accent"
            href={`${ZEN_APP_URL}/fiscal/incomingInvoice.html?q=id==${nota.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir a nota no Zen"
            style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
            {texto} ↗
        </a>
    );
}
