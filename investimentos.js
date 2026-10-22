// investimentos.js — aba Investimentos (modelo Investidor10).
// Carrega depois de app.js. Usa funções de regras.js, dados.js e app.js.

const INV_CATEGORIAS = ['Ações', 'FIIs', 'Tesouro Direto', 'ETFs'];
const CHAVE_COTACOES = 'painel_saldos_cotacoes_v1';
const URL_COTACOES = 'https://brapi.dev/api/quote/';
const CHAVE_TOKEN_BRAPI = 'painel_saldos_brapi_token';
const TEMPO_LIMITE_COTACOES_MS = 15000;

let INV_COTACOES = { precos: {}, atualizadoEm: null, erro: null };
let invEstado = null; // { tipo: 'op' | 'ativo' | 'provento', ticker }

// ---------- Dados ----------

// Carteira fica em dados.investimentos: { ativos: { TICKER: {tipo, ideal, precoManual} }, operacoes: [] }
function invDados() {
  if (!estado.dados.investimentos) {
    estado.dados.investimentos = { ativos: {}, operacoes: [] };
  }
  return estado.dados.investimentos;
}

function tipoDoAtivo(ticker) {
  const a = invDados().ativos[ticker];
  return a && a.tipo ? a.tipo : 'Ações';
}

function salvarEMostrarInv() {
  salvarDados(estado.dados);
  renderizarInvestimentos();
}

