// Ícones SVG (traço, herdam a cor do texto).
const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICONES = {
  livro: svg('<path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v17H4.5A2.5 2.5 0 0 0 2 22.5z"/><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v17h6.5a2.5 2.5 0 0 1 2.5 2.5z"/>'),
  play: svg('<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>'),
  tv: svg('<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 22h8M12 18v4M10 9.5l4 2-4 2z"/>'),
  pessoas: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>'),
  vassoura: svg('<path d="M20 3 11.5 11.5"/><path d="M9 11c-3 0-5 2-6 6l-1 4 4-1c4-1 6-3 6-6z"/><path d="m6.5 16.5 2-2"/>'),
  casa: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  radio: svg('<rect x="6" y="8" width="12" height="14" rx="2"/><path d="M9 8V2M9 12h6M9 15h6M9 18h2"/>'),
  prato: svg('<circle cx="12" cy="13" r="6"/><path d="M3 3v6a2 2 0 0 0 2 2M5 3v18M20 3c-1.5 1-2 3-2 5s1 3 2 3v10"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>', 'stroke-width="3"'),
  alvo: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  trofeu: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  relogio: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  presente: svg('<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/>'),
  sair: svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11"/>'),
  painel: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  lista: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  voltar: svg('<path d="m15 18-6-6 6-6"/>'),
  atualizar: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  coroa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
};
