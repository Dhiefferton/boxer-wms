import { useEffect, useRef, useState } from 'react';

// O leitor a laser do coletor (Zebra/Honeywell) funciona em modo
// "keyboard wedge": ele digita o código lido dentro do campo que
// estiver focado, e manda um Enter no final. Este componente só
// precisa manter um input sempre focado e reagir ao Enter -
// não tem câmera nem lógica de decodificação envolvida.
export default function BipagemInput({ label, onBipar }) {
    const [valor, setValor] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    function tratarTecla(e) {
        if (e.key === 'Enter' && valor.trim()) {
            onBipar(valor.trim());
            setValor('');
        }
    }

    return (
        <div className="zona-bipagem" onClick={() => inputRef.current?.focus()}>
            <span>{label}</span>
            <input
                ref={inputRef}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={tratarTecla}
                onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                autoFocus
            />
        </div>
    );
}
