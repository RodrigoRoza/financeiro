// regras.js — cálculos do painel de saldos.
// Este arquivo não mexe na tela nem no armazenamento.
// Versão das regras: se mudar um cálculo, aumente este número e registre no LEIA-ME.txt.
const REGRAS_VERSAO = 3;

// "2026-10-15" -> Date (meio-dia, para evitar erro de fuso horário)
function dataDeISO(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

// Date -> "2026-10-15"
function isoDeData(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Soma meses mantendo o dia. Se o mês não tiver esse dia, usa o último dia do mês.
function somarMeses(iso, meses) {
  const base = dataDeISO(iso);
  const diaOriginal = base.getDate();
  const alvo = new Date(base.getFullYear(), base.getMonth() + meses, 1, 12, 0, 0);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(diaOriginal, ultimoDia));
  return isoDeData(alvo);
}

// Soma dias corridos: 2026-10-05 + 7 = 2026-10-12
function somarDias(iso, dias) {
  const d = dataDeISO(iso);
  d.setDate(d.getDate() + dias);
  return isoDeData(d);
}

// Data limite padrão para mostrar lançamentos repetidos (hoje + X meses)
function horizontePadrao(meses = 24) {
  return isoDeData(new Date(new Date().getFullYear(), new Date().getMonth() + meses, 1));
}

// Hoje no formato "2026-10-21"
function hojeISO() {
  return isoDeData(new Date());
}

// Evita erros de centavos em somas de ponto flutuante
function arredondar(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

function formatarMoeda(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Frequência de um lançamento.
// Dados salvos antes da versão 3 usam os campos "mensal" e "parcelas"; estes continuam válidos.
function frequenciaDe(l) {
  if (l.frequencia) return l.frequencia;
  if (l.mensal) return 'mensal';
  if (Number(l.parcelas || 1) > 1) return 'parcelado';
  return 'nao_repete';
}

// Retorna uma mensagem de erro, ou null se o lançamento for válido
function validarLancamento(l) {
  if (!l.data) return 'Informe a data.';
  if (!l.descricao || !String(l.descricao).trim()) return 'Informe a descrição.';
  if (!(Number(l.valor) > 0)) return 'O valor deve ser maior que zero.';

  const freq = frequenciaDe(l);
  const validas = ['nao_repete', 'mensal', 'semanal', 'diaria', 'parcelado'];
  if (!validas.includes(freq)) return 'Frequência inválida.';

  if (freq === 'parcelado') {
    const parcelas = Number(l.parcelas);
    if (!Number.isInteger(parcelas) || parcelas < 2) return 'Compra parcelada precisa de pelo menos 2 parcelas.';
  }
  return null;
}

// Transforma um lançamento em ocorrências datadas, até a data limite "ate".
// Diária: todo dia. Semanal: mesmo dia da semana. Mensal: mesmo dia do mês.
//   Essas três repetem o valor digitado integralmente.
// Parcelado: o valor digitado é o TOTAL, dividido em partes iguais no mesmo dia do mês.
// Não repete: uma única ocorrência.
function gerarOcorrencias(l, ate) {
  const sinal = l.tipo === 'entrada' ? 1 : -1;
  const freq = frequenciaDe(l);
  const base = { origemId: l.id, descricao: l.descricao };
  const ocorrencias = [];

  if (freq === 'diaria' || freq === 'semanal') {
    const passo = freq === 'diaria' ? 1 : 7;
    const valor = sinal * Number(l.valor);
    for (let i = 0; ; i++) {
      const data = somarDias(l.data, passo * i);
      if (data > ate) break;
      ocorrencias.push({ ...base, data, valor, rotulo: freq === 'diaria' ? 'Diária' : 'Semanal' });
    }
    return ocorrencias;
  }

  if (freq === 'mensal') {
    const valor = sinal * Number(l.valor);
    for (let i = 0; ; i++) {
      const data = somarMeses(l.data, i);
      if (data > ate) break;
      ocorrencias.push({ ...base, data, valor, rotulo: 'Mensal' });
    }
    return ocorrencias;
  }

  // Parcelado ou não repete: trabalha em centavos inteiros para a soma bater com o total
  const total = freq === 'parcelado' ? Number(l.parcelas) : 1;
  const centavos = Math.round(Number(l.valor) * 100);
  const parte = Math.floor(centavos / total);
  const sobra = centavos - parte * total; // centavos extras vão para as primeiras parcelas

  for (let i = 0; i < total; i++) {
    const c = parte + (i < sobra ? 1 : 0);
    ocorrencias.push({
      ...base,
      data: somarMeses(l.data, i),
      valor: sinal * c / 100,
      rotulo: total > 1 ? `Parcela ${i + 1}/${total}` : ''
    });
  }
  return ocorrencias;
}

// Monta as linhas em ordem de data, com o saldo acumulado.
// referencias: [{ data, valor }] (saldo informado, válido no início do dia).
// Linhas antes do primeiro saldo informado ficam com saldo null.
function calcularLinhas(lancamentos, referencias, ate) {
  const eventos = [];

  lancamentos.forEach(l => {
    gerarOcorrencias(l, ate).forEach(o => eventos.push({ ...o, tipo: 'mov' }));
  });

  referencias.forEach(r => {
    eventos.push({
      data: r.data,
      tipo: 'ref',
      valor: Number(r.valor),
      descricao: 'Saldo informado',
      rotulo: ''
    });
  });

  // No mesmo dia, o saldo informado vem antes dos movimentos
  eventos.sort((a, b) => {
    if (a.data < b.data) return -1;
    if (a.data > b.data) return 1;
    const ordemA = a.tipo === 'ref' ? 0 : 1;
    const ordemB = b.tipo === 'ref' ? 0 : 1;
    return ordemA - ordemB;
  });

  let saldo = null;
  return eventos.map(e => {
    if (e.tipo === 'ref') {
      saldo = arredondar(e.valor);
      return { ...e, movimento: null, saldo, ehReferencia: true };
    }
    if (saldo !== null) saldo = arredondar(saldo + e.valor);
    return { ...e, movimento: e.valor, saldo, ehReferencia: false };
  });
}

// Saldo mais recente até uma data (padrão: hoje)
function saldoAtual(linhas, data = hojeISO()) {
  let atual = null;
  linhas.forEach(l => {
    if (l.data <= data && l.saldo !== null) atual = l.saldo;
  });
  return atual;
}

// Salva um saldo informado. Substitui só o da mesma data.
function salvarReferencia(referencias, nova) {
  const outras = referencias.filter(r => r.data !== nova.data);
  return [...outras, { data: nova.data, valor: Number(nova.valor) }]
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// ---------- Testes ----------
// No navegador, abra o painel, pressione F12, vá em Console e digite: testarRegras()
function testarRegras() {
  const falhas = [];
  const confere = (condicao, nome) => { if (!condicao) falhas.push(nome); };

  // Datas
  confere(somarMeses('2026-01-31', 1) === '2026-02-28', 'fim de mês em fevereiro');
  confere(somarMeses('2026-10-15', 5) === '2027-03-15', 'soma de meses');
  confere(somarDias('2026-02-27', 1) === '2026-02-28', 'soma de dias');
  confere(somarDias('2026-12-31', 1) === '2027-01-01', 'virada de ano');

  // Frequência e dados antigos
  confere(frequenciaDe({ mensal: true }) === 'mensal', 'dado antigo mensal');
  confere(frequenciaDe({ parcelas: 5, mensal: false }) === 'parcelado', 'dado antigo parcelado');
  confere(frequenciaDe({}) === 'nao_repete', 'padrão não repete');

  // Validação
  const compra = { id: 1, data: '2026-10-05', descricao: 'Notebook', valor: 200, tipo: 'saida', frequencia: 'parcelado', parcelas: 5 };
  confere(validarLancamento(compra) === null, 'parcelado válido');
  confere(validarLancamento({ ...compra, parcelas: 1 }) !== null, 'parcelado com 1 parcela bloqueado');
  confere(validarLancamento({ ...compra, valor: 0 }) !== null, 'valor zero bloqueado');
  confere(validarLancamento({ ...compra, frequencia: 'xyz' }) !== null, 'frequência inválida bloqueada');

  // Parcelado: 200 em 5 vezes = 40 por parcela
  const parcelas = gerarOcorrencias(compra, '2027-01-01');
  confere(parcelas.length === 5, 'quantidade de parcelas');
  confere(parcelas[4].data === '2027-02-05', 'última parcela no dia 05');
  confere(parcelas.every(p => p.valor === -40), 'valor total dividido em 5 parcelas de 40');

  // Divisão não exata: 100 em 3 = 33,34 + 33,33 + 33,33
  const dividido = { id: 4, data: '2026-10-05', descricao: 'Teste', valor: 100, tipo: 'saida', frequencia: 'parcelado', parcelas: 3 };
  const partesDivididas = gerarOcorrencias(dividido, '2027-01-01').map(p => p.valor);
  confere(partesDivididas[0] === -33.34 && partesDivididas[1] === -33.33 && partesDivididas[2] === -33.33, 'centavos nas primeiras parcelas');
  confere(Math.round(partesDivididas.reduce((s, v) => s + v, 0) * 100) === -10000, 'soma das parcelas igual ao total');

  // Saldo com parcelado: referência de 500 em 15/10
  const linhas = calcularLinhas([compra], [{ data: '2026-10-15', valor: 500 }], '2026-12-31');
  const nov = linhas.find(l => l.data === '2026-11-05');
  const dez = linhas.find(l => l.data === '2026-12-05');
  confere(nov && nov.saldo === 460, 'saldo após parcela de novembro (460)');
  confere(dez && dez.saldo === 420, 'saldo após parcela de dezembro (420)');
  confere(linhas.filter(l => l.data < '2026-10-15' && l.saldo !== null).length === 0, 'sem saldo antes da primeira referência');

  // Entrada soma
  const entrada = { id: 2, data: '2026-11-10', descricao: 'Salário', valor: 1000, tipo: 'entrada', frequencia: 'nao_repete' };
  const comEntrada = calcularLinhas([compra, entrada], [{ data: '2026-10-15', valor: 500 }], '2026-12-31');
  confere(comEntrada.find(l => l.descricao === 'Salário').saldo === 1460, 'entrada soma ao saldo (1460)');

  // Lançamento no mesmo dia do saldo informado é somado
  const pix = { id: 5, data: '2026-10-15', descricao: 'Pix', valor: 50, tipo: 'saida', frequencia: 'nao_repete' };
  const linhasPix = calcularLinhas([pix], [{ data: '2026-10-15', valor: 500 }], '2026-12-31');
  confere(linhasPix.find(l => l.descricao === 'Pix').saldo === 450, 'mesmo dia do saldo informado é somado');

  // Diária: todo dia de 01/10 a 10/10 = 10 ocorrências
  const diaria = { id: 6, data: '2026-10-01', descricao: 'Café', valor: 10, tipo: 'saida', frequencia: 'diaria' };
  const ocDiaria = gerarOcorrencias(diaria, '2026-10-10');
  confere(ocDiaria.length === 10, 'diária aparece todos os dias');
  confere(ocDiaria.every(o => o.valor === -10), 'diária usa o valor integral');

  // Semanal: 05/10 até 31/10 = 05, 12, 19 e 26
  const semanal = { id: 7, data: '2026-10-05', descricao: 'Academia', valor: 50, tipo: 'saida', frequencia: 'semanal' };
  const ocSemanal = gerarOcorrencias(semanal, '2026-10-31');
  confere(ocSemanal.length === 4, 'semanal: 4 ocorrências em outubro');
  confere(ocSemanal[1].data === '2026-10-12' && ocSemanal[3].data === '2026-10-26', 'semanal: mesmo dia da semana');

  // Mensal: 01/10 até 31/12 = 3 ocorrências
  const mensal = { id: 3, data: '2026-10-01', descricao: 'Aluguel', valor: 100, tipo: 'saida', frequencia: 'mensal' };
  confere(gerarOcorrencias(mensal, '2026-12-31').length === 3, 'mensal até dezembro');

  // Saldo informado substitui só a mesma data
  const refs = salvarReferencia([{ data: '2026-10-15', valor: 500 }, { data: '2026-11-15', valor: 900 }], { data: '2026-10-15', valor: 600 });
  confere(refs.length === 2 && refs[0].valor === 600, 'substitui saldo da mesma data');
  confere(refs[1].valor === 900, 'mantém saldo de data posterior');

  console.log(falhas.length ? 'Falhas: ' + falhas.join(' | ') : 'Todos os testes de regras passaram.');
  return falhas;
}