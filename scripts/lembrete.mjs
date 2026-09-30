// Robô do lembrete diário: envia "Não esqueça o Desafio do dia!" para todos os
// celulares que ativaram o lembrete no app. Roda de hora em hora pelo GitHub
// Actions (.github/workflows/lembrete.yml) e só envia uma vez por dia, a partir
// do horário escolhido pelo administrador na aba Ajustes.
//
// Precisa do segredo UNIFORCA_PUSH (JSON): { "vapidPublica", "vapidPrivada", "roboSenha" }.
import fs from "node:fs";
import webpush from "web-push";

const segredo = JSON.parse(process.env.UNIFORCA_PUSH || "{}");
const forcar = process.env.FORCAR === "true";
if (!segredo.vapidPrivada || !segredo.roboSenha) {
  console.error("Segredo UNIFORCA_PUSH ausente ou incompleto.");
  process.exit(1);
}

// Lê chave da API, projeto e valores iniciais direto do js/config.js do app.
const cfgJs = fs.readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const pegar = (re) => (cfgJs.match(re) || [])[1];
const API_KEY = pegar(/apiKey:\s*"([^"]+)"/);
const PROJETO = pegar(/projectId:\s*"([^"]+)"/);
const horaPadrao = pegar(/LEMBRETE_HORA\s*=\s*(\d+|null)/);
const inicioPadrao = pegar(/inicio:\s*"([^"]+)"/);
const fimPadrao = pegar(/fim:\s*"([^"]+)"/);
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents`;

async function req(url, { metodo = "GET", corpo, token } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  return { status: r.status, dados: txt ? JSON.parse(txt) : {} };
}
const valor = (f) => f && (f.stringValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : f.nullValue === null ? null : undefined));

// Agora no horário de Brasília.
const partes = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value])
);
const hoje = `${partes.year}-${partes.month}-${partes.day}`;
const horaAgora = Number(partes.hour);

// Entra como o robô.
const login = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
  metodo: "POST", corpo: { email: "robo@uniforca.app", password: segredo.roboSenha, returnSecureToken: true },
});
if (login.status !== 200) { console.error("Login do robô falhou:", login.dados.error?.message); process.exit(1); }
const token = login.dados.idToken;

// Ajustes do administrador (ou os valores iniciais).
const rally = (await req(`${DOCS}/config/rally`, { token })).dados.fields || {};
const hora = "lembreteHora" in rally ? valor(rally.lembreteHora) : horaPadrao === "null" ? null : Number(horaPadrao);
const inicio = valor(rally.inicio) || inicioPadrao;
const fim = valor(rally.fim) || fimPadrao;
const envio = (await req(`${DOCS}/config/envio`, { token })).dados.fields || {};
const ultimo = valor(envio.ultimaData);

console.log(`Agora: ${hoje} ${horaAgora}h (Brasília) · lembrete às ${hora ?? "desligado"} · Rally de ${inicio} a ${fim} · último envio: ${ultimo ?? "nunca"}`);
if (!forcar) {
  if (hora === null || hora === undefined) { console.log("Lembrete desligado."); process.exit(0); }
  if (hoje < inicio || hoje > fim) { console.log("Fora do período do Rally."); process.exit(0); }
  if (horaAgora < hora) { console.log("Ainda não é a hora."); process.exit(0); }
  if (ultimo === hoje) { console.log("Já enviado hoje."); process.exit(0); }
}

// Todos os celulares inscritos.
const inscricoes = [];
let pagina = "";
do {
  const r = await req(`${DOCS}/inscricoes?pageSize=300${pagina ? `&pageToken=${pagina}` : ""}`, { token });
  if (r.status !== 200) { console.error("Não consegui ler as inscrições:", r.dados.error?.message); process.exit(1); }
  inscricoes.push(...(r.dados.documents || []));
  pagina = r.dados.nextPageToken || "";
} while (pagina);

webpush.setVapidDetails("mailto:uniforca@uniforca.app", segredo.vapidPublica, segredo.vapidPrivada);
const mensagem = JSON.stringify({ title: "Uniforça 💪", body: "Não esqueça o Desafio do dia! Cada atitude conta." });
let enviados = 0, removidos = 0, falhas = 0;
for (const doc of inscricoes) {
  const f = doc.fields;
  const sub = { endpoint: valor(f.endpoint), keys: { p256dh: valor(f.p256dh), auth: valor(f.auth) } };
  try {
    await webpush.sendNotification(sub, mensagem, { TTL: 6 * 3600, urgency: "normal" });
    enviados++;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      // Celular desinstalou o app ou desativou: apaga a inscrição.
      await req(`https://firestore.googleapis.com/v1/${doc.name}`, { metodo: "DELETE", token });
      removidos++;
    } else {
      falhas++;
      console.error(`Falha para ${valor(f.nome)}: ${e.statusCode || ""} ${e.body || e.message}`);
    }
  }
}

await req(`${DOCS}/config/envio?updateMask.fieldPaths=ultimaData`, { metodo: "PATCH", token, corpo: { fields: { ultimaData: { stringValue: hoje } } } });
console.log(`Lembrete enviado para ${enviados} celular(es). Inscrições vencidas apagadas: ${removidos}. Falhas: ${falhas}.`);
