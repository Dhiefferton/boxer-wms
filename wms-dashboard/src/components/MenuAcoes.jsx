import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

// Botão "⋮" que abre um menuzinho com as ações daquela linha (mover,
// histórico, remover, ativar/desativar etc.) - mesma ideia da coluna
// de ações do mockup "Opção 3" (ícone fixo + resto agrupado aqui).
// itens: [{ label, onClick, Icone, perigo }] - entradas "falsy" são
// ignoradas (útil pra esconder uma ação condicionalmente).
//
// O menu é renderizado num portal (direto no <body>), posicionado a
// partir do retângulo do próprio botão - assim ele nunca fica cortado
// pelo "overflow: hidden"/scroll das tabelas que usam essa lista (o
// que aconteceria se ele fosse um filho normal, position: absolute,
// dentro de uma célula da tabela).
export default function MenuAcoes({ itens, titulo = 'Mais ações' }) {
    const [aberto, setAberto] = useState(false);
    const [posicao, setPosicao] = useState(null);
    const botaoRef = useRef(null);
    const menuRef = useRef(null);

    function abrir() {
        const rect = botaoRef.current.getBoundingClientRect();
        setPosicao({ top: rect.bottom + 4, left: rect.right });
        setAberto(true);
    }

    useEffect(() => {
        if (!aberto) return;
        function aoClicarFora(evento) {
            if (
                !botaoRef.current?.contains(evento.target) &&
                !menuRef.current?.contains(evento.target)
            ) {
                setAberto(false);
            }
        }
        function aoFechar() {
            setAberto(false);
        }
        document.addEventListener('mousedown', aoClicarFora);
        // Rolar a página/tabela ou redimensionar a janela invalida a
        // posição calculada - mais simples fechar do que recalcular.
        window.addEventListener('scroll', aoFechar, true);
        window.addEventListener('resize', aoFechar);
        return () => {
            document.removeEventListener('mousedown', aoClicarFora);
            window.removeEventListener('scroll', aoFechar, true);
            window.removeEventListener('resize', aoFechar);
        };
    }, [aberto]);

    const visiveis = itens.filter(Boolean);
    if (visiveis.length === 0) return null;

    return (
        <>
            <button
                ref={botaoRef}
                type="button"
                className="wms-toolbar-btn"
                title={titulo}
                onClick={(e) => {
                    e.stopPropagation();
                    if (aberto) setAberto(false);
                    else abrir();
                }}
                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)' }}
            >
                <MoreVertical size={15} />
            </button>
            {aberto && posicao && createPortal(
                <div
                    ref={menuRef}
                    className="wms-acoes-menu-lista"
                    style={{ position: 'fixed', top: posicao.top, left: posicao.left, transform: 'translateX(-100%)', zIndex: 1000 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {visiveis.map((item, idx) => (
                        <button
                            key={idx}
                            type="button"
                            className={`wms-acoes-menu-item${item.perigo ? ' perigo' : ''}`}
                            onClick={() => { setAberto(false); item.onClick?.(); }}
                        >
                            {item.Icone && <item.Icone size={14} />}
                            {item.label}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}
