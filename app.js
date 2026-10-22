// app.js — grade mensal de Saldos e formulário de lançamento.

const LIMITE_ALERTA = 500; // entre zero e este valor: amarelo; acima: verde; abaixo de zero: vermelho
const CHAVE_TEMA = 'painel_saldos_tema';

// Categorias. "nomeForm" é o nome usado nos formulários e botões, como na referência.
const CATEGORIAS = [
  { chave: 'entrada',  rotulo: 'Entradas',  nomeForm: 'entrada',          letra: 'E',  classe: 'c-entradas' },
  { chave: 'saida',    rotulo: 'Saídas',    nomeForm: 'saída',            letra: 'S',  classe: 'c-saidas' },
  { chave: 'diario',   rotulo: 'Diários',   nomeForm: 'diário',           letra: 'D',  classe: 'c-diarios' },
  { chave: 'economia', rotulo: 'Economias', nomeForm: 'economia',         letra: 'Ec', classe: 'c-economias' },
  { chave: 'cartao',   rotulo: 'Cartão',    nomeForm: 'gasto com cartão', letra: 'C',  classe: 'c-cartao' }
];

// Vinculação: só para a categoria Economia
const VINCULACOES = [
  { valor: 'investimento', texto: 'investimento' },
  { valor: 'caixinha',     texto: 'caixinha' }
];

const FREQUENCIAS_FORM = [
  { valor: 'nao_repete', texto: 'não repete' },
  { valor: 'mensal',     texto: 'mensalmente' },
  { valor: 'semanal',    texto: 'semanalmente' },
  { valor: 'diaria',     texto: 'diariamente' },
  { valor: 'parcelado',  texto: 'parcelado' }
];

const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SIGLAS_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const estado = {
  dados: null,
  periodo: null, // { ano, mes } do primeiro mês exibido (mes de 0 a 11)
  modal: null    // { tipo: 'lancamento' | 'saldo', data, categoria, editandoId }
};

function el(id) { return document.getElementById(id); }

function contaAtual() {
  return estado.dados.contas.find(c => c.id === estado.dados.contaAtiva) || null;
}

function categoriaInfo(chave) {
  return CATEGORIAS.find(c => c.chave === chave) || CATEGORIAS[1];
}

function rotuloVinculacao(valor) {
  const v = VINCULACOES.find(x => x.valor === valor);
  return v ? v.texto : '';
}

