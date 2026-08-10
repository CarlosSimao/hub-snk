/*
 * Service worker do HUB SNK.
 *
 * O shell (HTML, CSS, JS, ícones) é servido do cache para a janela abrir mesmo
 * sem rede. As chamadas de `/api` nunca são cacheadas: dado desatualizado de
 * cadastro é pior do que erro visível.
 */
const VERSAO_DO_CACHE = 'hub-snk-v3.0.0';

const ARQUIVOS_DO_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/leitorDeFavoritos.js',
  '/tipoDeBaseNoNome.js',
  '/manifest.webmanifest',
  '/img/icone-192.png',
  '/img/icone-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSAO_DO_CACHE).then((cache) => cache.addAll(ARQUIVOS_DO_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves.filter((chave) => chave !== VERSAO_DO_CACHE).map((chave) => caches.delete(chave)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') {
    return;
  }

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  evento.respondWith(responderComRedePrimeiro(requisicao));
});

/**
 * Rede primeiro para o shell não congelar numa versão antiga durante o
 * desenvolvimento; o cache entra apenas quando a rede falha.
 */
async function responderComRedePrimeiro(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    const cache = await caches.open(VERSAO_DO_CACHE);
    cache.put(requisicao, resposta.clone());
    return resposta;
  } catch (erro) {
    const emCache = await caches.match(requisicao);
    if (emCache) {
      return emCache;
    }
    throw erro;
  }
}
