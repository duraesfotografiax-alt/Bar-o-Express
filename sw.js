// Guarda os arquivos do app no aparelho para abrir rápido.
// Ao mudar qualquer arquivo, aumente a versão abaixo.
const VERSAO = "uniforca-v1";
const ARQUIVOS = [
  "./", "index.html", "css/style.css", "js/app.js", "js/store.js", "js/config.js", "js/icons.js",
  "manifest.webmanifest", "assets/logo.png", "assets/icon-192.png", "assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (para sempre pegar a versão nova); cache se estiver sem internet.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
