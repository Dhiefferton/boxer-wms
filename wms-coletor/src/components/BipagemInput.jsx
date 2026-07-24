import { useEffect, useRef, useState } from 'react';

// O leitor a laser do coletor (Zebra/Honeywell) funciona em modo
// "keyboard wedge": ele digita o código lido dentro do campo que
// estiver focado, e manda um Enter no final. Um campo normal e
// visível funciona igual de bem pra isso - e ainda facilita testar
// manualmente pelo navegador, digitando ou colando o código à mão.
//
// Só que em alguns aparelhos (confirmado em campo), o teclado
// emulado do leitor manda as teclas pro <body> da página, não pro
// input visualmente focado - digitar na mão funciona (foco real
// por toque), mas o leitor não aparece em lugar nenhum. Por isso,
// além do campo normal, também escuta o teclado a nível de
// documento inteiro: se as teclas caírem fora do próprio input
// (em document.body), monta a leitura mesmo assim.
export default function BipagemInput({ label, onBipar }) {
    const [valor, setValor] = useState('');
    const inputRef = useRef(null);
    const bufferGlobalRef = useRef('');

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        function tratarTeclaGlobal(e) {
            // Se a tecla já caiu certinho no nosso input, o próprio
            // onKeyDown dele cuida disso - evita processar duas vezes.
            if (e.target === inputRef.current) return;
            // Ignora se o foco estiver em outro campo de verdade (ex:
            // outro input da tela) - só pega quando sobra pro body.
            if (e.target !== document.body) return;

            if (e.key === 'Enter') {
                const codigo = bufferGlobalRef.current.trim();
                if (codigo) {
                    onBipar(codigo);
                }
                bufferGlobalRef.current = '';
                return;
            }
            if (e.key.length === 1) {
                bufferGlobalRef.current += e.key;
            }
        }

        document.addEventListener('keydown', tratarTeclaGlobal);
        return () => document.removeEventListener('keydown', tratarTeclaGlobal);
    }, [onBipar]);

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