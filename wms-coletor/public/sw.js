// Service worker do Boxer WMS - Coletor.
//
// Objetivo: (1) cumprir o requisito de instalação do PWA (Chrome/Android
// só oferece "Instalar app" com um SW que responde a fetch) e (2) dar
// um "app shell" em cache pra o app abrir rápido / não ficar em branco
// se o Wi-Fi do galpão falhar na hora de abrir.
//
// NÃO cacheia chamadas da API: o WMS depende de dados ao vivo (estoque,
// ordens, alocação no ZenERP) e servir resposta velha de API causaria
// bipagem errada. Por isso só mexe em GET do MESMO domínio do app - a
// API fica em outro domínio (VITE_API_URL) e nunca passa por aqui.
//
// Ao publicar uma versão nova, os arquivos de /assets/ mudam de nome
// (hash do Vite) e o index.html é sempre buscado na rede primeiro, então
// o app se atualiza sozinho. Só mude CACHE_VERSAO se mudar a própria
// lógica deste arquivo.

const CACHE_VERSAO = 'boxer-coletor-v1';

const APP_SHELL = [
    '/',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

self.addEventListener('install', (evento) => {
    evento.waitUntil(
        caches.open(CACHE_VERSAO)
            // allSettled: se um item falhar (ex.: '/' fora do ar na hora),
            // a instalação do SW não é abortada.
            .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil(
        caches.keys()
            .then((chaves) => Promise.all(
                chaves.filter((c) => c !== CACHE_VERSAO).map((c) => caches.delete(c))
            ))
            .then(() => self.clients.claim())
    );
});

async function guardar(request, resposta) {
    if (resposta && resposta.ok && resposta.type === 'basic') {
        const cache = await caches.open(CACHE_VERSAO);
        await cache.put(request, resposta.clone());
    }
    return resposta;
}

// Navegação (abrir/recarregar o app): rede primeiro, cache se offline.
async function navegacao(request) {
    try {
        const resposta = await fetch(request);
        // Guarda sempre sob a chave '/' (HashRouter: toda rota é o mesmo index.html).
        if (resposta.ok) {
            const cache = await caches.open(CACHE_VERSAO);
            await cache.put('/', resposta.clone());
        }
        return resposta;
    } catch (erro) {
        const emCache = await caches.match('/');
        if (emCache) return emCache;
        throw erro;
    }
}

// Arquivos com hash no nome (/assets/*): nunca mudam, cache primeiro.
async function cachePrimeiro(request) {
    const emCache = await caches.match(request);
    if (emCache) return emCache;
    return guardar(request, await fetch(request));
}

// Demais arquivos estáticos (ícones, manifest): serve o cache e atualiza em segundo plano.
async function cacheEAtualiza(request) {
    const emCache = await caches.match(request);
    const rede = fetch(request).then((r) => guardar(request, r)).catch(() => null);
    return emCache || (await rede) || Response.error();
}

self.addEventListener('fetch', (evento) => {
    const { request } = evento;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // API, Google Fonts etc.: segue direto pra rede

    if (request.mode === 'navigate') {
        evento.respondWith(navegacao(request));
        return;
    }
    if (url.pathname.startsWith('/assets/')) {
        evento.respondWith(cachePrimeiro(request));
        return;
    }
    if (url.pathname === '/manifest.json' || url.pathname.startsWith('/icons/')) {
        evento.respondWith(cacheEAtualiza(request));
    }
    // qualquer outra coisa: não intercepta
});
