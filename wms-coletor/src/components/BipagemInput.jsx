import { useRef, useState, useEffect } from 'react';

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

// CORREÇÃO 16/09/2026: descoberto (pedido 43136, SKU 1015015 alocado
// 82x na reserva do Zen tendo pedido só 81) que um mesmo scan físico
// as vezes chega como DOIS "Enter" - seja o leitor mandando duplicado,
// seja o próprio campo perdendo o foco no meio da leitura e o
// listener global pegando de novo. Sem proteção, isso virava DUAS
// chamadas de onBipar (ex: bipar-serial) pro mesmo código, e cada uma
// aloca de verdade no ZenERP - mesmo o backend tendo sido corrigido
// pra travar a corrida de quantidade (ver separacao-erp.js), bipar a
// MESMA peça duas vezes por engano continuava possível sempre que
// ainda sobrava vaga no item. A guarda abaixo ignora um código igual
// ao último disparado há pouco tempo, fechando o problema na origem,
// pra qualquer tela que use esse componente (Separação, Transferência
// de Depósito, Conferência, Picking, Pulmão, Inventário, Reimpressão).
const JANELA_ANTI_DUPLICADA_MS = 1500;

export default function BipagemInput({ label, onBipar }) {
    const [valor, setValor] = useState('');
    const inputRef = useRef(null);
    const bufferGlobalRef = useRef('');
    const ultimaLeituraRef = useRef({ codigo: null, em: 0 });

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    function dispararLeitura(codigoBruto) {
        const codigo = (codigoBruto || '').trim();
        if (!codigo) return;
        const agora = Date.now();
        const ultima = ultimaLeituraRef.current;
        if (ultima.codigo === codigo && agora - ultima.em < JANELA_ANTI_DUPLICADA_MS) {
            return; // mesmo codigo, chegou de novo rapido demais - ignora
        }
        ultimaLeituraRef.current = { codigo, em: agora };
        onBipar(codigo);
    }

    useEffect(() => {
        function tratarTeclaGlobal(e) {
            // Se a tecla já caiu certinho no nosso input, o próprio
            // onKeyDown dele cuida disso - evita processar duas vezes.
            if (e.target === inputRef.current) return;
            // Ignora se o foco estiver em outro campo de verdade (ex:
            // outro input da tela) - só pega quando sobra pro body.
            if (e.target !== document.body) return;

            if (e.key === 'Enter') {
                const codigo = bufferGlobalRef.current;
                bufferGlobalRef.current = '';
                dispararLeitura(codigo);
                return;
            }
            if (e.key.length === 1) {
                bufferGlobalRef.current += e.key;
            }
        }

        document.addEventListener('keydown', tratarTeclaGlobal);
        return () => document.removeEventListener('keydown', tratarTeclaGlobal);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onBipar]);

    function tratarTecla(e) {
        if (e.key === 'Enter' && valor.trim()) {
            const codigo = valor;
            // Limpa o campo ANTES de disparar - se um segundo "Enter"
            // do mesmo scan chegar antes do React re-renderizar (dois
            // Enters na mesma vez, valor ainda nao atualizado), a
            // guarda de cima (mesmo codigo, janela de tempo) barra do
            // mesmo jeito, mas isso evita depender só dela.
            setValor('');
            dispararLeitura(codigo);
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
