import { useNavigate } from 'react-router-dom';

// Tela de impressão da folha da ordem de separação (A4) - fica entre
// Recebimento e Separação no menu. Construção incremental por
// etapas (o usuário vai mandando o detalhe de cada uma):
// 1. Aba/rota nova - feito.
// 2. Impressão em folha A4.
// 3. Troca de transportadora (dentro do pedido, no ZenERP).
// 4. Reconhecer quando precisa 2 vias - mostra "2x" no card do pedido.
// 5. Depois de impressa, a ordem arquiva no final da tela (fácil
//    acesso pra reimprimir se precisar).
// 6. Caixa de seleção por pedido + selecionar tudo, pra imprimir
//    vários de uma vez.
export default function ImprimirOrdemSeparacao() {
    const navigate = useNavigate();

    return (
        <div className="tela">
            <button onClick={() => navigate('/')}>← Voltar</button>
            <h2 style={{ fontSize: 18 }}>Imprimir Ordem de Separação</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Em construção.</p>
        </div>
    );
}
