const API_URL = "https://script.google.com/macros/s/AKfycbylesg0ZL8qLXqQ7igUSJ3dF-t59QLeh7aJoawxgndTfDDsuP5bs_F9sjJ9P_4lyVVj/exec";

/* ================= ESTADO E CACHE ================= */
let db = { veiculos: [], manutencoes: [], limites: {}, alertas: [], agendamentos: [] };
let carregando = false;

const TIPOS = { 
  oleo: 'Troca de óleo', 
  alinhamento: 'Alinhamento', 
  oleo_caixa: 'Troca de óleo da caixa', 
  oleo_diferencial: 'Troca de óleo do diferencial' 
};
const TIPOS_RASTREADOS = ['oleo', 'alinhamento', 'oleo_caixa', 'oleo_diferencial'];
const LIMITES_PADRAO = {
  oleo: { modo: 'km_e_meses', km: 15000, meses: 12 }, 
  alinhamento: { modo: 'km_e_meses', km: 20000, meses: 6 },
  oleo_caixa: { modo: 'km_e_meses', km: 100000, meses: 24 }, 
  oleo_diferencial: { modo: 'km_e_meses', km: 100000, meses: 24 }
};
const LABEL_ULTIMA = { 
  oleo: 'Última troca de óleo', 
  alinhamento: 'Último alinhamento', 
  oleo_caixa: 'Último óleo da caixa', 
  oleo_diferencial: 'Último óleo do diferencial' 
};
const CACHE_KEY = 'frotaCacheV2';

function salvarCache() { 
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(db)); } catch(e) {} 
}

function carregarCache() {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (!c) return false;
    const dados = JSON.parse(c);
    if (!dados || !Array.isArray(dados.veiculos)) return false;
    db = dados;
    if (!Array.isArray(db.agendamentos)) db.agendamentos = [];
    db.veiculos.forEach(v => garantirLimites(v.placa));
    return true;
  } catch(e) { return false; }
}

/* ================= LOGIN E SESSÃO ================= */
async function fazerLogin() {
  const usuarioDigitado = document.getElementById("inputUsuario").value.trim();
  const senhaDigitada = document.getElementById("inputSenha").value.trim();
  const msgErro = document.getElementById("mensagemErro");
  if (!usuarioDigitado || !senhaDigitada) { msgErro.textContent = "Preencha usuário e senha!"; msgErro.style.display = "block"; return; }
  
  msgErro.style.display = "none";
  const btn = document.querySelector('.caixa-login button');
  btn.textContent = "Aguarde..."; btn.disabled = true;

  try {
    const resposta = await fetch(API_URL, {
      method: 'POST', body: JSON.stringify({ action: "login", data: { usuario: usuarioDigitado, senha: senhaDigitada } })
    });
    const resultado = await resposta.json();
    
    if (resultado.sucesso) {
      const dataHoje = new Date().toLocaleDateString('pt-BR');
      const perfilRetornado = resultado.perfil || 'admin'; // Proteção caso a API não envie
      
      localStorage.setItem("usuarioLogado", resultado.nomeUsuario);
      localStorage.setItem("dataLogin", dataHoje);
      localStorage.setItem("perfilUsuario", perfilRetornado); 
      
      liberarAcesso(resultado.nomeUsuario, perfilRetornado);
      toast("Bem-vindo(a), " + resultado.nomeUsuario + "!");
    } else {
      msgErro.textContent = "Usuário ou senha incorretos!";
      msgErro.style.display = "block";
    }
  } finally {
    btn.textContent = "Entrar no Sistema"; btn.disabled = false;
  }
}

function liberarAcesso(nome, perfil) {
  document.getElementById("telaLoginOverlay").style.display = "none";
  document.getElementById("nomeUsuarioTopo").textContent = "👤 " + nome;
  document.getElementById("btnSair").style.display = "inline-block";
  
  // Controle de Permissões: Oculta botões do menu se for mecânico
  if (perfil === 'mecanico') {
    document.querySelector('.navbtn[data-tab="cadastro"]').style.display = 'none';
    document.querySelector('.navbtn[data-tab="dashboard"]').style.display = 'none';
    // Força a navegação para a aba de Manutenção
    document.querySelector('.navbtn[data-tab="manutencao"]').click();
  } else {
    document.querySelector('.navbtn[data-tab="cadastro"]').style.display = 'inline-block';
    document.querySelector('.navbtn[data-tab="dashboard"]').style.display = 'inline-block';
  }
}

function fazerLogout() {
  localStorage.removeItem("usuarioLogado");
  localStorage.removeItem("dataLogin");
  localStorage.removeItem("perfilUsuario");
  location.reload();
}

function verificarSessao() {
  const usuario = localStorage.getItem("usuarioLogado");
  const dataLogin = localStorage.getItem("dataLogin");
  const perfil = localStorage.getItem("perfilUsuario");
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  if (!usuario || dataLogin !== dataHoje) {
    fazerLogout();
    return null;
  }
  return { usuario, perfil };
}

async function iniciar() {
  setInterval(() => { document.getElementById('dateNow').textContent = new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }, 60000);
  document.getElementById('dateNow').textContent = new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const sessao = verificarSessao();
  
  if (sessao && sessao.usuario) {
    liberarAcesso(sessao.usuario, sessao.perfil);
    if (carregarCache()) { 
      renderTelaAtual(); 
      carregarDoServidor(true).then(() => sincronizarAlertas(true)); 
    } else { 
      await carregarDoServidor(); 
      sincronizarAlertas(false); 
      renderTelaAtual(); 
    }
  } else {
    if (carregarCache()) { 
      carregarDoServidor(true).then(() => sincronizarAlertas(true)); 
    }
  }
}
// Troca as telas dentro da caixinha
function mostrarCadastro() {
  document.getElementById("formLogin").style.display = "none";
  document.getElementById("formCadastro").style.display = "block";
  document.getElementById("mensagemErro").style.display = "none";
}

function mostrarLogin() {
  document.getElementById("formCadastro").style.display = "none";
  document.getElementById("formLogin").style.display = "block";
  document.getElementById("mensagemErro").style.display = "none";
}

// Envia o pedido para o Google
async function solicitarAcesso() {
  const nome = document.getElementById("cadNome").value.trim();
  const usuario = document.getElementById("cadUsuario").value.trim();
  const senha = document.getElementById("cadSenha").value.trim();
  const msgErro = document.getElementById("mensagemErro");

  if (!nome || !usuario || !senha) {
    msgErro.textContent = "Preencha todos os campos!";
    msgErro.style.display = "block";
    return;
  }

  msgErro.style.display = "none";
  const btn = document.getElementById("btnCadastrar");
  btn.textContent = "Enviando pedido...";
  btn.disabled = true;

  try {
    const resposta = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: "requestRegistration",
        data: { nome, usuario, senha }
      })
    });
    
    const resultado = await resposta.json();
    
    if (resultado.sucesso) {
      alert("✅ Pedido enviado! Aguarde a aprovação do administrador para conseguir fazer login.");
      // Limpa os campos e volta pro login
      document.getElementById("cadNome").value = "";
      document.getElementById("cadUsuario").value = "";
      document.getElementById("cadSenha").value = "";
      mostrarLogin();
    }
  } catch (erro) {
    msgErro.textContent = "Erro ao enviar pedido.";
    msgErro.style.display = "block";
  } finally {
    btn.textContent = "Solicitar Aprovação";
    btn.disabled = false;
  }
}

