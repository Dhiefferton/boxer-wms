const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Token da sessao (JWT) - guardado aqui em memoria, e espelhado no
// localStorage pelo AuthContext pra sobreviver a um F5/reload.
// api.js nao depende do AuthContext (evita import circular) - so
// expoe essas duas funcoes pra ele controlar o token daqui.
let token = null;

export function definirToken(novoToken) {
    token = novoToken;
}

export function limparToken() {
    token = null;
}

async function requisitar(caminho, opcoes = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const resposta = await fetch(`${BASE_URL}${caminho}`, {
        ...opcoes,
        headers,
    });

    // Sessao expirada/invalida: avisa o resto do app (AuthContext
    // escuta esse evento e faz logout) - exceto na propria tentativa
    // de login, onde 401 so significa "e-mail ou senha errados".
    if (resposta.status === 401 && caminho !== '/auth/login') {
        window.dispatchEvent(new Event('wms:nao-autorizado'));
    }

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) {
        throw new Error(dados?.erro || `Erro ${resposta.status} ao chamar ${caminho}`);
    }

    return dados;
}

export const api = {
    get: (caminho) => requisitar(caminho),
    post: (caminho, body) => requisitar(caminho, { method: 'POST', body: JSON.stringify(body) }),
    patch: (caminho, body) => requisitar(caminho, { method: 'PATCH', body: JSON.stringify(body) }),
};
