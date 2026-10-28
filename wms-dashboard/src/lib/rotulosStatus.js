// Rótulos de status personalizados (Fase 8A). A API devolve SÓ o que foi
// personalizado no painel (Controle de acesso > Rótulos de status). Sem
// personalização (ou se a chamada falhar), as telas usam os textos de sempre.
import { useEffect, useState } from 'react';
import { api } from '../api';

let cache = null; // { grupo: { valor: { rotulo?, rotuloFiltro?, cor?, ordem?, visivel? } } }
let promessa = null;

function carregar() {
    if (cache) return Promise.resolve(cache);
    if (!promessa) {
        promessa = api
            .get('/rotulos-status')
            .then((r) => {
                cache = r && typeof r.rotulos === 'object' && r.rotulos ? r.rotulos : {};
                return cache;
            })
            .catch(() => {
                promessa = null; // falhou: tenta de novo na próxima tela; por ora, textos de sempre
                return {};
            });
    }
    return promessa;
}

// Chame depois de salvar no painel pra a próxima tela já pegar o valor novo.
export function recarregarRotulos() {
    cache = null;
    promessa = null;
}

export function useRotulosStatus() {
    const [rotulos, setRotulos] = useState(cache || {});
    useEffect(() => {
        let vivo = true;
        carregar().then((r) => {
            if (vivo) setRotulos(r);
        });
        return () => {
            vivo = false;
        };
    }, []);
    return rotulos;
}

// Texto do status: o personalizado, senão o texto de sempre.
export function rotuloDe(rotulos, grupo, valor, textoAtual) {
    return rotulos?.[grupo]?.[valor]?.rotulo ?? textoAtual;
}

// Lista de [valor, texto] na ordem do código; aplica ordem/visibilidade só se houver personalização.
//   opcoes.filtro = true  -> usa rotuloFiltro (se houver) e respeita "visível" (esconder só dos filtros)
export function opcoesDeStatus(rotulos, grupo, padrao, opcoes = {}) {
    const g = rotulos?.[grupo] || {};
    let lista = padrao.map(([valor, texto], i) => ({
        valor,
        texto: (opcoes.filtro ? g[valor]?.rotuloFiltro : undefined) ?? g[valor]?.rotulo ?? texto,
        ordem: g[valor]?.ordem ?? i + 1,
        visivel: g[valor]?.visivel !== false,
        i,
    }));
    if (opcoes.filtro) lista = lista.filter((x) => x.visivel);
    if (Object.values(g).some((x) => x && x.ordem !== undefined)) {
        lista.sort((a, b) => a.ordem - b.ordem || a.i - b.i);
    }
    return lista.map((x) => [x.valor, x.texto]);
}
