const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Token da sessao (JWT) - guardado aqui em memoria, e espelhado no
// localStorage pelo AuthContext pra sobreviver a um F5. api.js nao
// depende do AuthContext (evita import circular) - so expoe essas
// duas funcoes pra ele controlar o token daqui.
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
        const erro = new Error(dados?.erro || `Erro ${resposta.status} ao chamar ${caminho}`);
        // Corpo completo da resposta de erro, pra quem chamou poder ler campos
        // extras além da mensagem (ex.: produtos.js devolve skuInativoId no
        // 409 de SKU excluído, pra oferecer reativação em vez de só travar).
        erro.dados = dados;
        throw erro;
    }

    return dados;
}

export const api = {
    get: (caminho) => requisitar(caminho),
    post: (caminho, body) => requisitar(caminho, { method: 'POST', body: JSON.stringify(body) }),
    put: (caminho, body) => requisitar(caminho, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (caminho, body) => requisitar(caminho, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (caminho) => requisitar(caminho, { method: 'DELETE' }),
};

// baixarArquivo: igual a api.post, mas pra rota que devolve um ARQUIVO
// (não JSON) - usada pela exportação de relatórios (Excel/CSV). Lê a
// resposta como blob, pega o nome do arquivo do header
// Content-Disposition (o back-end já manda certo) e dispara o
// download clicando num link <a> invisível - mesmo truque usado em
// qualquer download de navegador, não precisa de lib nenhuma.
export async function baixarArquivo(caminho, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const resposta = await fetch(`${BASE_URL}${caminho}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
    });

    if (resposta.status === 401) {
        window.dispatchEvent(new Event('wms:nao-autorizado'));
    }

    if (!resposta.ok) {
        const dados = await resposta.json().catch(() => null);
        throw new Error(dados?.erro || `Erro ${resposta.status} ao baixar arquivo`);
    }

    const disposicao = resposta.headers.get('Content-Disposition') || '';
    const nomeCasado = disposicao.match(/filename="?([^"]+)"?/);
    const nomeArquivo = nomeCasado?.[1] || 'arquivo';

    const blob = await resposta.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}
