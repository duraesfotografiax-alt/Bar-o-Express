// =====================================================================
//  CONFIGURAÇÃO DO APP — Projeto Uniforça
//  Desafios, datas, prêmios e horário do lembrete são só os valores iniciais:
//  o administrador muda tudo isso pelo app, na aba Ajustes.
// =====================================================================

// 1) FIREBASE (banco de dados online, plano gratuito)
//    Enquanto estiver vazio, o app roda em MODO DEMONSTRAÇÃO:
//    os dados ficam salvos só no aparelho que está usando.
//    Veja o README.md para o passo a passo de como preencher.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbgBRVfyb9TFAPXoNUK_xUglypGkp4N_4",
  authDomain: "uniforca-2c3eb.firebaseapp.com",
  projectId: "uniforca-2c3eb",
  appId: "1:847207099413:web:485c6319c531e8b09a721c",
};

// 2) ADMINISTRADORES — usuários que entram no painel de acompanhamento.
//    (Se usar o Firebase, repita os mesmos nomes no arquivo firestore.rules.)
export const ADMINS = ["lucas"];

// 3) PERÍODO DO RALLY — só contam pontos feitos entre estas datas (AAAA-MM-DD).
export const RALLY = {
  inicio: "2026-01-01",
  fim: "2026-12-31",
};

// 4) DESAFIOS — cada um pode ser marcado 1 vez por dia.
export const DESAFIOS = [
  { id: "meditacao-palavra", titulo: "Meditação da Palavra", pontos: 50, icone: "livro" },
  { id: "meditacao-bispo", titulo: "Meditação do Bispo", pontos: 50, icone: "play" },
  { id: "assistir-univer", titulo: "Assistir Univer", pontos: 50, icone: "tv" },
  { id: "livro-da-fe", titulo: "Livro da Fé", pontos: 50, icone: "livro" },
  { id: "trouxe-alma", titulo: "Trouxe alma em qualquer reunião", pontos: 200, icone: "pessoas" },
  { id: "limpou-igreja", titulo: "Limpou uma parte crítica da igreja", pontos: 100, icone: "vassoura" },
  { id: "fez-em-casa", titulo: "Fez alguma coisa em casa", pontos: 80, icone: "casa" },
  { id: "jejum", titulo: "Jejum", pontos: 150, icone: "prato" },
];

// Desafios que saíram da lista: registros antigos continuam valendo e aparecem com este nome.
export const DESAFIOS_ANTIGOS = [
  { id: "codigo-q", titulo: "Código Q", icone: "radio" },
];

// 5) PRÊMIOS
export const PREMIOS = {
  individuais: [
    { lugar: 1, premio: "Rodízio" },
  ],
  projeto: "", // deixe vazio para não mostrar
};

// 6) LEMBRETE DIÁRIO NO CELULAR — hora (horário de Brasília) em que todos recebem o aviso.
//    null = desligado.
export const LEMBRETE_HORA = 19;

// Chave pública do lembrete (Web Push). A chave privada fica só no segredo
// UNIFORCA_PUSH do GitHub, usado pelo robô em .github/workflows/lembrete.yml.
export const VAPID_PUBLICA = "BHIS3SUBkSOABEgj7GjvAsnJRaSbjNMrMx1NpBrAQscvmzyH-WF74u5o7aMpwu5nhIJaENll1Ew0yo2bGSPuGmk";
