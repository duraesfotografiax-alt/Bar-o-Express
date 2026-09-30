// Guarda os arquivos do app no aparelho para abrir rápido.
// Ao mudar qualquer arquivo, aumente a versão abaixo.
const VERSAO = "uniforca-v6";
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
// "no-cache" faz o navegador conferir com o servidor em vez de usar a cópia
// guardada (o GitHub Pages manda guardar por 10 minutos).
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
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

// Lembrete do desafio do dia, enviado pelo robô (.github/workflows/lembrete.yml).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "Uniforça 💪", {
      body: d.body || "Não esqueça o Desafio do dia! Cada atitude conta.",
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png",
      tag: "desafio-do-dia",
      renotify: true,
    })
  );
});

// Tocar na notificação abre o app (ou traz para frente se já estiver aberto).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) if ("focus" in j) return j.focus();
      return self.clients.openWindow("./");
    })
  );
});