/* ================= FILA E COMUNICAÇÃO OTIMIZADA ================= */
let _fila = Promise.resolve();
function enfileirar(fn) {
  const p = _fila.then(fn);
  _fila = p.catch(() => {});
  return p;
}

function setLoading(v) {
  carregando = v;
  document.getElementById('loadingOverlay').classList.toggle('show', v);
}

function execBackground(asyncFn, failMsg) {
  asyncFn().catch(e => {
    console.error(e);
    toast(failMsg + '. Recarregando dados oficiais...', true);
    carregarDoServidor(true).then(() => renderTelaAtual());
  });
}

async function apiGet() {
  return enfileirar(async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(API_URL + '?action=getAll');
        if (res.ok) return res.json();
      } catch(e) { 
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
      }
    }
    throw new Error('Falha de conexão.');
  });
}

async function apiPost(action, data) {
  return enfileirar(async () => {
    const res = await fetch(API_URL, { 
      method: 'POST', 
      body: JSON.stringify({ action, data }) 
    });
    if (!res.ok) throw new Error('Falha ao enviar dados para a planilha.');
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  });
}

function normalizarDadosDaPlanilha(raw) {
  const veiculos = (raw.veiculos || []).map(v => ({ 
    placa: String(v.placa).trim().toUpperCase(), 
    kmAtual: Number(v.kmAtual) || 0 
  }));
  
  const manutencoes = (raw.manutencoes || []).map(m => ({
    id: String(m.id), 
    placa: String(m.placa).trim().toUpperCase(), 
    tipo: String(m.tipo || '').trim().toLowerCase(),
    descricao: String(m.descricao || m['descrição'] || m['Descricao'] || m['Descrição'] || m['descriçao'] || m['Descriçao'] || '').trim(),
    km: Number(m.km) || 0, 
    data: formatarDataPlanilhaParaISO(m.data), 
    valor: Number(m.valor) || 0, 
    observacao: m.observacao || '',
    nome: m.nome || m['Nome'] || m.responsavel || '' 
  }));

 
  const limites = {};
  (raw.limites || []).forEach(l => {
    const p = String(l.placa).trim().toUpperCase();
    if (!limites[p]) limites[p] = {};
    limites[p][String(l.tipo || '').trim()] = { 
      modo: l.modo, 
      km: Number(l.km) || 0, 
      meses: Number(l.meses) || 0 
    };
  });
  
  const alertas = (raw.alertas || []).map(a => ({
    id: String(a.id), 
    placa: String(a.placa).trim().toUpperCase(), 
    tipo: String(a.tipo || '').trim(), 
    status: a.status || 'ativo',
    dataAnalise: a.dataAnalise ? formatarDataPlanilhaParaISO(a.dataAnalise) : null, 
    dataResolucao: a.dataResolucao ? formatarDataPlanilhaParaISO(a.dataResolucao) : null
  }));
  
  const agendamentos = (raw.agendamentos || []).map(a => ({
    id: String(a.id), 
    placa: String(a.placa).trim().toUpperCase(), 
    tipo: String(a.tipo || '').trim(),
    descricao: a.descricao || a['descrição'] || a['Descricao'] || a['Descrição'] || a['descriçao'] || a['Descriçao'] || '',
    dataPrevista: a.dataPrevista ? formatarDataPlanilhaParaISO(a.dataPrevista) : '', 
    valor: Number(a.valor) || 0,
    observacao: a.observacao || '', 
    criadoEm: a.criadoEm ? formatarDataPlanilhaParaISO(a.criadoEm) : '',
    nome: a.nome || a['Nome'] || a.responsavel || ''
  }));

  manutencoes.forEach(m => {
    if (m.tipo !== 'outro' || m.descricao) return;
    const alerta = alertas.find(a => a.placa === m.placa && a.status === 'resolvido' && a.dataResolucao === m.data && a.tipo && !TIPOS[a.tipo]);
    if (alerta) m.descricao = String(alerta.tipo).trim();
  });
  
  return { veiculos, manutencoes, limites, alertas, agendamentos };
}

function formatarDataPlanilhaParaISO(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  const d = new Date(valor);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function carregarDoServidor(silencioso) {
  if (!silencioso) setLoading(true);
  try {
    const raw = await apiGet();
    db = normalizarDadosDaPlanilha(raw);
    db.veiculos.forEach(v => garantirLimites(v.placa));
    salvarCache();
  } catch(e) {
    if (!silencioso) toast('Erro ao carregar dados da planilha: ' + e.message, true);
  } finally {
    if (!silencioso) setLoading(false);
  }
}

function garantirLimites(placa) {
  if (!db.limites[placa]) db.limites[placa] = {};
  TIPOS_RASTREADOS.forEach(t => { 
    if (!db.limites[placa][t]) db.limites[placa][t] = Object.assign({}, LIMITES_PADRAO[t]); 
  });
}

function gerarId() { 
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); 
}

/* ================= UTILIDADES ================= */
function fmtData(iso) { 
  if (!iso) return '-'; 
  const [a, m, d] = iso.split('-'); 
  return `${d}/${m}/${a}`; 
}
function dataHoraAtual() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function hojeISO() { return new Date().toISOString().split('T')[0]; }

function hojeLocal() { 
  const d = new Date(); 
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); 
}

function fmtMoeda(v) { 
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); 
}

function fmtKm(v) { 
  return (v || 0).toLocaleString('pt-BR') + ' km'; 
}

function parseNumeroBR(str) {
  if (str === null || str === undefined) return NaN;
  let s = String(str).trim();
  if (s === '') return NaN;
  return Number(s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
}

function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 3500);
}

function addMeses(iso, meses) { 
  const d = new Date(iso + 'T00:00:00'); 
  d.setMonth(d.getMonth() + meses); 
  return d.toISOString().split('T')[0]; 
}

function normalizarPlaca(p) { return p.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function placaValida(p) { return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function nomeTipo(t) { return TIPOS[t] || t; }

function nomeManutencao(item) {
  const tipo = String(item?.tipo || '').trim().toLowerCase();
  if (tipo === 'outro') {
    return String(item?.descricao || item?.['descrição'] || item?.['Descricao'] || item?.['Descrição'] || '').trim() || 'Outro';
  }
  return TIPOS[tipo] || item?.tipo || 'Outro';
}

/* ================= NAVEGAÇÃO ================= */
function renderTelaAtual() {
  const tabAtiva = document.querySelector('.navbtn.active').dataset.tab;
  if (tabAtiva === 'manutencao') { 
    if (veiculoSel) renderDetalhe(); 
    else renderManutTab(); 
  }
  else if (tabAtiva === 'dashboard') renderDashboard();
  else if (tabAtiva === 'alertas') renderAlertas();
  else if (tabAtiva === 'cadastro') renderCadastro();
}

document.querySelectorAll('.navbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderTelaAtual();
  });
});

