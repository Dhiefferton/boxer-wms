import { createContext, useContext, useEffect, useState } from 'react';

// Título da página atual, mostrado na barra do topo (Topbar) em vez
// de cada página ter seu próprio <h1>/<h2> solto no corpo - assim ele
// fica sempre visível, mesmo com a página rolada pra baixo (a topbar
// é sticky). Cada página só chama useDefinirTitulo('Nome da página')
// perto do topo do componente; a Topbar lê o valor daqui.
const TituloPaginaContext = createContext(null);

export function TituloPaginaProvider({ children }) {
    const [titulo, setTitulo] = useState('');
    return (
        <TituloPaginaContext.Provider value={{ titulo, setTitulo }}>
            {children}
        </TituloPaginaContext.Provider>
    );
}

function useTituloPagina() {
    const contexto = useContext(TituloPaginaContext);
    if (!contexto) {
        throw new Error('useTituloPagina precisa ser usado dentro de um <TituloPaginaProvider>');
    }
    return contexto;
}

// Hook que cada página chama com o texto que ela quer ver na topbar
// (o mesmo texto que antes era o <h1>/<h2> da página).
export function useDefinirTitulo(texto) {
    const { setTitulo } = useTituloPagina();
    useEffect(() => {
        setTitulo(texto);
    }, [texto, setTitulo]);
}

// Usado só pela própria Topbar, pra ler o título atual.
export function useTituloPaginaAtual() {
    return useTituloPagina().titulo;
}
