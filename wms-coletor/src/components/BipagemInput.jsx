import { useEffect, useRef, useState } from 'react';

// O leitor a laser do coletor (Zebra/Honeywell) funciona em modo
// "keyboard wedge": ele digita o código lido dentro do campo que
// estiver focado, e manda um Enter no final. Um campo normal e
// visível funciona igual de bem pra isso - e ainda facilita testar
// manualmente pelo navegador, digitando ou colando o código à mão.
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
        <div className="zona-bipagem" style={{ flexDirection: 'column', gap: 8 }}>
            <span>{label}</span>
            <input
                ref={inputRef}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={tratarTecla}
                placeholder="Bipe ou digite o código e pressione Enter"
                style={{ width: '100%', textAlign: 'center' }}
                autoFocus
            />
        </div>
    );
}