async function atualizarManualmente() {
  const btn = document.getElementById('btnAtualizar');
  btn.disabled = true;
  await carregarDoServidor();
  sincronizarAlertas(false); 
  renderTelaAtual();
  toast('Dados sincronizados da nuvem.');
  btn.disabled = false;
}

/* ================= ABA 1: CADASTRO ================= */
function cadastrarVeiculo() {
  const input = document.getElementById('inputPlaca');
  const err = document.getElementById('errPlaca');
  err.textContent = ''; 
  input.classList.remove('err');
  const placa = normalizarPlaca(input.value);
  
  if (!placa) { err.textContent = 'Informe a placa do veículo.'; input.classList.add('err'); return; }
  if (!placaValida(placa)) { err.textContent = 'Placa inválida.'; input.classList.add('err'); return; }
  if (db.veiculos.some(v => v.placa === placa)) { err.textContent = 'Veículo já cadastrado.'; input.classList.add('err'); return; }

  db.veiculos.push({ placa, kmAtual: 0 });
  garantirLimites(placa);
  salvarCache();
  input.value = '';
  renderCadastro();
  toast('Sincronizando novo veículo...');

  execBackground(async () => {
    await apiPost('addVeiculo', { placa });
    sincronizarAlertas(true); 
  }, 'Erro ao salvar na planilha');
}

function excluirVeiculo(placa) {
  document.getElementById('confirmTitle').textContent = 'Excluir veículo';
  document.getElementById('confirmMsg').textContent = 'Tem certeza de que deseja excluir o veículo ' + placa + '?';
  const btn = document.getElementById('confirmBtn');
  
  btn.onclick = () => {
    closeModal('modalConfirm');
    db.veiculos = db.veiculos.filter(v => v.placa !== placa);
    db.manutencoes = db.manutencoes.filter(m => m.placa !== placa);
    db.agendamentos = db.agendamentos.filter(a => a.placa !== placa);
    db.alertas = db.alertas.filter(a => a.placa !== placa);
    salvarCache();
    renderCadastro();
    toast('Excluindo veículo...');

    execBackground(async () => { 
      await apiPost('deleteVeiculo', { placa }); 
    }, 'Erro ao excluir veículo');
  };
  openModal('modalConfirm');
}

