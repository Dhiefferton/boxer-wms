const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function requisitar(caminho, opcoes = {}) {
    const resposta = await fetch(`${BASE_URL}${caminho}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opcoes,
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) {
        throw new Error(dados?.erro || `Erro ${resposta.status} ao chamar ${caminho}`);
    }

    return dados;
}

export const api = {
    get: (caminho) => requisitar(caminho),
    post: (caminho, body) => requisitar(caminho, { method: 'POST', body: JSON.stringify(body) }),
};