// "2026-10-15" -> "15/10/2026"
function dataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function mesISO(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Evita que texto digitado vire HTML
function escapar(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function classeDeSaldo(saldo) {
  if (saldo === null || saldo === undefined) return '';
  if (saldo < 0) return 'saldo-neg';
  if (saldo < LIMITE_ALERTA) return 'saldo-alerta';
  return 'saldo-ok';
}

function salvarEMostrar() {
  salvarDados(estado.dados);
  renderizar();
}

// Até onde os lançamentos repetidos são gerados
function dataLimite() {
  const fimExibido = isoDeData(new Date(estado.periodo.ano, estado.periodo.mes + 2, 0));
  const padrao = horizontePadrao(24);
  return fimExibido > padrao ? fimExibido : padrao;
}

// ---------- Período ----------

function iniciarPeriodo() {
  const hoje = new Date();
  estado.periodo = { ano: hoje.getFullYear(), mes: hoje.getMonth() };
}

function deslocarPeriodo(meses) {
  const d = new Date(estado.periodo.ano, estado.periodo.mes + meses, 1);
  estado.periodo = { ano: d.getFullYear(), mes: d.getMonth() };
  renderizar();
}

function irParaHoje() {
  iniciarPeriodo();
  renderizar();
}

function renderizarPeriodo() {
  const p = estado.periodo;
  const seg = new Date(p.ano, p.mes + 1, 1);
  el('periodo').textContent =
    `${NOMES_MESES[p.mes]} de ${p.ano} · ${NOMES_MESES[seg.getMonth()]} de ${seg.getFullYear()}`;
}

function renderizarContas() {
  el('conta').innerHTML = estado.dados.contas
    .map(c => `<option value="${escapar(c.id)}">${escapar(c.nome)}</option>`)
    .join('');
  el('conta').value = estado.dados.contaAtiva;
}

// ---------- Agrupamento ----------

// id do lançamento -> categoria
function mapaCategorias(conta) {
  const mapa = {};
  conta.lancamentos.forEach(l => { mapa[l.id] = l.tipo; });
  return mapa;
}

// Por dia: total de cada categoria, descrições (tooltip) e se há saldo informado
function indexarDias(linhas, mapaCat) {
  const dias = {};
  linhas.forEach(l => {
    const d = dias[l.data] || (dias[l.data] = { totais: {}, descricoes: {}, referencia: false });

    if (l.ehReferencia) {
      d.referencia = true;
    } else {
      const cat = mapaCat[l.origemId] || 'saida';
      d.totais[cat] = arredondar((d.totais[cat] || 0) + Math.abs(l.movimento));
      d.descricoes[cat] = [...(d.descricoes[cat] || []), l.descricao + (l.rotulo ? ` (${l.rotulo})` : '')];
    }
  });
  return dias;
}

// ---------- Grade ----------

function tabelaMes(ano, mes, dias, linhas) {
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  const totais = {};
  CATEGORIAS.forEach(c => { totais[c.chave] = 0; });

  let corpo = '';
  for (let dia = 1; dia <= ultimo; dia++) {
    const iso = mesISO(ano, mes, dia);
    const d = dias[iso];
    const diaSemana = new Date(ano, mes, dia, 12).getDay();
    const fds = diaSemana === 0 || diaSemana === 6;

    const celulas = CATEGORIAS.map(c => {
      const valor = d ? (d.totais[c.chave] || 0) : 0;
      totais[c.chave] = arredondar(totais[c.chave] + valor);
      const titulo = d && d.descricoes[c.chave]
        ? ` title="${escapar(d.descricoes[c.chave].join('; '))}"`
        : '';
      return `<td class="${c.classe}" data-acao="celula" data-data="${iso}" data-categoria="${c.chave}"${titulo}>${valor ? formatarMoeda(valor) : ''}</td>`;
    }).join('');

    const saldo = saldoAtual(linhas, iso);
    const ref = d && d.referencia ? ' com-referencia' : '';

    corpo += `
      <tr class="${fds ? 'fds' : ''}">
        <td class="col-dia">${String(dia).padStart(2, '0')}<span class="semana">${SIGLAS_DIAS[diaSemana]}</span></td>
        ${celulas}
        <td class="col-saldo ${classeDeSaldo(saldo)}${ref}" data-acao="saldo" data-data="${iso}">${saldo === null ? '' : formatarMoeda(saldo)}</td>
      </tr>`;
  }

  const saldoFim = saldoAtual(linhas, mesISO(ano, mes, ultimo));

  const cabecalho = `
    <tr>
      <th class="col-dia">Dia</th>
      ${CATEGORIAS.map(c => `<th><span class="icone ${c.classe}">${c.letra}</span>${c.rotulo}</th>`).join('')}
      <th>Saldo</th>
    </tr>`;

  const rodape = `
    <tr>
      <th class="col-dia">Total</th>
      ${CATEGORIAS.map(c => `<th class="${c.classe}">${formatarMoeda(totais[c.chave])}</th>`).join('')}
      <th class="${classeDeSaldo(saldoFim)}">${saldoFim === null ? '—' : formatarMoeda(saldoFim)}</th>
    </tr>`;

  return `
    <section class="mes">
      <h3>${NOMES_MESES[mes]} de ${ano}</h3>
      <div class="tabela-wrap">
        <table class="planilha">
          <thead>${cabecalho}</thead>
          <tbody>${corpo}</tbody>
          <tfoot>${rodape}</tfoot>
        </table>
      </div>
    </section>`;
}

function renderizar() {
  renderizarContas();
  renderizarPeriodo();
  const conta = contaAtual();
  if (!conta) return;

  const linhas = calcularLinhas(conta.lancamentos, conta.referencias, dataLimite());
  const dias = indexarDias(linhas, mapaCategorias(conta));
  const p = estado.periodo;
  const seg = new Date(p.ano, p.mes + 1, 1);

  el('grade').innerHTML =
    tabelaMes(p.ano, p.mes, dias, linhas) +
    tabelaMes(seg.getFullYear(), seg.getMonth(), dias, linhas);

  const atual = saldoAtual(linhas);
  el('saldo-atual').textContent = atual === null
    ? 'Informe um saldo de referência'
    : formatarMoeda(atual);
}

// ---------- Modal ----------

function abrirModal(titulo, html) {
  el('modal-titulo').textContent = titulo;
  el('modal-corpo').innerHTML = html;
  el('modal').hidden = false;
  const primeiro = el('modal-corpo').querySelector('input:not([type="hidden"])');
  if (primeiro) primeiro.focus();
}

function fecharModal() {
  estado.modal = null;
  el('modal').hidden = true;
  el('modal-corpo').innerHTML = '';
}

// Textos e cor do botão principal (ex.: "adicionar saída", com a cor da categoria)
function definirBotoes(textoSalvar, textoCancelar, categoria) {
  const salvar = el('modal-form').querySelector('button[type="submit"]');
  salvar.textContent = textoSalvar;
  salvar.className = categoria ? categoriaInfo(categoria).classe : '';
  el('modal-cancelar').textContent = textoCancelar;
}

// Campo do formulário do modal, pelo atributo name
function campo(nome) {
  return el('modal-form').querySelector(`[name="${nome}"]`);
}

// Todos os lançamentos (ocorrências) de um dia, de todas as categorias
function itensDoDia(conta, data) {
  const itens = [];
  const ate = dataLimite();
  conta.lancamentos.forEach(l => {
    gerarOcorrencias(l, ate)
      .filter(o => o.data === data)
      .forEach(o => itens.push({ ...o, tipo: l.tipo, vinculacao: l.vinculacao }));
  });
  return itens;
}

function htmlListaDia(itens) {
  if (!itens.length) return '<p class="ajuda">Nenhum lançamento neste dia.</p>';
  return `
    <div class="lista-dia">
      <strong>Neste dia</strong>
      ${itens.map(o => {
        const extra = o.tipo === 'economia' && o.vinculacao ? ` · ${rotuloVinculacao(o.vinculacao)}` : '';
        return `
        <div class="item-dia">
          <span>${escapar(o.descricao)}${o.rotulo ? ` (${escapar(o.rotulo)})` : ''} · ${categoriaInfo(o.tipo).nomeForm}${extra}</span>
          <span>${formatarMoeda(Math.abs(o.valor))}</span>
          <button type="button" data-acao="editar-lanc" data-id="${escapar(o.origemId)}">Editar</button>
          <button type="button" class="perigo" data-acao="excluir-lanc" data-id="${escapar(o.origemId)}">Excluir</button>
        </div>`;
      }).join('')}
    </div>`;
}

// Formulário na ordem da referência: Valor, Categoria, [Vinculação], Descrição, Data, Frequência, Parcelas, Tags
function htmlFormLancamento(v) {
  const freq = v.frequencia || 'nao_repete';
  const ehEconomia = v.tipo === 'economia';

  const opcoesCategoria = CATEGORIAS
    .map(c => `<option value="${c.chave}" ${c.chave === v.tipo ? 'selected' : ''}>${c.nomeForm}</option>`)
    .join('');
  const opcoesVinculacao = `<option value="" ${v.vinculacao ? '' : 'selected'} disabled>escolha...</option>` +
    VINCULACOES.map(x => `<option value="${x.valor}" ${x.valor === v.vinculacao ? 'selected' : ''}>${x.texto}</option>`).join('');
  const opcoesFrequencia = FREQUENCIAS_FORM
    .map(f => `<option value="${f.valor}" ${f.valor === freq ? 'selected' : ''}>${f.texto}</option>`)
    .join('');

  return `
    <label class="form-linha valor-destaque">
      <span>Valor (R$)</span>
      <input name="valor" type="number" step="0.01" min="0.01" required placeholder="0,00" value="${v.valor ?? ''}">
    </label>
    <label class="form-linha">
      <span>Categoria</span>
      <select name="tipo">${opcoesCategoria}</select>
    </label>
    <label class="form-linha" data-campo="vinculacao" ${ehEconomia ? '' : 'hidden'}>
      <span>Vinculação</span>
      <select name="vinculacao">${opcoesVinculacao}</select>
    </label>
    <label class="form-linha">
      <span>Descrição</span>
      <input name="descricao" type="text" required placeholder="${categoriaInfo(v.tipo).nomeForm}" value="${escapar(v.descricao || '')}">
    </label>
    <label class="form-linha">
      <span>Data</span>
      <input name="data" type="date" required value="${v.data}">
    </label>
    <label class="form-linha">
      <span>Frequência</span>
      <select name="frequencia">${opcoesFrequencia}</select>
    </label>
    <label class="form-linha" data-campo="parcelas" ${freq === 'parcelado' ? '' : 'hidden'}>
      <span>Parcelas</span>
      <input name="parcelas" type="number" min="2" step="1" value="${v.parcelas && v.parcelas > 1 ? v.parcelas : 2}">
    </label>
    <label class="form-linha">
      <span>Tags</span>
      <input name="tags" type="text" placeholder="separe por vírgula" value="${escapar((v.tags || []).join(', '))}">
    </label>
    <p class="ajuda">Compra parcelada: o valor é o total. Editar ou excluir afeta todas as parcelas ou repetições.</p>`;
}

// Clique em uma célula: a categoria da célula vem selecionada, mas pode ser trocada
function abrirDia(data, categoria) {
  const conta = contaAtual();
  estado.modal = { tipo: 'lancamento', data, categoria, editandoId: null };

  abrirModal('adicionar', htmlListaDia(itensDoDia(conta, data)) + htmlFormLancamento({
    data, tipo: categoria, frequencia: 'nao_repete', parcelas: 2, tags: [], vinculacao: null
  }));
  definirBotoes(`adicionar ${categoriaInfo(categoria).nomeForm}`, 'cancelar', categoria);
}

function iniciarEdicaoLancamento(id) {
  const conta = contaAtual();
  const l = conta.lancamentos.find(x => x.id === id);
  if (!l) return;

  estado.modal.editandoId = id;
  abrirModal('editar', htmlListaDia(itensDoDia(conta, estado.modal.data)) + htmlFormLancamento({
    data: l.data,
    descricao: l.descricao,
    valor: l.valor,
    tipo: l.tipo,
    frequencia: frequenciaDe(l),
    parcelas: l.parcelas,
    tags: l.tags,
    vinculacao: l.vinculacao || null
  }));
  definirBotoes('salvar alteração', 'cancelar edição', l.tipo);
}

function salvarLancamento() {
  const conta = contaAtual();
  const frequencia = campo('frequencia').value;
  const tipo = campo('tipo').value;
  const vinculacao = tipo === 'economia' ? (campo('vinculacao').value || null) : null;

  if (tipo === 'economia' && !vinculacao) {
    alert('Em Economia, informe se é investimento ou caixinha.');
    return;
  }

  const lancamento = {
    id: estado.modal.editandoId || gerarId(),
    data: campo('data').value,
    descricao: campo('descricao').value.trim(),
    valor: Number(campo('valor').value), // valor total, se parcelado
    tipo,
    vinculacao,
    frequencia,
    parcelas: frequencia === 'parcelado' ? Number(campo('parcelas').value) : 1,
    tags: campo('tags').value.split(',').map(t => t.trim()).filter(Boolean)
  };

  const erro = validarLancamento(lancamento);
  if (erro) {
    alert(erro);
    return;
  }

  if (estado.modal.editandoId) {
    conta.lancamentos = conta.lancamentos.map(l => (l.id === lancamento.id ? lancamento : l));
  } else {
    conta.lancamentos.push(lancamento);
  }

  fecharModal();
  salvarEMostrar();
}

function excluirLancamento(id) {
  const conta = contaAtual();
  const l = conta.lancamentos.find(x => x.id === id);
  if (!l) return;

  const ehVarios = frequenciaDe(l) !== 'nao_repete';
  const aviso = ehVarios
    ? `Excluir "${l.descricao}" e todas as suas parcelas ou repetições?`
    : `Excluir "${l.descricao}"?`;
  if (!confirm(aviso)) return;

  conta.lancamentos = conta.lancamentos.filter(x => x.id !== id);
  fecharModal();
  salvarEMostrar();
}

// Clique na coluna Saldo
function abrirSaldo(data) {
  const conta = contaAtual();
  const existente = conta.referencias.find(r => r.data === data);
  estado.modal = { tipo: 'saldo', data, categoria: null, editandoId: null };

  abrirModal(`Saldo informado · ${dataBR(data)}`, `
    <p class="ajuda">Saldo no início do dia. Os lançamentos do mesmo dia são somados depois.</p>
    <div class="campos">
      <label>Valor (R$)
        <input name="valor" type="number" step="0.01" required value="${existente ? existente.valor : ''}">
      </label>
    </div>
    ${existente ? `
      <div class="lista-dia">
        <div class="item-dia">
          <span>Saldo informado neste dia</span>
          <button type="button" class="perigo" data-acao="excluir-saldo">Excluir saldo</button>
        </div>
      </div>` : ''}`);
  definirBotoes('salvar', 'cancelar', null);
}

function salvarSaldo() {
  const conta = contaAtual();
  const bruto = campo('valor').value;
  const valor = Number(bruto);

  if (bruto === '' || !Number.isFinite(valor)) {
    alert('Informe o valor do saldo.');
    return;
  }

  conta.referencias = salvarReferencia(conta.referencias, { data: estado.modal.data, valor });
  fecharModal();
  salvarEMostrar();
}

function excluirSaldo() {
  const conta = contaAtual();
  const data = estado.modal.data;
  if (!confirm(`Excluir o saldo informado de ${dataBR(data)}?`)) return;

  conta.referencias = conta.referencias.filter(r => r.data !== data);
  fecharModal();
  salvarEMostrar();
}

// Cancelar: em edição, volta ao formulário de inclusão do mesmo dia; senão, fecha
function cancelarModal() {
  if (estado.modal && estado.modal.editandoId) {
    abrirDia(estado.modal.data, estado.modal.categoria);
    return;
  }
  fecharModal();
}

function enviarModal(evento) {
  evento.preventDefault();
  if (!estado.modal) return;
  if (estado.modal.tipo === 'lancamento') salvarLancamento();
  else salvarSaldo();
}

// Mudanças dentro do formulário: mostra ou oculta Vinculação e Parcelas, e ajusta o botão
function mudancaNoFormulario(evento) {
  const alvo = evento.target;

  if (alvo.name === 'frequencia') {
    el('modal-form').querySelector('[data-campo="parcelas"]').hidden = alvo.value !== 'parcelado';
  }

  if (alvo.name === 'tipo') {
    el('modal-form').querySelector('[data-campo="vinculacao"]').hidden = alvo.value !== 'economia';
    if (estado.modal && !estado.modal.editandoId) {
      const info = categoriaInfo(alvo.value);
      definirBotoes(`adicionar ${info.nomeForm}`, 'cancelar', alvo.value);
      campo('descricao').placeholder = info.nomeForm;
    }
  }
}

// Cliques dentro do modal: Editar e Excluir da lista do dia
function cliqueModal(evento) {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao || !estado.modal) return;

  const acao = botao.dataset.acao;
  if (acao === 'editar-lanc') iniciarEdicaoLancamento(botao.dataset.id);
  if (acao === 'excluir-lanc') excluirLancamento(botao.dataset.id);
  if (acao === 'excluir-saldo') excluirSaldo();
}

// Cliques na grade: células de categoria e coluna Saldo
function cliqueGrade(evento) {
  const celula = evento.target.closest('td[data-acao]');
  if (!celula || !contaAtual()) return;

  if (celula.dataset.acao === 'celula') abrirDia(celula.dataset.data, celula.dataset.categoria);
  if (celula.dataset.acao === 'saldo') abrirSaldo(celula.dataset.data);
}

// ---------- Contas ----------

function criarConta() {
  const nome = el('nome-conta').value.trim();
  if (!nome) {
    alert('Informe o nome da conta.');
    return;
  }

  const nova = { id: gerarId(), nome, lancamentos: [], referencias: [] };
  estado.dados.contas.push(nova);
  estado.dados.contaAtiva = nova.id;
  el('nome-conta').value = '';
  salvarEMostrar();
}

// ---------- Tema ----------

function aplicarTema(tema) {
  document.body.dataset.tema = tema;
  localStorage.setItem(CHAVE_TEMA, tema);
  el('btn-tema').textContent = tema === 'escuro' ? 'Tema claro' : 'Tema escuro';
}

function alternarTema() {
  aplicarTema(document.body.dataset.tema === 'escuro' ? 'claro' : 'escuro');
}

// ---------- Exportar CSV ----------

function exportarCSV() {
  const conta = contaAtual();
  if (!conta) return;

  const linhas = calcularLinhas(conta.lancamentos, conta.referencias, dataLimite());
  const campoCSV = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const numero = v => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
  const mapaCat = mapaCategorias(conta);
  const mapaVinc = {};
  conta.lancamentos.forEach(l => { mapaVinc[l.id] = l.vinculacao || ''; });

  const cabecalho = ['Data', 'Descrição', 'Categoria', 'Vinculação', 'Movimento', 'Saldo', 'Tipo']
    .map(campoCSV).join(';');
  const corpo = linhas.map(l => [
    dataBR(l.data),
    l.ehReferencia ? 'Saldo informado' : l.descricao + (l.rotulo ? ` (${l.rotulo})` : ''),
    l.ehReferencia ? '' : categoriaInfo(mapaCat[l.origemId]).nomeForm,
    l.ehReferencia ? '' : rotuloVinculacao(mapaVinc[l.origemId]),
    numero(l.movimento),
    numero(l.saldo),
    l.ehReferencia ? 'Saldo' : 'Movimento'
  ].map(campoCSV).join(';'));

  // \uFEFF faz o Excel reconhecer acentos
  const texto = '\uFEFF' + [cabecalho, ...corpo].join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));

  const a = document.createElement('a');
  a.href = url;
  a.download = `painel-saldos-${conta.nome.replace(/[^\w-]+/g, '_')}-${hojeISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Inicialização ----------

function iniciar() {
  estado.dados = carregarDados();

  if (estado.dados.contas.length === 0) {
    const principal = { id: gerarId(), nome: 'Conta principal', lancamentos: [], referencias: [] };
    estado.dados.contas.push(principal);
    estado.dados.contaAtiva = principal.id;
  }
  if (!estado.dados.contas.some(c => c.id === estado.dados.contaAtiva)) {
    estado.dados.contaAtiva = estado.dados.contas[0].id;
  }

  iniciarPeriodo();
  aplicarTema(localStorage.getItem(CHAVE_TEMA) || 'claro');

  el('btn-mes-ant').addEventListener('click', () => deslocarPeriodo(-1));
  el('btn-mes-prox').addEventListener('click', () => deslocarPeriodo(1));
  el('btn-hoje').addEventListener('click', irParaHoje);
  el('btn-tema').addEventListener('click', alternarTema);
  el('btn-exportar').addEventListener('click', exportarCSV);
  el('btn-nova-conta').addEventListener('click', criarConta);

  el('conta').addEventListener('change', e => {
    estado.dados.contaAtiva = e.target.value;
    salvarEMostrar();
  });

  el('grade').addEventListener('click', cliqueGrade);
  el('modal-form').addEventListener('submit', enviarModal);
  el('modal-form').addEventListener('change', mudancaNoFormulario);
  el('modal-corpo').addEventListener('click', cliqueModal);
  el('modal-cancelar').addEventListener('click', cancelarModal);
  el('modal-x').addEventListener('click', fecharModal);
  el('modal').addEventListener('click', e => {
    if (e.target === el('modal')) fecharModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && estado.modal) fecharModal();
  });

  salvarEMostrar();
}

iniciar();