function pct(valor) {
  return `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function quantTxt(n) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
}

function classeValor(v) {
  if (v < 0) return 'saldo-neg';
  if (v > 0) return 'saldo-ok';
  return '';
}

// Recalcula quantidade e preço médio repetindo as operações em ordem de data
function calcularPosicoes(listaOps) {
  const ops = [...listaOps].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return (a.criadoEm || 0) - (b.criadoEm || 0);
  });
  const mapa = {};
  ops.forEach(o => {
    const p = mapa[o.ticker] || (mapa[o.ticker] = { ticker: o.ticker, quant: 0, pm: 0, negativo: false });
    if (o.operacao === 'compra') {
      const nova = p.quant + o.quant;
      p.pm = nova > 0 ? (p.quant * p.pm + o.quant * o.preco) / nova : 0;
      p.quant = nova;
    } else if (o.operacao === 'venda') {
      if (o.quant > p.quant + 1e-9) p.negativo = true;
      p.quant = p.quant - o.quant;
      if (p.quant < 1e-9) { p.quant = 0; p.pm = 0; }
    } else if (o.operacao === 'ajuste') {
      p.quant = o.quant;
      p.pm = o.preco;
    }
  });
  return mapa;
}

function validarOperacao(op) {
  if (!op.ticker) return 'Informe o ticker.';
  if (!op.data) return 'Informe a data.';
  if (!(op.quant > 0)) return 'A quantidade deve ser maior que zero.';
  const precoOk = op.operacao === 'ajuste' ? op.preco >= 0 : op.preco > 0;
  if (!precoOk) return 'Informe o preço unitário.';
  const p = calcularPosicoes([...invDados().operacoes, op])[op.ticker];
  if (p && p.negativo) return `Venda maior que a quantidade em carteira de ${op.ticker}.`;
  return null;
}

// ---------- Cotações ----------

function carregarCacheCotacoes() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_COTACOES));
    if (salvo && salvo.precos) INV_COTACOES = { ...salvo, erro: null };
  } catch (e) {
    // sem cache válido, começa vazio
  }
}

// Ativos com quantidade maior que zero, exceto Tesouro Direto (sem cotação nessa fonte)
function tickersParaCotar() {
  return Object.values(calcularPosicoes(invDados().operacoes))
    .filter(p => p.quant > 0 && tipoDoAtivo(p.ticker) !== 'Tesouro Direto')
    .map(p => p.ticker);
}

// Busca as cotações ao abrir a página e ao clicar em "Atualizar cotações".
async function atualizarCotacoes() {
  const tickers = tickersParaCotar();
  if (!tickers.length) {
    renderizarInvestimentos();
    return;
  }

  const token = localStorage.getItem(CHAVE_TOKEN_BRAPI);
  // O token vai no cabeçalho, e não na URL, para não aparecer no Console nem no histórico de rede
  const cabecalhos = token ? { Authorization: `Bearer ${token}` } : {};
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_COTACOES_MS);

  el('inv-cotacao').textContent = 'Buscando cotações...';
  try {
    const resposta = await fetch(URL_COTACOES + tickers.join(','), {
      headers: cabecalhos,
      signal: controle.signal
    });
    if (resposta.status === 401 || resposta.status === 403) throw new Error('token');
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    const json = await resposta.json();
    const precos = { ...INV_COTACOES.precos };
    (json.results || []).forEach(x => {
      const preco = Number(x.regularMarketPrice);
      if (!Number.isFinite(preco)) return;
      precos[String(x.symbol).toUpperCase()] = {
        preco,
        variacao: Number(x.regularMarketChangePercent) || 0
      };
    });
    INV_COTACOES = { precos, atualizadoEm: new Date().toISOString(), erro: null };
  } catch (e) {
    console.warn('Cotações indisponíveis:', e.message);
    if (e.message === 'token') {
      INV_COTACOES.erro = token ? 'token-invalido' : 'sem-token';
    } else {
      INV_COTACOES.erro = 'rede';
    }
  } finally {
    clearTimeout(limite);
  }

  localStorage.setItem(CHAVE_COTACOES, JSON.stringify(INV_COTACOES));
  renderizarInvestimentos();
}

// Prioridade: cotação buscada, depois preço manual, depois nada
function precoAtualDe(ticker) {
  const cot = INV_COTACOES.precos[ticker];
  if (cot && Number.isFinite(cot.preco)) {
    return { preco: cot.preco, variacao: cot.variacao, origem: 'cotação' };
  }
  const a = invDados().ativos[ticker];
  if (a && a.precoManual) {
    return { preco: Number(a.precoManual), variacao: 0, origem: 'manual' };
  }
  return { preco: null, variacao: 0, origem: null };
}

function textoStatusCotacao() {
  const quando = INV_COTACOES.atualizadoEm
    ? new Date(INV_COTACOES.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  if (INV_COTACOES.erro) {
    const motivo = {
      'sem-token': 'Falta o token da brapi. Clique em "Configurar token".',
      'token-invalido': 'O token da brapi foi recusado. Clique em "Configurar token" e confira.',
      'rede': 'Cotação indisponível agora.'
    }[INV_COTACOES.erro] || 'Cotação indisponível.';
    const complemento = quando
      ? ` Mostrando a última salva (${quando}).`
      : ' Informe o preço manual em Editar.';
    return motivo + complemento;
  }
  return quando ? `Cotações de ${quando}.` : 'Sem cotações ainda.';
}

function configurarToken() {
  const atual = localStorage.getItem(CHAVE_TOKEN_BRAPI) || '';
  const novo = prompt('Cole o token da brapi.dev. Ele fica salvo somente neste navegador.', atual);
  if (novo === null) return; // cancelou
  const limpo = novo.trim();
  if (limpo) localStorage.setItem(CHAVE_TOKEN_BRAPI, limpo);
  else localStorage.removeItem(CHAVE_TOKEN_BRAPI);
  atualizarCotacoes();
}

// ---------- Cálculos da carteira ----------

function montarCarteira() {
  const pos = Object.values(calcularPosicoes(invDados().operacoes)).filter(p => p.quant > 0);
  const linhas = pos.map(p => {
    const pa = precoAtualDe(p.ticker);
    const valorInv = arredondar(p.quant * p.pm);
    const valorAtual = pa.preco === null ? null : arredondar(p.quant * pa.preco);
    return {
      ticker: p.ticker,
      quant: p.quant,
      pm: p.pm,
      categoria: tipoDoAtivo(p.ticker),
      atual: pa.preco,
      origem: pa.origem,
      variacao: pa.variacao,
      valorInv,
      valorAtual,
      valorUsado: valorAtual === null ? valorInv : valorAtual,
      rentab: pa.preco !== null && p.pm > 0 ? (pa.preco / p.pm - 1) * 100 : null
    };
  });
  const patrimonio = arredondar(linhas.reduce((s, l) => s + l.valorUsado, 0));
  const investido = arredondar(linhas.reduce((s, l) => s + l.valorInv, 0));
  const ganho = arredondar(patrimonio - investido);

  // Variação do dia, derivada da variação percentual informada pela fonte
  let difDia = 0;
  let baseDia = 0;
  linhas.forEach(l => {
    if (l.valorAtual === null) return;
    const anterior = l.valorAtual / (1 + l.variacao / 100);
    difDia += l.valorAtual - anterior;
    baseDia += anterior;
  });

  return {
    linhas,
    patrimonio,
    investido,
    ganho,
    ganhoPct: investido ? (ganho / investido) * 100 : 0,
    varDiaValor: arredondar(difDia),
    varDiaPct: baseDia ? (difDia / baseDia) * 100 : 0
  };
}

// ---------- Renderização ----------

function htmlLinhaAtivo(l, patrimonio) {
  const pctCarteira = patrimonio ? (l.valorUsado / patrimonio) * 100 : null;
  const cfg = invDados().ativos[l.ticker];
  const ideal = cfg ? cfg.ideal : null;
  const temIdeal = ideal !== null && ideal !== undefined;
  const comprar = !temIdeal || pctCarteira === null
    ? '—'
    : (pctCarteira < ideal ? 'Sim' : 'Não');
  const classeComprar = comprar === 'Sim' ? 'saldo-ok' : comprar === 'Não' ? 'saldo-neg' : '';
  const semPreco = l.atual === null;
  return `
    <tr>
      <td><strong>${escapar(l.ticker)}</strong></td>
      <td>${quantTxt(l.quant)}</td>
      <td>${formatarMoeda(l.pm)}</td>
      <td>${semPreco ? '—' : formatarMoeda(l.atual)}${l.origem === 'manual' ? ' <small>(manual)</small>' : ''}</td>
      <td class="${classeValor(l.variacao)}">${semPreco ? '—' : pct(l.variacao)}</td>
      <td class="${classeValor(l.rentab)}">${l.rentab === null ? '—' : pct(l.rentab)}</td>
      <td>${semPreco ? `${formatarMoeda(l.valorInv)} <small>(sem preço)</small>` : formatarMoeda(l.valorAtual)}</td>
      <td>${pctCarteira === null ? '—' : pct(pctCarteira)}</td>
      <td>${temIdeal ? pct(ideal) : '—'}</td>
      <td class="${classeComprar}">${comprar}</td>
      <td class="acoes-linha">
        <button type="button" class="secundario" data-inv="novo-na-linha" data-ticker="${escapar(l.ticker)}">+</button>
        <button type="button" data-inv="editar-ativo" data-ticker="${escapar(l.ticker)}">Editar</button>
      </td>
    </tr>`;
}

function htmlCategoria(nome, carteira) {
  const itens = carteira.linhas.filter(l => l.categoria === nome);
  const total = arredondar(itens.reduce((s, l) => s + l.valorUsado, 0));
  const pctCat = carteira.patrimonio ? (total / carteira.patrimonio) * 100 : 0;
  const cabecalho = `
    <span>${nome}</span>
    <small>${itens.length} ativo(s)</small>
    <span>${formatarMoeda(total)}</span>
    <small>${pct(pctCat)} da carteira</small>`;
  const corpo = itens.length
    ? `<div class="tabela-wrap">
        <table class="planilha">
          <thead>
            <tr>
              <th>Ativo</th><th>Quant.</th><th>Preço médio</th><th>Preço atual</th>
              <th>Variação</th><th>Rentabilidade</th><th>Saldo</th>
              <th>% carteira</th><th>% ideal</th><th>Comprar?</th><th></th>
            </tr>
          </thead>
          <tbody>${itens.map(l => htmlLinhaAtivo(l, carteira.patrimonio)).join('')}</tbody>
        </table>
      </div>`
    : '<p class="ajuda sem-ativos">Nenhum ativo nesta categoria.</p>';
  return `<details class="categoria" open><summary>${cabecalho}</summary>${corpo}</details>`;
}

function htmlHistorico() {
  const ops = [...invDados().operacoes].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? 1 : -1;
    return (b.criadoEm || 0) - (a.criadoEm || 0);
  });
  if (!ops.length) return '<tr><td colspan="7">Nenhum lançamento ainda.</td></tr>';
  return ops.map(o => `
    <tr>
      <td>${dataBR(o.data)}</td>
      <td><strong>${escapar(o.ticker)}</strong></td>
      <td>${escapar(o.operacao)}</td>
      <td>${quantTxt(o.quant)}</td>
      <td>${formatarMoeda(o.preco)}</td>
      <td>${formatarMoeda(arredondar(o.quant * o.preco))}</td>
      <td><button type="button" class="perigo" data-inv="excluir-op" data-id="${escapar(o.id)}">Excluir</button></td>
    </tr>`).join('');
}

function renderizarInvestimentos() {
  const c = montarCarteira();
  el('inv-patrimonio').textContent = formatarMoeda(c.patrimonio);
  el('inv-patrimonio-var').textContent = `${formatarMoeda(c.varDiaValor)} (${pct(c.varDiaPct)}) hoje`;
  el('inv-patrimonio-var').className = classeValor(c.varDiaValor);
  el('inv-investido').textContent = formatarMoeda(c.investido);
  el('inv-ganho').textContent = formatarMoeda(c.ganho);
  el('inv-ganho').className = classeValor(c.ganho);
  el('inv-ganho-pct').textContent = pct(c.ganhoPct);
  el('inv-ganho-pct').className = classeValor(c.ganhoPct);
  el('inv-cotacao').textContent = textoStatusCotacao();
  const vazio = c.linhas.length
    ? ''
    : '<p class="ajuda">Nenhum ativo ainda. Use "+ Adicionar lançamento" para começar.</p>';
  el('inv-categorias').innerHTML = vazio + INV_CATEGORIAS.map(n => htmlCategoria(n, c)).join('');
  el('inv-historico').innerHTML = htmlHistorico();
}

// ---------- Abas ----------

function ativarAba(nome) {
  document.querySelectorAll('.aba[data-aba]').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === nome);
  });
  el('aba-saldos').hidden = nome !== 'saldos';
  el('aba-investimentos').hidden = nome !== 'investimentos';
  el('aba-proventos').hidden = nome !== 'proventos';
  if (nome === 'investimentos') renderizarInvestimentos();
  if (nome === 'proventos' && typeof renderizarProventos === 'function') renderizarProventos();
}

// ---------- Modal de investimentos ----------

function opcoesTipo(selecionado) {
  return INV_CATEGORIAS
    .map(n => `<option value="${n}" ${n === selecionado ? 'selected' : ''}>${n}</option>`)
    .join('');
}

function abrirModalInv(titulo, html, textoSalvar) {
  el('modal-inv-titulo').textContent = titulo;
  el('modal-inv-corpo').innerHTML = html;
  el('modal-inv-salvar').textContent = textoSalvar;
  el('modal-inv').hidden = false;
  const primeiro = el('modal-inv-corpo').querySelector('input, select');
  if (primeiro) primeiro.focus();
}

function fecharModalInv() {
  invEstado = null;
  el('modal-inv').hidden = true;
  el('modal-inv-corpo').innerHTML = '';
}

function abrirOperacao(tickerPre) {
  const tipo = tickerPre && invDados().ativos[tickerPre] ? invDados().ativos[tickerPre].tipo : 'Ações';
  invEstado = { tipo: 'op' };
  abrirModalInv('Adicionar lançamento', `
    <label class="form-linha">
      <span>Operação</span>
      <select name="operacao">
        <option value="compra">compra</option>
        <option value="venda">venda</option>
        <option value="ajuste">ajuste (define quantidade e preço médio)</option>
      </select>
    </label>
    <label class="form-linha">
      <span>Ticker</span>
      <input name="ticker" type="text" required placeholder="ex.: GARE11" value="${escapar(tickerPre || '')}">
    </label>
    <label class="form-linha">
      <span>Categoria</span>
      <select name="tipo">${opcoesTipo(tipo)}</select>
    </label>
    <label class="form-linha">
      <span>Data</span>
      <input name="data" type="date" required value="${hojeISO()}">
    </label>
    <label class="form-linha">
      <span>Quantidade</span>
      <input name="quant" type="number" step="any" min="0" required>
    </label>
    <label class="form-linha">
      <span>Preço unitário (R$)</span>
      <input name="preco" type="number" step="0.01" min="0" required>
    </label>
    <label class="form-linha">
      <span>% ideal</span>
      <input name="ideal" type="number" step="0.01" min="0" max="100" placeholder="opcional">
    </label>
    <p class="ajuda">Compra: atualiza o preço médio. Venda: reduz a quantidade e mantém o preço médio. Ajuste: define quantidade e preço médio diretamente.</p>`,
    'Salvar lançamento');
}

function abrirEditarAtivo(ticker) {
  const a = invDados().ativos[ticker] || { tipo: 'Ações', ideal: null, precoManual: null };
  invEstado = { tipo: 'ativo', ticker };
  abrirModalInv(`Editar ${ticker}`, `
    <label class="form-linha">
      <span>Categoria</span>
      <select name="tipo">${opcoesTipo(a.tipo)}</select>
    </label>
    <label class="form-linha">
      <span>% ideal</span>
      <input name="ideal" type="number" step="0.01" min="0" max="100" value="${a.ideal ?? ''}">
    </label>
    <label class="form-linha">
      <span>Preço manual (R$)</span>
      <input name="precoManual" type="number" step="0.01" min="0" value="${a.precoManual ?? ''}" placeholder="use se não houver cotação">
    </label>
    <p class="ajuda">Para Tesouro Direto, informe o preço manual atual. Quantidade e preço médio mudam pelo lançamento de ajuste.</p>`,
    'Salvar');
}

function enviarModalInv(evento) {
  evento.preventDefault();
  if (!invEstado) return;

  if (invEstado.tipo === 'provento') {
    salvarProventoManual();
    return;
  }

  const f = el('modal-inv-form');
  const c = nome => f.querySelector(`[name="${nome}"]`);
  const inv = invDados();

  if (invEstado.tipo === 'ativo') {
    const ticker = invEstado.ticker;
    const anterior = inv.ativos[ticker] || {};
    inv.ativos[ticker] = {
      ...anterior,
      tipo: c('tipo').value,
      ideal: c('ideal').value === '' ? null : Number(c('ideal').value),
      precoManual: c('precoManual').value === '' ? null : Number(c('precoManual').value)
    };
  } else {
    const ticker = c('ticker').value.trim().toUpperCase();
    const op = {
      id: gerarId(),
      criadoEm: Date.now(),
      operacao: c('operacao').value,
      ticker,
      data: c('data').value,
      quant: Number(c('quant').value),
      preco: Number(c('preco').value)
    };
    const erro = validarOperacao(op);
    if (erro) {
      alert(erro);
      return;
    }
    inv.operacoes.push(op);
    const anterior = inv.ativos[ticker] || {};
    inv.ativos[ticker] = {
      ...anterior,
      tipo: c('tipo').value,
      ideal: c('ideal').value === '' ? (anterior.ideal ?? null) : Number(c('ideal').value),
      precoManual: anterior.precoManual ?? null
    };
  }

  fecharModalInv();
  salvarEMostrarInv();
}

// Não deixa excluir uma compra que faria alguma venda posterior ficar sem quantidade
function excluirOperacao(id) {
  const inv = invDados();
  const op = inv.operacoes.find(o => o.id === id);
  if (!op) return;
  if (!confirm(`Excluir ${op.operacao} de ${quantTxt(op.quant)} de ${op.ticker} em ${dataBR(op.data)}?`)) return;

  const restante = inv.operacoes.filter(o => o.id !== id);
  const posicoes = Object.values(calcularPosicoes(restante));
  if (posicoes.some(p => p.negativo)) {
    alert('Não é possível excluir: uma venda posterior ficaria sem quantidade para cobrir.');
    return;
  }
  inv.operacoes = restante;
  salvarEMostrarInv();
}

// ---------- Cliques ----------

function cliqueInvestimentos(evento) {
  const botao = evento.target.closest('button[data-inv]');
  if (!botao) return;
  const acao = botao.dataset.inv;
  if (acao === 'novo-na-linha') abrirOperacao(botao.dataset.ticker);
  if (acao === 'editar-ativo') abrirEditarAtivo(botao.dataset.ticker);
  if (acao === 'excluir-op') excluirOperacao(botao.dataset.id);
}

// ---------- Inicialização ----------

function iniciarInvestimentos() {
  carregarCacheCotacoes();
  invDados();

  // Botão de token, criado aqui para não mexer no index.html
  const btnToken = document.createElement('button');
  btnToken.type = 'button';
  btnToken.id = 'btn-inv-token';
  btnToken.className = 'secundario';
  btnToken.textContent = 'Configurar token';
  el('btn-inv-cotacao').after(btnToken);
  btnToken.addEventListener('click', configurarToken);

  renderizarInvestimentos();

  document.querySelectorAll('.aba[data-aba]').forEach(b => {
    b.addEventListener('click', () => ativarAba(b.dataset.aba));
  });
  el('btn-inv-novo').addEventListener('click', () => abrirOperacao(null));
  el('btn-inv-cotacao').addEventListener('click', atualizarCotacoes);
  el('aba-investimentos').addEventListener('click', cliqueInvestimentos);
  el('modal-inv-form').addEventListener('submit', enviarModalInv);
  el('modal-inv-cancelar').addEventListener('click', fecharModalInv);
  el('modal-inv-x').addEventListener('click', fecharModalInv);
  el('modal-inv').addEventListener('click', e => {
    if (e.target === el('modal-inv')) fecharModalInv();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && invEstado) fecharModalInv();
  });

  // Cotações buscadas uma vez, ao abrir a página
  atualizarCotacoes();
}

iniciarInvestimentos();