// Cálculos do mês. Todos os valores estão em CENTAVOS (números inteiros).

const pad = (n) => String(n).padStart(2, "0");

export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const mesAtual = () => hojeISO().slice(0, 7);
const indice = (mes) => { const [a, m] = mes.split("-").map(Number); return a * 12 + (m - 1); };
export const somarMes = (mes, n) => { const t = indice(mes) + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
export const difMes = (de, ate) => indice(ate) - indice(de);

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const nomeMes = (mes, curto = false) => {
  const [a, m] = mes.split("-").map(Number);
  return curto ? `${MESES[m - 1].slice(0, 3)}/${String(a).slice(2)}` : `${MESES[m - 1]} ${a}`;
};

// Em qual fatura (mês do vencimento) cai uma compra feita no cartão nesta data.
export function mesDaFatura(dataISO, cartao) {
  const [a, m, d] = dataISO.split("-").map(Number);
  let mes = `${a}-${pad(m)}`;
  if (d >= Number(cartao.fechamento)) mes = somarMes(mes, 1); // passou do fechamento: próxima fatura
  if (Number(cartao.vencimento) <= Number(cartao.fechamento)) mes = somarMes(mes, 1); // vence no mês seguinte ao fechamento
  return mes;
}

// Divide um valor em parcelas sem perder centavos (as primeiras ficam com o resto).
export const valorParcela = (total, n, i) => {
  const base = Math.floor(total / n);
  return base + (i < total - base * n ? 1 : 0);
};

const vigente = (inicio, fim, mes) => (!inicio || inicio <= mes) && (!fim || fim >= mes);

// Tudo o que precisa ser pago no mês: contas fixas, faturas e parcelas de dívidas.
export function obrigacoesDoMes(itens, mes) {
  const lista = [];
  for (const c of itens) {
    if (c.tipo === "conta" && vigente(c.inicio, c.fim, mes)) {
      lista.push({ refId: c.id, tipo: "conta", descricao: c.descricao, valor: c.valor, dia: c.dia, categoria: c.categoria, item: c });
    }
    if (c.tipo === "divida") {
      const k = difMes(c.mesInicio, mes);
      if (k >= 0 && k < c.parcelas) {
        lista.push({ refId: c.id, tipo: "divida", descricao: c.descricao, valor: c.parcela, dia: c.dia, n: k + 1, de: c.parcelas, item: c });
      }
    }
    if (c.tipo === "cartao") {
      const compras = [];
      let total = 0;
      for (const p of itens) {
        if (p.tipo !== "compra" || p.cartaoId !== c.id) continue;
        const k = difMes(p.mesInicio, mes);
        if (k < 0 || k >= p.parcelas) continue;
        const v = valorParcela(p.valor, p.parcelas, k);
        total += v;
        compras.push({ compra: p, n: k + 1, valor: v });
      }
      if (total > 0) lista.push({ refId: c.id, tipo: "cartao", descricao: `Fatura ${c.nome}`, valor: total, dia: c.vencimento, compras, item: c });
    }
  }
  return lista.sort((a, b) => Number(a.dia || 0) - Number(b.dia || 0));
}

export function resumoMes({ casa, itens, pagamentos }, mes) {
  const membros = casa.membros || [];
  const pagos = new Map(pagamentos.filter((p) => p.mes === mes).map((p) => [p.refId, p]));
  const soma = (l, f = (x) => x.valor) => l.reduce((t, x) => t + (Number(f(x)) || 0), 0);

  // Entradas: rendas que repetem todo mês (salário) + entradas avulsas do mês.
  const rendas = itens
    .filter((i) => i.tipo === "renda" && vigente(i.inicio, i.fim, mes))
    .map((r) => {
      const baixa = pagos.get(r.id);
      return { ...r, recebido: !!baixa, baixa, valorMes: baixa ? baixa.valor : r.valor };
    });
  const avulsas = itens.filter((i) => i.tipo === "entrada" && i.mes === mes).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const entradaPrevista = soma(rendas, (r) => r.valorMes) + soma(avulsas);
  const entradaRecebida = soma(rendas.filter((r) => r.recebido), (r) => r.valorMes) + soma(avulsas);

  const obrigacoes = obrigacoesDoMes(itens, mes).map((o) => {
    const p = pagos.get(o.refId);
    return { ...o, pago: !!p, pagamento: p, valorMes: p ? p.valor : o.valor };
  });
  const totalObrig = soma(obrigacoes, (o) => o.valorMes);
  const pagoObrig = soma(obrigacoes.filter((o) => o.pago), (o) => o.valorMes);

  const gastos = itens.filter((i) => i.tipo === "gasto" && i.mes === mes).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const totalGastos = soma(gastos);

  const movReserva = itens.filter((i) => i.tipo === "reserva");
  const saldoReserva = soma(movReserva.filter((m) => m.mes <= mes));
  const guardadoNoMes = soma(movReserva.filter((m) => m.mes === mes));

  const saiu = pagoObrig + totalGastos;
  const faltaPagar = totalObrig - pagoObrig;
  const sobra = entradaPrevista - totalObrig - totalGastos - guardadoNoMes;
  const aporte = Number(casa.aporteReserva) || 0;
  const precisaGanhar = totalObrig + totalGastos + Math.max(aporte, guardadoNoMes);

  // Quem pagou o quê, e como fica a divisão justa.
  const pessoas = membros.map((uid) => {
    const entrou = soma(rendas.filter((r) => r.pessoa === uid), (r) => r.valorMes) + soma(avulsas.filter((a) => a.pessoa === uid));
    const pagou =
      soma(obrigacoes.filter((o) => o.pago && o.pagamento.pessoa === uid), (o) => o.valorMes) +
      soma(gastos.filter((g) => g.pessoa === uid));
    return { uid, nome: casa.nomes?.[uid] || "Sem nome", entrou, pagou };
  });
  const totalPago = soma(pessoas, (p) => p.pagou);
  const totalEntrou = soma(pessoas, (p) => p.entrou);
  const proporcional = casa.divisao === "proporcional" && totalEntrou > 0;
  for (const p of pessoas) {
    p.parte = proporcional ? Math.round((totalPago * p.entrou) / totalEntrou) : Math.round(totalPago / (pessoas.length || 1));
    p.saldo = p.pagou - p.parte; // positivo: pagou a mais
  }
  let acerto = null;
  if (pessoas.length === 2) {
    const [a, b] = pessoas;
    if (Math.abs(a.saldo) >= 100) acerto = a.saldo > 0 ? { de: b, para: a, valor: a.saldo } : { de: a, para: b, valor: -a.saldo };
  }

  const categorias = {};
  for (const g of gastos) categorias[g.categoria || "Outros"] = (categorias[g.categoria || "Outros"] || 0) + g.valor;

  return {
    mes, rendas, avulsas, entradaPrevista, entradaRecebida,
    obrigacoes, totalObrig, pagoObrig, faltaPagar,
    gastos, totalGastos, categorias,
    saldoReserva, guardadoNoMes, metaReserva: Number(casa.metaReserva) || 0, aporte,
    saiu, sobra, precisaGanhar, pessoas, acerto, totalPago, proporcional,
  };
}

// Quanto já está comprometido nos próximos meses (contas fixas, faturas e dívidas).
export function projecao(itens, mes, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const m = somarMes(mes, i);
    const ob = obrigacoesDoMes(itens, m);
    const por = (t) => ob.filter((o) => o.tipo === t).reduce((s, o) => s + o.valor, 0);
    return { mes: m, conta: por("conta"), cartao: por("cartao"), divida: por("divida"), total: ob.reduce((s, o) => s + o.valor, 0) };
  });
}

// Quanto do limite do cartão está usado: tudo o que ainda vai cair a partir deste mês.
export function limiteUsado(itens, cartaoId, mes) {
  let total = 0;
  for (const p of itens) {
    if (p.tipo !== "compra" || p.cartaoId !== cartaoId) continue;
    for (let k = Math.max(0, difMes(p.mesInicio, mes)); k < p.parcelas; k++) total += valorParcela(p.valor, p.parcelas, k);
  }
  return total;
}
