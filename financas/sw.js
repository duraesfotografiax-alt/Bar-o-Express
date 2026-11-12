// Guarda os arquivos do app no aparelho para abrir rápido e funcionar sem internet.
// Ao mudar qualquer arquivo, aumente a versão abaixo.
const VERSAO = "nossas-contas-v1";
const ARQUIVOS = [
  "./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/calc.js", "js/config.js",
  "manifest.webmanifest", "assets/icon-192.png", "assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("nossas-contas-") && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (sempre pega a versão nova); usa a cópia guardada se estiver sem internet.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/__/")) return;
  e.respondWith(
    fetch(e.request.url, { cache: "no-cache" })
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
