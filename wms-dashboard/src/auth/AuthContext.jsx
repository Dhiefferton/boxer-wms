import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { api, definirToken, limparToken } from '../api.js';
import { PADRAO_PERMISSOES } from './permissoesPadrao.js';

const AuthContext = createContext(null);

const CHAVE_TOKEN = 'wms_token';
const CHAVE_COLABORADOR = 'wms_colaborador';

export function AuthProvider({ children }) {
    const [colaborador, setColaborador] = useState(null);
    const [carregando, setCarregando] = useState(true);

    const sair = useCallback(() => {
        limparToken();
        localStorage.removeItem(CHAVE_TOKEN);
        localStorage.removeItem(CHAVE_COLABORADOR);
        setColaborador(null);
    }, []);

    // Ao carregar o app: se tem token salvo, confere na hora se ele
    // ainda e valido (e se o colaborador ainda esta ativo) direto no
    // backend, em vez de confiar cegamente no que ficou salvo aqui.
    useEffect(() => {
        const tokenSalvo = localStorage.getItem(CHAVE_TOKEN);
        if (!tokenSalvo) {
            setCarregando(false);
            return;
        }
        definirToken(tokenSalvo);
        api.get('/auth/me')
            .then((dados) => {
                setColaborador(dados);
                localStorage.setItem(CHAVE_COLABORADOR, JSON.stringify(dados));
            })
            .catch(() => sair())
            .finally(() => setCarregando(false));
    }, [sair]);

    // Qualquer chamada da api que voltar 401 (sessao expirada, ou
    // token de um colaborador que acabou de ser desativado) dispara
    // esse evento global - aqui a gente escuta e desloga na hora.
    useEffect(() => {
        window.addEventListener('wms:nao-autorizado', sair);
        return () => window.removeEventListener('wms:nao-autorizado', sair);
    }, [sair]);

    async function entrar(email, senha) {
        const resposta = await api.post('/auth/login', { email, senha });
        definirToken(resposta.token);
        localStorage.setItem(CHAVE_TOKEN, resposta.token);
        localStorage.setItem(CHAVE_COLABORADOR, JSON.stringify(resposta.colaborador));
        setColaborador(resposta.colaborador);
    }

    // Troca a propria senha (exige a atual). Ao terminar, tira a
    // marca de "precisa trocar senha" do colaborador em sessao -
    // libera o resto do sistema pra quem estava no primeiro acesso.
    async function trocarSenha(senhaAtual, novaSenha) {
        await api.patch('/auth/senha', { senhaAtual, novaSenha });
        setColaborador((atual) => {
            const atualizado = { ...atual, precisaTrocarSenha: false };
            localStorage.setItem(CHAVE_COLABORADOR, JSON.stringify(atualizado));
            return atualizado;
        });
    }

    // Mantém permissões e perfil em dia: o administrador pode mudar o acesso de
    // alguém a qualquer hora, e a pessoa não precisa sair e entrar de novo
    // (a API já aplica na hora - isto só atualiza menus e botões).
    useEffect(() => {
        if (!colaborador?.id) return undefined;
        const atualizar = () => {
            api.get('/auth/me')
                .then((dados) => {
                    setColaborador((atual) => {
                        if (!atual) return atual;
                        const novo = { ...atual, ...dados };
                        if (JSON.stringify(novo) === JSON.stringify(atual)) return atual;
                        localStorage.setItem(CHAVE_COLABORADOR, JSON.stringify(novo));
                        return novo;
                    });
                })
                .catch(() => {});
        };
        const intervalo = setInterval(atualizar, 120000);
        window.addEventListener('focus', atualizar);
        return () => {
            clearInterval(intervalo);
            window.removeEventListener('focus', atualizar);
        };
    }, [colaborador?.id]);

    // pode('produtos.editar'): a pessoa tem essa permissão? A API manda a lista
    // pronta em colaborador.permissoes ('*' = administrador). Se a API for
    // antiga e não mandar, vale o padrão do cargo (PADRAO_PERMISSOES, gerado a
    // partir do catálogo da API). A garantia de verdade é sempre a API.
    const pode = useCallback(
        (chave) => {
            if (!colaborador) return false;
            const lista = colaborador.permissoes;
            if (Array.isArray(lista)) return lista.includes('*') || lista.includes(chave);
            return colaborador.cargo === 'admin' || (PADRAO_PERMISSOES[chave] || []).includes(colaborador.cargo);
        },
        [colaborador]
    );

    // Engenharia de Produtos: cargo só de visualização, em qualquer
    // tela do dashboard - a garantia de verdade é no back-end
    // (bloquearEscritaSomenteLeitura, em wms-api/auth.js), isso aqui
    // é só pra cada página esconder/desabilitar os próprios botões
    // de criar/editar/excluir sem precisar checar o cargo na mão.
    // Legado (cargo fixo) - as telas agora usam pode('...') com a permissão da ação.
    const somenteLeitura = colaborador?.cargo === 'engenharia_produtos';

    return (
        <AuthContext.Provider value={{ colaborador, carregando, entrar, sair, trocarSenha, somenteLeitura, pode }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const contexto = useContext(AuthContext);
    if (!contexto) {
        throw new Error('useAuth precisa ser usado dentro de um <AuthProvider>');
    }
    return contexto;
}
