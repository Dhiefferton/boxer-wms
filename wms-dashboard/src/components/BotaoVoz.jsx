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

// "701 116" / "701.116" -> "701116"; "sete zero um um um seis" -> "701116";
// texto normal ("tocha mig") fica como foi falado.
export function normalizarFala(texto) {
    const t = String(texto || '').trim().toLowerCase();
    const tokens = t.split(/[\s.,-]+/).filter(Boolean);
    if (tokens.length > 0 && tokens.every((x) => /^\d+$/.test(x) || DIGITOS[x])) {
        return tokens.map((x) => DIGITOS[x] || x).join('');
    }
    return t;
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
