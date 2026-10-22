// dados.js — salvar e carregar dados no navegador.
// Não faz cálculos nem mexe na tela.

// Chave fixa e única. Não altere sem migrar os dados.
const CHAVE_ARMAZENAMENTO = 'painel_saldos_dados_v1';

// Se a leitura falhar, não sobrescrevemos os dados salvos.
let DADOS_COM_ERRO = false;

function dadosIniciais() {
  return { contaAtiva: null, contas: [] };
}

function gerarId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function carregarDados() {
  DADOS_COM_ERRO = false;
  const bruto = localStorage.getItem(CHAVE_ARMAZENAMENTO);
  if (!bruto) return dadosIniciais();

  try {
    const dados = JSON.parse(bruto);
    if (dados && Array.isArray(dados.contas)) return dados;
  } catch (e) {
    // cai no aviso abaixo
  }

  DADOS_COM_ERRO = true;
  alert('Não consegui ler os dados salvos. Eles não serão sobrescritos. Se possível, exporte um CSV antes de continuar.');
  return dadosIniciais();
}

function salvarDados(dados) {
  if (DADOS_COM_ERRO) return;
  localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(dados));
}