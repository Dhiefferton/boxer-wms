import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { api, definirToken, limparToken } from '../api.js';

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

    return (
        <AuthContext.Provider value={{ colaborador, carregando, entrar, sair, trocarSenha }}>
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