function renderCadastro() {
  const el = document.getElementById('listaCadastro');
  if (db.veiculos.length === 0) { 
    el.innerHTML = '<div class="empty">Nenhum veículo cadastrado.</div>'; 
    return; 
  }
  let html = '<table><thead><tr><th>Placa</th><th>Km atual</th><th>Total gasto</th><th>Manutenções</th><th>Ações</th></tr></thead><tbody>';
  db.veiculos.forEach(v => {
    const ms = db.manutencoes.filter(m => m.placa === v.placa);
    const total = ms.reduce((s, m) => s + m.valor, 0);
    html += `<tr><td><b>${v.placa}</b></td><td>${fmtKm(v.kmAtual)}</td><td>${fmtMoeda(total)}</td><td>${ms.length}</td><td><button class="btn danger small" onclick="excluirVeiculo('${v.placa}')">Excluir</button></td></tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ================= ABA 2: MANUTENÇÃO ================= */
let veiculoSel = null;
let manutEditId = null;
let resolverAlertaId = null; 
let resolverAgendamentoId = null;

function statusVeiculo(placa) {
  const al = db.alertas.filter(a => a.placa === placa && a.status !== 'resolvido');
  if (al.some(a => a.status === 'ativo')) return 'atrasado';
  if (al.some(a => a.status === 'analise')) return 'analise';
  return 'ok';
}

function renderManutTab() {
  veiculoSel = null;
  document.getElementById('manutDetalheWrap').style.display = 'none';
  document.getElementById('manutListaWrap').style.display = 'block';
  const wrap = document.getElementById('chipsVeiculos');
  
  if (db.veiculos.length === 0) { 
    wrap.innerHTML = '<div class="empty">Nenhum veículo cadastrado.</div>'; 
    return; 
  }
  
  wrap.innerHTML = db.veiculos.map(v => {
    const st = statusVeiculo(v.placa);
    const cor = st === 'atrasado' ? 'var(--danger)' : (st === 'analise' ? 'var(--warning)' : 'var(--success)');
    
    // O sistema analisa o 5º dígito. Se for letra, é Mercosul. Se for número, é Antiga.
    const isMercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(v.placa);
    const classePlaca = isMercosul ? 'mercosul' : 'antiga';
    const nomeTopo = isMercosul ? 'BRASIL' : 'TRANSMARINA';

    return `
      <div class="placa-veiculo ${classePlaca}" onclick="selecionarVeiculo('${v.placa}')">
        <div class="placa-status-dot" style="background:${cor}"></div>
        <div class="placa-topo">${nomeTopo}</div>
        <div class="placa-numero">${v.placa}</div>
      </div>`;
  }).join('');
}

function selecionarVeiculo(placa) {
  veiculoSel = placa;
  document.getElementById('manutListaWrap').style.display = 'none';
  document.getElementById('manutDetalheWrap').style.display = 'block';
  renderDetalhe();
}

function ultimaManut(placa, tipo) { 
  return db.manutencoes.filter(m => m.placa === placa && m.tipo === tipo).sort((a, b) => new Date(b.data) - new Date(a.data))[0] || null; 
}

function calcularLimite(placa, tipo) {
  garantirLimites(placa);
  const cfg = db.limites[placa][tipo];
  if (!cfg) return null;
  const ult = ultimaManut(placa, tipo);
  if (!ult) return { temUltima: false, cfg };
  return { 
    temUltima: true, 
    ultima: ult, 
    limiteKm: cfg.modo !== 'meses' ? ult.km + Number(cfg.km) : null, 
    limiteData: cfg.modo !== 'km' ? addMeses(ult.data, Number(cfg.meses)) : null, 
    cfg 
  };
}

function verificarAlerta(placa, tipo) {
  const info = calcularLimite(placa, tipo);
  if (!info) return null;
  if (!info.temUltima) return { deveAlertar: true, semHistorico: true, info };
  
  const v = db.veiculos.find(x => x.placa === placa);
  const kmAtual = v ? v.kmAtual : 0;
  const hoje = hojeISO();
  
  let excedKm = false, excedTempo = false;
  if (info.limiteKm !== null && kmAtual >= info.limiteKm) excedKm = true;
  if (info.limiteData !== null && hoje >= info.limiteData) excedTempo = true;
  
  let deveAlertar = info.cfg.modo === 'km' ? excedKm : (info.cfg.modo === 'meses' ? excedTempo : (excedKm || excedTempo));
  return { deveAlertar, excedKm, excedTempo, info, kmAtual, hoje };
}

function sincronizarAlertas(bgSync = true) {
  const paraAdicionar = [], idsParaRemover = [];
  for (const v of db.veiculos) {
    for (const tipo of TIPOS_RASTREADOS) {
      const check = verificarAlerta(v.placa, tipo);
      const abertoExistente = db.alertas.find(a => a.placa === v.placa && a.tipo === tipo && a.status !== 'resolvido');

      if (check && check.deveAlertar) {
        if (!abertoExistente) {
          const resolvidos = db.alertas.filter(a => a.placa === v.placa && a.tipo === tipo && a.status === 'resolvido' && a.dataResolucao).sort((a, b) => new Date(b.dataResolucao) - new Date(a.dataResolucao));
          const ultResolvido = resolvidos[0];
          let deveRecriar = true;
          if (ultResolvido) deveRecriar = db.manutencoes.some(m => m.placa === v.placa && m.tipo === tipo && m.data >= ultResolvido.dataResolucao);
          if (deveRecriar) paraAdicionar.push({ id: gerarId(), placa: v.placa, tipo, status: 'ativo', dataAnalise: null, dataResolucao: null });
        }
      } else if (abertoExistente) {
        idsParaRemover.push(abertoExistente.id);
      }
    }
  }

  if (paraAdicionar.length === 0 && idsParaRemover.length === 0) return;

  db.alertas = db.alertas.filter(a => !idsParaRemover.includes(a.id));
  db.alertas.push(...paraAdicionar);
  salvarCache();
  
  if (bgSync) {
    execBackground(async () => {
      try { 
        await apiPost('syncAlertas', { adicionar: paraAdicionar, remover: idsParaRemover });
      } catch(e) {
        for (const id of idsParaRemover) await apiPost('deleteAlerta', { id });
        for (const a of paraAdicionar) await apiPost('addAlerta', a);
      }
    }, 'Falha oculta na sincronização de alertas');
  }
}

function renderDetalhe() {
  const placa = veiculoSel;
  const v = db.veiculos.find(x => x.placa === placa);
  if (!v) return;
  
  garantirLimites(placa);
  const ms = db.manutencoes.filter(m => m.placa === placa).sort((a, b) => new Date(b.data) - new Date(a.data));
  const total = ms.reduce((s, m) => s + m.valor, 0);
  const agends = db.agendamentos.filter(a => a.placa === placa);
  const cfg = db.limites[placa];

  const proximoLimiteTexto = (tipo) => {
    const info = calcularLimite(placa, tipo);
    if (!info || !info.temUltima) return 'Sem histórico';
    if (info.limiteKm !== null) {
      const falta = info.limiteKm - v.kmAtual;
      return falta >= 0 ? `${fmtKm(info.limiteKm)} (faltam ${fmtKm(falta)})` : `${fmtKm(info.limiteKm)} (excedido há ${fmtKm(-falta)})`;
    }
    return info.limiteData !== null ? fmtData(info.limiteData) : '-';
  };

  const cardsTipos = TIPOS_RASTREADOS.map(t => {
    const ult = ultimaManut(placa, t);
    return `<div class="kpi"><div class="label">${LABEL_ULTIMA[t]}</div><div class="value" style="font-size:15px;">${ult ? fmtData(ult.data) + ' · ' + fmtKm(ult.km) : 'Sem registro'}</div></div>`;
  }).join('');

 const perfil = localStorage.getItem("perfilUsuario") || "admin";
  const isAdmin = perfil !== "mecanico";

  // Identifica o padrão da placa selecionada
  const isMercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placa);
  const classePlaca = isMercosul ? 'mercosul' : 'antiga';
  const nomeTopo = isMercosul ? 'BRASIL' : 'TRANSMARINA';

  document.getElementById('manutDetalheWrap').innerHTML = `
    <div class="back" onclick="renderManutTab()">← Voltar para lista de veículos</div>
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        
        <div class="veiculo-header-info">
          <!-- A Placa Gráfica -->
          <div class="placa-veiculo ${classePlaca}" style="cursor:default; margin:0;">
            <div class="placa-topo">${nomeTopo}</div>
            <div class="placa-numero">${placa}</div>
          </div>
          
          <!-- O KM puxando a formatação do CSS -->
          <div class="veiculo-km-box">
            <span class="veiculo-km-label">Km atual:</span> 
            <span class="veiculo-km-valor">${fmtKm(v.kmAtual)}</span>
          </div>
        </div>

        <div style="display:flex; gap:8px;">
          ${isAdmin ? `<button class="btn secondary" onclick="abrirModalKm('${placa}')">Atualizar KM</button>` : ''}
          <button class="btn" onclick="abrirModalManut('${placa}')">Marcar manutenção</button>
        </div>
      </div>
    </div>

    ${isAdmin ? `
    <div class="grid-cards">
      <div class="kpi"><div class="label">Total gasto</div><div class="value">${fmtMoeda(total)}</div></div>
      <div class="kpi"><div class="label">Nº manutenções</div><div class="value">${ms.length}</div></div>
      ${cardsTipos}
    </div>
    ` : ''}

    ${isAdmin ? `
    <div class="card">
      <h2>Configuração de alertas</h2>
      <div class="alert-config-container">
        ${TIPOS_RASTREADOS.map(tipo => `
          <div class="limitbox">
            <div style="font-weight:bold;margin-bottom:8px;">${TIPOS[tipo]}</div>
            <div class="row"><div class="field"><label>Critério</label>
              <select onchange="atualizarCfg('${placa}','${tipo}','modo',this.value)">
                <option value="km" ${cfg[tipo].modo === 'km' ? 'selected' : ''}>Somente km</option>
                <option value="meses" ${cfg[tipo].modo === 'meses' ? 'selected' : ''}>Somente meses</option>
                <option value="km_e_meses" ${cfg[tipo].modo === 'km_e_meses' ? 'selected' : ''}>O que vencer primeiro</option>
              </select>
            </div></div>
            <div class="row" style="margin-top:8px;">
              <div class="field"><label>A cada (km)</label><input type="number" min="0" value="${cfg[tipo].km}" onchange="atualizarCfg('${placa}','${tipo}','km',this.value)"></div>
              <div class="field"><label>A cada (meses)</label><input type="number" min="0" value="${cfg[tipo].meses}" onchange="atualizarCfg('${placa}','${tipo}','meses',this.value)"></div>
            </div>
            <div style="margin-top:8px;font-size:12px;color:var(--dim);">Próximo: <b style="color:var(--text)">${proximoLimiteTexto(tipo)}</b></div>
          </div>`).join('')}
      </div>
    </div>
    ` : ''}
    
    <!-- O restante do código do histórico continua igual abaixo disso -->
    <div class="card">
      <div class="header-tabela">
        <h2>Histórico</h2>
        <input type="text" id="filtroHistorico" placeholder="🔎 Pesquisar manutenção..." onkeyup="filtrarHistorico()">
      </div>
      <table id="tabelaHistorico">
        <thead><tr><th>Tipo</th><th>Data</th><th>Km</th><th>Valor</th><th>Obs</th><th>Ações</th></tr></thead>
        <tbody>
          ${ms.map(m => `<tr title="👤 Última alteração: ${m.nome || 'Não identificado'}">
            <td>${nomeManutencao(m)}</td>
            <td>${fmtData(m.data)}</td>
            <td>${fmtKm(m.km)}</td>
            <td>${fmtMoeda(m.valor)}</td>
            <td>${m.observacao || '-'}</td>
            <td>
              <button class="btn secondary small" onclick="editarManutencao('${m.id}')">Editar</button> 
              <button class="btn danger small" onclick="excluirManutencao('${m.id}')">Excluir</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${agends.length ? `
    <div class="card">
      <h2>Agendadas</h2>
      <table><thead><tr><th>Tipo</th><th>Previsão</th><th>Valor</th><th>Obs</th><th>Ações</th></tr></thead>
      <tbody>${agends.map(g => `<tr title="👤 Registrado por: ${g.nome || 'Não identificado'}"><td>${nomeManutencao(g)}</td><td>${g.dataPrevista ? fmtData(g.dataPrevista) : '-'}</td><td>${g.valor ? fmtMoeda(g.valor) : '-'}</td><td>${g.observacao || '-'}</td>
        <td>
          <button class="btn success small" onclick="resolverAgendamento('${g.id}')">Resolvido</button> 
          <button class="btn secondary small" onclick="editarAgendamento('${g.id}')">Editar</button> 
          <button class="btn danger small" onclick="cancelarAgendamento('${g.id}')">Cancelar</button>
        </td></tr>`).join('')}</tbody></table>
    </div>` : ''}
  `;
}

function atualizarCfg(placa, tipo, campo, valor) {
  garantirLimites(placa);
  if (campo === 'modo') db.limites[placa][tipo].modo = valor; 
  else db.limites[placa][tipo][campo] = Number(valor) || 0;
  
  salvarCache(); 
  renderDetalhe(); 
  sincronizarAlertas(false);
  execBackground(async () => { 
    await apiPost('updateLimite', { 
      placa, 
      tipo, 
      modo: db.limites[placa][tipo].modo, 
      km: db.limites[placa][tipo].km, 
      meses: db.limites[placa][tipo].meses 
    }); 
  }, 'Erro configuração');
}

function abrirModalKm(placa) {
  veiculoSel = placa;
  const v = db.veiculos.find(x => x.placa === placa);
  document.getElementById('kmAtualInput').value = v.kmAtual > 0 ? Number(v.kmAtual).toLocaleString('pt-BR') : '';
  document.getElementById('errKmAtual').textContent = '';
  openModal('modalKm');
}

function salvarKmAtual() {
  const input = document.getElementById('kmAtualInput');
  const val = parseNumeroBR(input.value);
  if (isNaN(val) || val < 0) { 
    input.classList.add('err'); 
    return; 
  }
  
  closeModal('modalKm');
  const v = db.veiculos.find(x => x.placa === veiculoSel);
  if (v) v.kmAtual = val;
  salvarCache(); 
  renderDetalhe(); 
  sincronizarAlertas(false);
  toast('Sincronizando KM...');

  execBackground(async () => { 
    await apiPost('updateKmVeiculo', { placa: veiculoSel, kmAtual: val }); 
  }, 'Erro ao salvar KM');
}

function onTipoChange() { 
  document.getElementById('mDescricaoWrap').style.display = document.getElementById('mTipo').value === 'outro' ? 'block' : 'none'; 
}

function onModoChange() { 
  const ag = document.getElementById('mModo').value === 'agendar'; 
  document.getElementById('mKmDataRow').style.display = ag ? 'none' : ''; 
  document.getElementById('mDataPrevistaWrap').style.display = ag ? 'block' : 'none'; 
}

function abrirModalManut(placa, manut, modo) {
  veiculoSel = placa; 
  manutEditId = manut ? manut.id : null;
  
  document.getElementById('manutTitle').textContent = (manut ? 'Editar' : 'Marcar') + ' manutenção — ' + placa;
  document.getElementById('mModo').value = modo || 'realizada'; 
  document.getElementById('mModo').disabled = !!manut;
  document.getElementById('mTipo').value = manut ? manut.tipo : ''; 
  document.getElementById('mDescricao').value = manut ? (manut.descricao || '') : '';
  
  // Aqui está a correção: Exibe o km formatado com pontos (ex: 400.000)
  document.getElementById('mKm').value = (manut && manut.km > 0) ? Number(manut.km).toLocaleString('pt-BR') : ''; 
  
  document.getElementById('mData').value = manut ? manut.data : hojeISO(); 
  document.getElementById('mDataPrevista').value = '';
  document.getElementById('mValor').value = manut ? manut.valor : ''; 
  document.getElementById('mObs').value = manut ? (manut.observacao || '') : '';
  
  onModoChange(); 
  onTipoChange(); 
  
  // O carimbo de quem está logado ou quem editou
  const infoEdicao = document.getElementById('infoEdicao');
 if (manut) {
    infoEdicao.textContent = "👤 Última alteração: " + (manut.nome || "Não identificado");
  } else {
    infoEdicao.textContent = "👤 Lançando como: " + (localStorage.getItem("usuarioLogado") || "Desconhecido");
  }
  
  openModal('modalManut');
}

function resolverAgendamento(id) {
  const ag = db.agendamentos.find(a => a.id === id); 
  if (!ag) return;
  const v = db.veiculos.find(x => x.placa === ag.placa);
  
 const nomeUsuario = (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")";
  
  const registro = { 
    id: gerarId(), 
    placa: ag.placa, 
    tipo: ag.tipo, 
    descricao: String(ag.descricao || '').trim(), 
    km: v ? v.kmAtual : 0, 
    data: ag.dataPrevista || hojeISO(), 
    valor: Number(ag.valor) || 0, 
    observacao: ag.observacao || '',
    nome: nomeUsuario 
  };
  
  db.manutencoes.push(registro);
  db.agendamentos = db.agendamentos.filter(a => a.id !== ag.id);
  
  const tipoA = ag.tipo === 'outro' ? (ag.descricao || 'outro') : ag.tipo;
  const ex = db.alertas.find(a => a.placa === ag.placa && a.tipo === tipoA && a.status !== 'resolvido');
  if (!ex) {
    db.alertas.push({ id: gerarId(), placa: ag.placa, tipo: tipoA, status: 'resolvido', dataAnalise: null, dataResolucao: registro.data });
  } else {
    ex.status = 'resolvido';
    ex.dataResolucao = registro.data;
  }
  
  salvarCache(); 
  renderTelaAtual(); 
  sincronizarAlertas(false); 
  toast('Resolvido e salvo no histórico! Sincronizando...');
  
  execBackground(async () => {
    await apiPost('addManutencao', registro);
    await apiPost('deleteAgendamento', { id: ag.id });
    if(ex) await apiPost('updateAlerta', { id: ex.id, status: 'resolvido', dataAnalise: null, dataResolucao: registro.data });
    sincronizarAlertas(true);
  }, 'Erro ao resolver');
}

function salvarManutencao() {
  const modo = document.getElementById('mModo').value;
  const tipo = document.getElementById('mTipo').value;
  const descricao = document.getElementById('mDescricao').value.trim();
  const kmInput = document.getElementById('mKm').value.trim();
  const data = document.getElementById('mData').value;
  const dataPrevista = document.getElementById('mDataPrevista').value;
  
  // Aqui está a correção 1: Traduz o texto "400.000" para número matemático real
  const kmParsed = parseNumeroBR(kmInput);

  if (!tipo || (tipo === 'outro' && !descricao) || (modo !== 'agendar' && (!data || (kmInput !== '' && (isNaN(kmParsed) || kmParsed <= 0))))) {
    return toast('Preencha os campos corretamente', true);
  }

  closeModal('modalManut');
  const placa = veiculoSel;
  const v = db.veiculos.find(x => x.placa === placa);
  
  // Usa o valor traduzido
  const km = kmInput !== '' ? kmParsed : (v ? v.kmAtual : 0);
  
  const editando = !!manutEditId;
  const nomeUsuario = (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")";
  
  if (modo === 'agendar') {
    const agOriginal = editando ? db.agendamentos.find(a => a.id === manutEditId) : null;
    const ag = { 
      id: editando ? manutEditId : gerarId(), 
      placa, 
      tipo, 
      descricao, 
      dataPrevista, 
      valor: Number(document.getElementById('mValor').value) || 0, 
      observacao: document.getElementById('mObs').value.trim(), 
      criadoEm: agOriginal ? agOriginal.criadoEm : hojeISO(),
      nome: nomeUsuario // <--- Aqui está a correção 2: Agora o agendamento tem a assinatura!
    };
    
    if (editando) {
      const idx = db.agendamentos.findIndex(a => a.id === manutEditId);
      if (idx >= 0) db.agendamentos[idx] = ag;
    } else {
      db.agendamentos.push(ag); 
    }
    
    salvarCache(); 
    renderTelaAtual(); 
    toast(editando ? 'Agendamento atualizado. Sincronizando...' : 'Agendamento salvo. Sincronizando...');
    
    execBackground(async () => { 
      try {
        await apiPost(editando ? 'updateAgendamento' : 'addAgendamento', ag); 
      } catch(e) {
        if (editando) {
          await apiPost('deleteAgendamento', { id: ag.id });
          await apiPost('addAgendamento', ag);
        } else throw e;
      }
    }, 'Erro ao salvar agendamento');
    return;
  }

  const registro = { 
    id: editando ? manutEditId : gerarId(), 
    placa, 
    tipo, 
    descricao: tipo === 'outro' ? descricao : '', 
    km, 
    data, 
    valor: Number(document.getElementById('mValor').value) || 0, 
    observacao: document.getElementById('mObs').value.trim(),
    nome: nomeUsuario 
  };
  
  const agCumpridos = db.agendamentos.filter(a => a.placa === placa && a.tipo === tipo && (tipo !== 'outro' || (a.descricao || '').trim().toLowerCase() === descricao.toLowerCase()));

  if (editando) { 
    const idx = db.manutencoes.findIndex(m => m.id === manutEditId); 
    if (idx >= 0) db.manutencoes[idx] = registro; 
  } else {
    db.manutencoes.push(registro);
  }
  
  db.agendamentos = db.agendamentos.filter(a => !agCumpridos.includes(a));
  if (v && km > v.kmAtual) v.kmAtual = km;
  
  salvarCache(); 
  renderDetalhe(); 
  sincronizarAlertas(false); 
  toast('Manutenção salva. Sincronizando...');

  execBackground(async () => {
    await apiPost(editando ? 'updateManutencao' : 'addManutencao', registro);
    for (const ag of agCumpridos) await apiPost('deleteAgendamento', { id: ag.id });
    if (v && km > v.kmAtual) await apiPost('updateKmVeiculo', { placa, kmAtual: km });
    sincronizarAlertas(true);
  }, 'Erro ao salvar manutenção');
}

function editarManutencao(id) { 
  abrirModalManut(veiculoSel, db.manutencoes.find(m => m.id === id)); 
}


function editarAgendamento(id) {
  const ag = db.agendamentos.find(a => a.id === id); 
  if (!ag) return;
  
  veiculoSel = ag.placa; 
  manutEditId = ag.id;
  resolverAlertaId = null;
  resolverAgendamentoId = null;
  
  document.getElementById('manutTitle').textContent = 'Editar agendamento — ' + ag.placa;
  document.getElementById('mModo').value = 'agendar'; 
  document.getElementById('mModo').disabled = true;
  document.getElementById('mTipo').value = ag.tipo; 
  document.getElementById('mDescricao').value = ag.descricao || '';
  document.getElementById('mKm').value = ''; 
  document.getElementById('mData').value = hojeISO(); 
  document.getElementById('mDataPrevista').value = ag.dataPrevista || '';
  document.getElementById('mValor').value = ag.valor || ''; 
  document.getElementById('mObs').value = ag.observacao || '';
  
  onModoChange(); 
  onTipoChange(); 
  const infoEdicao = document.getElementById('infoEdicao');
  infoEdicao.textContent = "👤 Agendado por: " + (ag.nome || "Não identificado");
  openModal('modalManut');
}

function excluirManutencao(id) {
  document.getElementById('confirmTitle').textContent = 'Excluir manutenção';
  document.getElementById('confirmMsg').textContent = 'Excluir do histórico?';
  const btn = document.getElementById('confirmBtn');
  btn.onclick = () => {
    closeModal('modalConfirm');
    const m = db.manutencoes.find(x => x.id === id);
    db.manutencoes = db.manutencoes.filter(x => x.id !== id);
    salvarCache(); 
    renderDetalhe(); 
    sincronizarAlertas(false); 
    toast('Excluindo...');
    execBackground(async () => {
      await apiPost('deleteManutencao', { id });
      if (m) {
        const orfaos = db.alertas.filter(a => a.status === 'resolvido' && a.placa === m.placa && a.dataResolucao === m.data);
        for (const a of orfaos) await apiPost('deleteAlerta', { id: a.id });
      }
      sincronizarAlertas(true);
    }, 'Erro ao excluir');
  }; 
  openModal('modalConfirm');
}

function cancelarAgendamento(id) {
  db.agendamentos = db.agendamentos.filter(a => a.id !== id); 
  salvarCache(); 
  renderTelaAtual(); 
  toast('Cancelado...');
  execBackground(async () => { await apiPost('deleteAgendamento', { id }); }, 'Erro ao cancelar');
}

/* ================= ABA 3: DASHBOARD ================= */
function renderDashboard() {
  const sel = document.getElementById('dashVeiculo'), atual = sel ? sel.value : 'todos';
  sel.innerHTML = '<option value="todos">Todos os veículos</option>' + db.veiculos.map(v => `<option value="${v.placa}">${v.placa}</option>`).join('');
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  
  const veiculo = sel.value, periodo = document.getElementById('dashPeriodo').value;
  let ms = veiculo === 'todos' ? db.manutencoes.slice() : db.manutencoes.filter(m => m.placa === veiculo);
  
  if (periodo !== 'todos') {
    const limite = new Date(); 
    limite.setMonth(limite.getMonth() - (periodo === 'mes' ? 0 : parseInt(periodo)));
    if (periodo === 'mes') limite.setDate(1);
    ms = ms.filter(m => new Date(m.data + 'T00:00:00') >= limite);
  }

  const gastoPorVeiculo = {}; 
  ms.forEach(m => { gastoPorVeiculo[m.placa] = (gastoPorVeiculo[m.placa] || 0) + m.valor; });
  let maiorPlaca = '-', maiorValor = 0; 
  Object.entries(gastoPorVeiculo).forEach(([p, v]) => { if (v > maiorValor) { maiorValor = v; maiorPlaca = p; } });

  document.getElementById('dashKpis').innerHTML = `
    <div class="kpi"><div class="label">Gasto total</div><div class="value">${fmtMoeda(ms.reduce((s, m) => s + m.valor, 0))}</div></div>
    <div class="kpi"><div class="label">Manutenções</div><div class="value">${ms.length}</div></div>
    <div class="kpi"><div class="label">Veículos</div><div class="value">${db.veiculos.length}</div></div>
    <div class="kpi"><div class="label">Maior gasto</div><div class="value" style="font-size:18px;">${maiorPlaca !== '-' ? maiorPlaca + ' — ' + fmtMoeda(maiorValor) : '-'}</div></div>`;

  const chartData = veiculo === 'todos' ? db.veiculos.map(v => ({ placa: v.placa, valor: gastoPorVeiculo[v.placa] || 0 })) : [{ placa: veiculo, valor: ms.reduce((s, m) => s + m.valor, 0) }];
  const maxVal = Math.max(1, ...chartData.map(d => d.valor));
  document.getElementById('dashChart').innerHTML = chartData.map(d => `
    <div class="bar-row"><div class="bar-label">${d.placa}</div><div class="bar-track"><div class="bar-fill" style="width:${(d.valor / maxVal * 100).toFixed(1)}%">${fmtMoeda(d.valor)}</div></div></div>
  `).join('');
}

/* ================= ABA 4: ALERTAS OTIMIZADOS ================= */
function marcarResolvido(id) { 
  alterarAlerta(id, 'resolvido', true); 
}

function alterarAlerta(id, status, isResolucao = false) {
  const a = db.alertas.find(x => x.id === id); 
  if (!a) return;
  a.status = status; 
  a.dataAnalise = status === 'analise' ? hojeISO() : null; 
  a.dataResolucao = isResolucao ? hojeISO() : null;
  salvarCache(); 
  renderTelaAtual();
  execBackground(async () => { await apiPost('updateAlerta', { id, status, dataAnalise: a.dataAnalise, dataResolucao: a.dataResolucao }); }, 'Erro no alerta');
}

function marcarAnalise(id) { alterarAlerta(id, 'analise'); }
function reabrirAlerta(id) { alterarAlerta(id, 'ativo'); }
function reativarResolvido(id) { alterarAlerta(id, 'ativo'); }

function excluirRegistroResolvido(id) {
  document.getElementById('confirmTitle').textContent = 'Excluir registro';
  document.getElementById('confirmMsg').textContent = 'Excluir histórico de resolvidos?';
  const btn = document.getElementById('confirmBtn');
  btn.onclick = () => {
    closeModal('modalConfirm'); 
    db.alertas = db.alertas.filter(a => a.id !== id); 
    salvarCache(); 
    renderTelaAtual();
    execBackground(async () => { await apiPost('deleteAlerta', { id }); }, 'Erro exclusão');
  }; 
  openModal('modalConfirm');
}

function irParaVeiculo(placa) { 
  document.querySelector('.navbtn[data-tab="manutencao"]').click(); 
  selecionarVeiculo(placa); 
}

const estadoAccordions = { atrasado: true, pendente: true, andamento: true, resolvido: false };

function toggleSecaoAlerta(header, secaoId) {
  const corpo = header.nextElementSibling;
  const seta = header.querySelector('.alert-secao-seta');
  const estavaAberto = corpo.style.display !== 'none';
  
  corpo.style.display = estavaAberto ? 'none' : 'block'; 
  seta.textContent = estavaAberto ? '▸' : '▾';
  estadoAccordions[secaoId] = !estavaAberto; 
}

function grupoAlerta(a) {
  if (a.status === 'resolvido') return 'resolvido'; 
  if (a.status === 'analise') return 'andamento';
  const ag = db.agendamentos.find(ag => ag.placa === a.placa && ag.tipo === a.tipo);
  return (!ag || (ag.dataPrevista && ag.dataPrevista < hojeLocal())) ? 'atrasado' : 'pendente';
}

function dataCriacaoAlertaTs(a) {
  const p = String(a.id || '').split('_');
  if (p.length >= 2) { 
    const ts = parseInt(p[1], 36); 
    if (!isNaN(ts)) return ts; 
  }
  return Date.now();
}

function montarCardAlerta(a) {
  const v = db.veiculos.find(x => x.placa === a.placa), km = v ? fmtKm(v.kmAtual) : '-', grp = grupoAlerta(a);
  let btn = grp === 'resolvido' ? `<button class="btn small secondary" onclick="reativarResolvido('${a.id}')">Reabrir</button><button class="btn small danger" onclick="excluirRegistroResolvido('${a.id}')">Excluir</button>` :
            grp === 'andamento' ? `<button class="btn small" onclick="marcarResolvido('${a.id}')">Resolvido</button><button class="btn small secondary" onclick="reabrirAlerta('${a.id}')">Voltar</button>` :
            `<button class="btn small secondary" onclick="marcarAnalise('${a.id}')">Em andamento</button><button class="btn small" onclick="marcarResolvido('${a.id}')">Resolvido</button>`;

  return `<div class="alert-card ${grp}">
    <div class="alert-info"><div class="alert-title">${a.placa} — ${nomeTipo(a.tipo)}</div><div class="alert-sub">Km: ${km}</div></div>
    <div class="alert-actions">${btn}</div>
  </div>`;
}

function montarCardAgAtrasado(ag) {
  return `<div class="alert-card atrasado">
    <div class="alert-info">
      <div class="alert-title">${ag.placa} — ${(ag.tipo === 'outro' && ag.descricao) ? ag.descricao : nomeTipo(ag.tipo)}</div>
      <div class="alert-sub" style="color:var(--danger); font-weight:bold;">⚠️ Agendamento Atrasado: ${ag.dataPrevista ? fmtData(ag.dataPrevista) : '-'}</div>
    </div>
    <div class="alert-actions">
      <button class="btn small" onclick="resolverAgendamento('${ag.id}')">Resolvido</button>
      <button class="btn small secondary" onclick="editarAgendamento('${ag.id}')">Editar</button>
      <button class="btn small secondary" onclick="irParaVeiculo('${ag.placa}')">Ver</button>
    </div>
  </div>`;
}

function montarCardAgPendente(ag) {
  return `<div class="alert-card pendente">
    <div class="alert-info">
      <div class="alert-title">${ag.placa} — ${(ag.tipo === 'outro' && ag.descricao) ? ag.descricao : nomeTipo(ag.tipo)}</div>
      <div class="alert-sub">Agendado para: ${ag.dataPrevista ? fmtData(ag.dataPrevista) : '-'}</div>
    </div>
    <div class="alert-actions">
      <button class="btn small" onclick="resolverAgendamento('${ag.id}')">Resolvido</button>
      <button class="btn small secondary" onclick="editarAgendamento('${ag.id}')">Editar</button>
      <button class="btn small secondary" onclick="irParaVeiculo('${ag.placa}')">Ver</button>
    </div>
  </div>`;
}

function renderAlertas() {
  const s = document.getElementById('tab-alertas'); 
  if (!s) return; 

  let filtroInput = document.getElementById('filtroPlacaAlerta');
  const card = s.querySelector('.card');
  if (!filtroInput && card) {
    filtroInput = document.createElement('input');
    filtroInput.type = 'text';
    filtroInput.id = 'filtroPlacaAlerta';
    filtroInput.placeholder = '🔎 Filtrar por placa... (Ex: ABC1234)';
    filtroInput.style.marginBottom = '16px';
    filtroInput.oninput = renderAlertas;
    
    const listaAtual = card.querySelector('#alertasLista');
    if (listaAtual) {
      card.insertBefore(filtroInput, listaAtual);
    } else {
      card.appendChild(filtroInput);
    }
  }

  let c = document.getElementById('alertasLista');
  if (!c && card) { 
    c = document.createElement('div'); 
    c.id = 'alertasLista'; 
    card.appendChild(c); 
  }
  
  const termo = filtroInput ? filtroInput.value.trim().toUpperCase() : '';
  let baseAgs = db.agendamentos.filter(ag => !db.alertas.some(a => a.placa === ag.placa && a.tipo === ag.tipo && a.status !== 'resolvido'));
  let baseAlertas = db.alertas;

  if (termo) {
    baseAgs = baseAgs.filter(ag => ag.placa.includes(termo));
    baseAlertas = baseAlertas.filter(a => a.placa.includes(termo));
  }

  if (baseAlertas.length === 0 && baseAgs.length === 0) { 
    c.innerHTML = '<p class="empty">Nenhum alerta encontrado. ✅</p>'; 
    return; 
  }

  const g = { atrasado: [], pendente: [], andamento: [], resolvido: [] };
  baseAlertas.forEach(a => g[grupoAlerta(a)].push(a));
  g.resolvido.sort((a, b) => new Date(b.dataResolucao || 0) - new Date(a.dataResolucao || 0)); 

  const hoje = hojeLocal();
  const agsAtrasados = baseAgs.filter(ag => ag.dataPrevista && ag.dataPrevista < hoje);
  const agsPendentes = baseAgs.filter(ag => !(ag.dataPrevista && ag.dataPrevista < hoje));
  
  const listaAtrasados = [
    ...g.atrasado.map(a => ({ html: montarCardAlerta(a), ts: dataCriacaoAlertaTs(a) })),
    ...agsAtrasados.map(ag => ({ html: montarCardAgAtrasado(ag), ts: new Date(ag.dataPrevista + 'T00:00:00').getTime() }))
  ];
  listaAtrasados.sort((a, b) => a.ts - b.ts);
  
  const sec = (grp, tit, html, num) => {
    if(num === 0) return '';
    const exp = estadoAccordions[grp];
    return `<div class="alert-secao ${grp}">
              <div class="alert-secao-header" onclick="toggleSecaoAlerta(this, '${grp}')">
                <span>${tit}</span>
                <span class="alert-secao-count">${num}</span>
                <span class="alert-secao-seta">${exp ? '▾' : '▸'}</span>
              </div>
              <div class="alert-secao-corpo" style="display:${exp ? 'block' : 'none'}">${html}</div>
            </div>`;
  };

  const htmlAtrasados = listaAtrasados.map(item => item.html).join('');
  const htmlPendentes = g.pendente.map(montarCardAlerta).join('') + agsPendentes.map(montarCardAgPendente).join('');

  c.innerHTML = sec('atrasado', '🔴 Atrasado', htmlAtrasados, listaAtrasados.length) +
                sec('pendente', '🟡 Pendente', htmlPendentes, g.pendente.length + agsPendentes.length) +
                sec('andamento', '🟠 Em andamento', g.andamento.map(montarCardAlerta).join(''), g.andamento.length) +
                sec('resolvido', '🟢 Resolvido', g.resolvido.map(montarCardAlerta).join(''), g.resolvido.length);
}


/* ================= INICIALIZAÇÃO ================= */
function verificarSessao() {
  const usuario = localStorage.getItem("usuarioLogado");
  const dataLogin = localStorage.getItem("dataLogin");
  const perfil = localStorage.getItem("perfilUsuario");
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  // Se não há usuário logado ou a sessão for antiga, apenas limpa a memória e retorna nulo (SEM recarregar a página)
  if (!usuario || dataLogin !== dataHoje) {
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("dataLogin");
    localStorage.removeItem("perfilUsuario");
    return null;
  }
  
  return { usuario, perfil };
}

async function iniciar() {
  setInterval(() => { document.getElementById('dateNow').textContent = new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }, 60000);
  document.getElementById('dateNow').textContent = new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const sessao = verificarSessao();
  
  if (sessao && sessao.usuario) {
    liberarAcesso(sessao.usuario, sessao.perfil); // <-- Repassa o perfil para manter as abas ocultas
    if (carregarCache()) { 
      renderTelaAtual(); 
      carregarDoServidor(true).then(() => sincronizarAlertas(true)); 
    } else { 
      await carregarDoServidor(); 
      sincronizarAlertas(false); 
      renderTelaAtual(); 
    }
  } else {
    // A tela preta segura o utilizador até ele logar.
    if (carregarCache()) { 
      renderCadastro(); 
      carregarDoServidor(true).then(() => sincronizarAlertas(true)); 
    }
  }
}

iniciar();

// ================= FILTRO DO HISTÓRICO EM TEMPO REAL =================
function filtrarHistorico() {
  const input = document.getElementById('filtroHistorico').value.toLowerCase();
  const termo = input.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  const linhas = document.querySelectorAll('#tabelaHistorico tbody tr');
  
  linhas.forEach(linha => {
    const textoLinha = linha.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
    if (textoLinha.includes(termo)) {
      linha.style.display = '';
    } else {
      linha.style.display = 'none';
    }
  });
}
