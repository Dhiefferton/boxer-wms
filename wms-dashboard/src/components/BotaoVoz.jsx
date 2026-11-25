// ============================================================
// Botão de comando de voz (26/11/2026) - fala o SKU (ou parte da
// descrição) e o texto entra no campo de busca. Usa o reconhecimento
// de voz do próprio navegador (Chrome/Edge), em português. Navegador
// sem suporte: o botão não aparece.
// ============================================================
import { useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

const Reconhecimento = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const DIGITOS = {
    zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', 'três': '3', quatro: '4', cinco: '5',
    seis: '6', meia: '6', sete: '7', oito: '8', nove: '9',
};

// Tudo que for falado vira UMA coisa só, sem espaço (pedido do Dhiefferton,
// 26/11/2026): "200 50 26" -> "2005026", "200 e 50 e 26" -> "2005026",
// "sete zero um um um seis" -> "701116", "pe a zero um" -> "PEA01".
export function normalizarFala(texto) {
    const tokens = String(texto || '').trim().toLowerCase().split(/[\s.,;:/-]+/).filter(Boolean);
    return tokens
        .filter((x, i) => !(x === 'e' && i > 0 && i < tokens.length - 1)) // "200 e 50" -> "200 50"
        .map((x) => DIGITOS[x] || x)
        .join('')
        .toUpperCase();
}

export default function BotaoVoz({ aoOuvir, titulo = 'Falar o SKU' }) {
    const [ouvindo, setOuvindo] = useState(false);
    const [erro, setErro] = useState(null);
    const rec = useRef(null);
    if (!Reconhecimento) return null;

    function alternar() {
        if (ouvindo) { rec.current?.stop(); return; }
        setErro(null);
        const r = new Reconhecimento();
        r.lang = 'pt-BR';
        r.interimResults = false;
        r.maxAlternatives = 1;
        r.onresult = (e) => aoOuvir(normalizarFala(e.results[0][0].transcript));
        r.onerror = (e) => setErro(e.error === 'not-allowed' ? 'Libere o microfone no navegador' : e.error === 'no-speech' ? 'Não ouvi nada' : 'Falha no microfone');
        r.onend = () => setOuvindo(false);
        rec.current = r;
        setOuvindo(true);
        r.start();
    }

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={alternar} title={ouvindo ? 'Parar' : titulo} aria-label={titulo}
                className={ouvindo ? 'primary' : ''}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                {ouvindo ? <MicOff size={16} /> : <Mic size={16} />}
                {ouvindo ? 'Ouvindo...' : 'Falar'}
            </button>
            {erro && <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{erro}</span>}
        </span>
    );
}
