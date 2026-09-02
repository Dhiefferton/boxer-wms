import { createContext, useContext, useEffect, useState } from 'react';

const TemaContext = createContext(null);

const CHAVE_STORAGE = 'wms-tema';

// Tema claro/escuro do app inteiro (menos a sidebar e o login, que
// já são fixos em azul-marinho por decisão anterior). A troca só
// seta um atributo data-theme no <html> - o CSS (global.css) já
// redefine as variáveis --bg-page, --bg-card, --border, --text-* e
// afins pra esse atributo, então nenhuma tela precisa saber que o
// tema existe.
export function TemaProvider({ children }) {
    const [tema, setTema] = useState(() => {
        try {
            return localStorage.getItem(CHAVE_STORAGE) || 'claro';
        } catch {
            return 'claro';
        }
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', tema);
        try {
            localStorage.setItem(CHAVE_STORAGE, tema);
        } catch {
            // localStorage indisponível (modo privado etc.) - a troca
            // ainda funciona nessa sessão, só não persiste pra próxima.
        }
    }, [tema]);

    function alternarTema() {
        setTema((atual) => (atual === 'claro' ? 'escuro' : 'claro'));
    }

    return <TemaContext.Provider value={{ tema, alternarTema }}>{children}</TemaContext.Provider>;
}

export function useTema() {
    return useContext(TemaContext);
}
