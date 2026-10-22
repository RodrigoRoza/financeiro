// proventos.js — aba Proventos com lançamentos manuais.
// Depende de regras.js (calcularPosicoes, tipoDoAtivo), dados.js, app.js e investimentos.js.

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const TIPOS_PROVENTO = ['Rendimento', 'Dividendo', 'JCP', 'Amortização'];
const URL_CLUBE_FII = 'https://www.clubefii.com.br/fiis/';

// ---------- Dados ----------

function provManuais() {
  const inv = invDados();
  if (!inv.proventosManuais) inv.proventosManuais = [];
  return inv.proventosManuais;
}

// Quantidade que o usuário tinha na data-com (inclusive, pois a data-com ainda dá direito)
function quantNaData(ticker, dataCom) {
  const ops = invDados().operacoes.filter(o => o.ticker === ticker && o.data <= dataCom);
  const p = calcularPosicoes(ops)[ticker];
  return p ? p.quant : 0;
}

// Lançamentos com quantidade e total calculados pela carteira
function listaProventos() {
  return provManuais().map(m => {
    const quant = quantNaData(m.ticker, m.dataCom);
    return { ...m, quant, total: arredondar(quant * m.valorPorCota) };
  });
}

// ---------- Renderização ----------

function formatoNumero(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Grade ano × mês, com média e total por ano
function htmlGradeAnual(lista) {
  if (!lista.length) return '<p class="ajuda">Nenhum provento lançado ainda.</p>';

  const hoje = hojeISO();
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  const anos = [...new Set(lista.map(p => Number(p.dataPagamento.slice(0, 4))))].sort((a, b) => b - a);

  const cabecalho = `<tr><th class="col-dia">Ano</th>${MESES_CURTOS.map(m => `<th>${m}</th>`).join('')}<th>Média</th><th>Total</th></tr>`;

  const corpo = anos.map(ano => {
    const porMes = Array(12).fill(0);
    const mesAReceber = Array(12).fill(false);
    let totalAno = 0;

    lista.forEach(p => {
      if (Number(p.dataPagamento.slice(0, 4)) !== ano) return;
      const m = Number(p.dataPagamento.slice(5, 7)) - 1;
      porMes[m] = arredondar(porMes[m] + p.total);
      if (p.dataPagamento > hoje) mesAReceber[m] = true;
      totalAno = arredondar(totalAno + p.total);
    });

    // A média considera só os meses já decorridos do ano
    const meses = ano < anoAtual ? 12 : mesAtual;
    const media = arredondar(totalAno / meses);

    const celulas = porMes
      .map((v, i) => `<td class="${mesAReceber[i] && v ? 'a-receber' : ''}">${v ? formatoNumero(v) : ''}</td>`)
      .join('');

    return `<tr><td class="col-dia"><strong>${ano}</strong></td>${celulas}<td>${formatoNumero(media)}</td><td><strong>${formatoNumero(totalAno)}</strong></td></tr>`;
  }).join('');

  return `<div class="tabela-wrap"><table class="planilha"><thead>${cabecalho}</thead><tbody>${corpo}</tbody></table></div>`;
}

function htmlHistoricoProventos(lista) {
  if (!lista.length) return '<tr><td colspan="9">Nenhum provento lançado.</td></tr>';

  const hoje = hojeISO();
  return [...lista]
    .sort((a, b) => b.dataPagamento.localeCompare(a.dataPagamento))
    .map(p => {
      const aReceber = p.dataPagamento > hoje;
      return `
      <tr>
        <td>${dataBR(p.dataPagamento)}</td>
        <td><strong>${escapar(p.ticker)}</strong></td>
        <td>${escapar(p.tipo)}</td>
        <td>${quantTxt(p.quant)}</td>
        <td>${dataBR(p.dataCom)}</td>
        <td>${formatarMoeda(p.valorPorCota)}</td>
        <td>${formatarMoeda(p.total)}</td>
        <td class="${aReceber ? 'a-receber' : 'saldo-ok'}">${aReceber ? 'a receber' : 'recebido'}</td>
        <td><button type="button" class="perigo" data-prov="excluir" data-id="${escapar(p.id)}">Excluir</button></td>
      </tr>`;
    })
    .join('');
}

function renderizarProventos() {
  const lista = listaProventos();
  const hoje = hojeISO();
  const soma = arr => arredondar(arr.reduce((s, p) => s + p.total, 0));
  const recebidos = lista.filter(p => p.dataPagamento <= hoje);
  const aReceber = lista.filter(p => p.dataPagamento > hoje);

  // Últimos 12 meses, incluindo o mês atual
  const agora = new Date();
  const inicio12 = isoDeData(new Date(agora.getFullYear(), agora.getMonth() - 11, 1));
  const total12 = soma(recebidos.filter(p => p.dataPagamento >= inicio12));

  el('prov-media12').textContent = formatarMoeda(arredondar(total12 / 12));
  el('prov-total12').textContent = formatarMoeda(total12);
  el('prov-total').textContent = formatarMoeda(soma(recebidos));
  el('prov-aberto').textContent = formatarMoeda(soma(aReceber));
  el('prov-status').textContent = lista.length
    ? `${lista.length} lançamento(s).`
    : 'Nenhum lançamento. Use "+ Lançar provento" para começar.';
  el('prov-grade').innerHTML = htmlGradeAnual(lista);
  el('prov-historico').innerHTML = htmlHistoricoProventos(lista);
}

// ---------- Lançamento ----------

// Link para a página do FII no Clube FII. Só aparece para ativos classificados como FII.
function atualizarLinkFII() {
  const f = el('modal-inv-form');
  const ticker = f.querySelector('[name="ticker"]').value;
  const area = f.querySelector('#prov-link-fii');

  if (tipoDoAtivo(ticker) !== 'FIIs') {
    area.textContent = '';
    return;
  }
  const url = URL_CLUBE_FII + encodeURIComponent(ticker);
  area.innerHTML = `Datas e valores: <a href="${escapar(url)}" target="_blank" rel="noopener">abrir ${escapar(ticker)} no Clube FII</a>`;
}

function abrirProventoManual() {
  const tickers = [...new Set(invDados().operacoes.map(o => o.ticker))].sort();
  if (!tickers.length) {
    alert('Cadastre um ativo na aba Investimentos antes de lançar um provento.');
    return;
  }

  invEstado = { tipo: 'provento' };
  abrirModalInv('Lançar provento', `
    <label class="form-linha">
      <span>Ativo</span>
      <select name="ticker">${tickers.map(t => `<option>${escapar(t)}</option>`).join('')}</select>
    </label>
    <p class="ajuda" id="prov-link-fii"></p>
    <label class="form-linha">
      <span>Tipo</span>
      <select name="tipo">${TIPOS_PROVENTO.map(t => `<option>${t}</option>`).join('')}</select>
    </label>
    <label class="form-linha">
      <span>Data-com</span>
      <input name="dataCom" type="date" required>
    </label>
    <p class="ajuda">Só vale se você já tinha o ativo nessa data.</p>
    <label class="form-linha">
      <span>Data de pagamento</span>
      <input name="dataPagamento" type="date" required>
    </label>
    <label class="form-linha">
      <span>Valor por cota (R$)</span>
      <input name="valorPorCota" type="number" step="0.0001" min="0" required>
    </label>
    <p class="ajuda">A quantidade é calculada pela carteira na data-com.</p>`,
    'Salvar provento');

  const selectTicker = el('modal-inv-form').querySelector('[name="ticker"]');
  selectTicker.addEventListener('change', atualizarLinkFII);
  atualizarLinkFII();
}

function salvarProventoManual() {
  const f = el('modal-inv-form');
  const campo = nome => f.querySelector(`[name="${nome}"]`).value;

  const ticker = campo('ticker').trim().toUpperCase();
  const tipo = campo('tipo');
  const dataCom = campo('dataCom');
  const dataPagamento = campo('dataPagamento');
  const valorPorCota = Number(campo('valorPorCota'));

  if (!ticker || !dataCom || !dataPagamento || !(valorPorCota > 0)) {
    alert('Preencha ativo, data-com, data de pagamento e valor por cota.');
    return;
  }
  if (dataPagamento < dataCom) {
    alert('A data de pagamento não pode ser anterior à data-com.');
    return;
  }
  if (quantNaData(ticker, dataCom) <= 0) {
    alert(`Em ${dataBR(dataCom)} você não tinha ${ticker} em carteira.`);
    return;
  }
  const duplicado = provManuais().some(p =>
    p.ticker === ticker && p.tipo === tipo && p.dataPagamento === dataPagamento
  );
  if (duplicado) {
    alert('Já existe um lançamento deste ativo, deste tipo, com esta data de pagamento.');
    return;
  }

  provManuais().push({ id: gerarId(), ticker, tipo, dataCom, dataPagamento, valorPorCota });
  fecharModalInv();
  salvarDados(estado.dados);
  renderizarProventos();
}

function excluirProvento(id) {
  if (!confirm('Excluir este provento?')) return;
  invDados().proventosManuais = provManuais().filter(p => p.id !== id);
  salvarDados(estado.dados);
  renderizarProventos();
}

// ---------- Inicialização ----------

function iniciarProventos() {
  el('btn-prov-novo').addEventListener('click', abrirProventoManual);
  el('aba-proventos').addEventListener('click', evento => {
    const botao = evento.target.closest('button[data-prov="excluir"]');
    if (botao) excluirProvento(botao.dataset.id);
  });
  renderizarProventos();
}

iniciarProventos();