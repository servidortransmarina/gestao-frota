const API_URL = "https://script.google.com/macros/s/AKfycbylesg0ZL8qLXqQ7igUSJ3dF-t59QLeh7aJoawxgndTfDDsuP5bs_F9sjJ9P_4lyVVj/exec";

/* ================= ESTADO E CACHE ================= */
let db = { veiculos: [], manutencoes: [], limites: {}, alertas: [], agendamentos: [], pendentes: [] };
let carregando = false;

const TIPOS = { oleo: 'Troca de óleo do motor', alinhamento: 'Alinhamento', oleo_caixa: 'Troca de óleo da caixa', oleo_diferencial: 'Troca de óleo do diferencial' };
const TIPOS_RASTREADOS = ['oleo', 'alinhamento', 'oleo_caixa', 'oleo_diferencial'];
const LIMITES_PADRAO = { oleo: { modo: 'km_e_meses', km: 15000, meses: 12 }, alinhamento: { modo: 'km_e_meses', km: 20000, meses: 6 }, oleo_caixa: { modo: 'km_e_meses', km: 100000, meses: 24 }, oleo_diferencial: { modo: 'km_e_meses', km: 100000, meses: 24 } };
const LABEL_ULTIMA = { oleo: 'Último óleo do motor', alinhamento: 'Último alinhamento', oleo_caixa: 'Último óleo da caixa', oleo_diferencial: 'Último óleo do diferencial' };
const CACHE_KEY = 'frotaCacheV13';

function salvarCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(db)); } catch(e) {} }

function carregarCache() {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (!c) return false;
    const dados = JSON.parse(c);
    if (!dados || !Array.isArray(dados.veiculos)) return false;
    db = dados;
    if (!Array.isArray(db.agendamentos)) db.agendamentos = [];
    if (!Array.isArray(db.pendentes)) db.pendentes = [];
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
    const resposta = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: "login", data: { usuario: usuarioDigitado, senha: senhaDigitada } }) });
    const resultado = await resposta.json();
    
    if (resultado.sucesso) {
      const dataHoje = new Date().toLocaleDateString('pt-BR');
      const perfilRetornado = resultado.perfil || 'admin'; 
      localStorage.setItem("usuarioLogado", resultado.nomeUsuario);
      localStorage.setItem("dataLogin", dataHoje);
      localStorage.setItem("perfilUsuario", perfilRetornado); 
      liberarAcesso(resultado.nomeUsuario, perfilRetornado);
      toast("Bem-vindo(a), " + resultado.nomeUsuario + "!");
    } else {
      msgErro.textContent = "Usuário ou senha incorretos!"; msgErro.style.display = "block";
    }
  } catch (e) {
    msgErro.textContent = "Erro na rede. Tente novamente."; msgErro.style.display = "block";
  } finally {
    btn.textContent = "Entrar"; btn.disabled = false;
  }
}

function liberarAcesso(nome, perfil) {
  document.getElementById("telaLoginOverlay").style.display = "none";
  document.getElementById("nomeUsuarioTopo").textContent = "👤 " + nome;
  document.getElementById("btnSair").style.display = "inline-block";
  
  if (perfil === 'mecanico') {
    document.querySelector('.navbtn[data-tab="dashboard"]').style.display = 'none';
  } else {
    document.querySelector('.navbtn[data-tab="dashboard"]').style.display = 'inline-block';
  }
  
  const btnAprovacoes = document.getElementById("tabBtnAprovacoes");
  const badge = document.getElementById('badgeAprovacoes');
  
  if (perfil === 'master') {
    btnAprovacoes.style.display = 'inline-block';
    if (db.pendentes && db.pendentes.length > 0) {
      badge.textContent = db.pendentes.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } else {
    btnAprovacoes.style.display = 'none';
    if (badge) badge.style.display = 'none';
  }
  
  document.querySelector('.navbtn[data-tab="manutencao"]').click();
}

function fazerLogout() {
  localStorage.removeItem("usuarioLogado"); localStorage.removeItem("dataLogin"); localStorage.removeItem("perfilUsuario"); location.reload();
}

function verificarSessao() {
  const usuario = localStorage.getItem("usuarioLogado");
  const dataLogin = localStorage.getItem("dataLogin");
  const perfil = localStorage.getItem("perfilUsuario");
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  if (!usuario || dataLogin !== dataHoje) { 
    localStorage.removeItem("usuarioLogado"); localStorage.removeItem("dataLogin"); localStorage.removeItem("perfilUsuario"); return null; 
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
      execBackground(async () => { await carregarDoServidor(true); sincronizarAlertas(true); }, "Erro na sync invisível");
    } else { 
      await carregarDoServidor(); sincronizarAlertas(false); renderTelaAtual(); 
    }
  } else {
    if (carregarCache()) { execBackground(async () => { await carregarDoServidor(true); sincronizarAlertas(true); }, "Erro"); }
  }
}

function mostrarCadastro() { document.getElementById("formLogin").style.display = "none"; document.getElementById("formCadastro").style.display = "block"; document.getElementById("mensagemErro").style.display = "none"; }
function mostrarLogin() { document.getElementById("formCadastro").style.display = "none"; document.getElementById("formLogin").style.display = "block"; document.getElementById("mensagemErro").style.display = "none"; }

async function solicitarAcesso() {
  const nome = document.getElementById("cadNome").value.trim(); const usuario = document.getElementById("cadUsuario").value.trim(); const senha = document.getElementById("cadSenha").value.trim();
  const msgErro = document.getElementById("mensagemErro");
  if (!nome || !usuario || !senha) { msgErro.textContent = "Preencha todos os campos!"; msgErro.style.display = "block"; return; }
  msgErro.style.display = "none";
  const btn = document.getElementById("btnCadastrar"); btn.textContent = "Enviando pedido..."; btn.disabled = true;
  try {
    const resposta = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: "requestRegistration", data: { nome, usuario, senha } }) });
    const resultado = await resposta.json();
    if (resultado.sucesso) {
      await alertarCustom("Pedido Enviado", "✅ Acesso solicitado com sucesso!\n\nAguarde a aprovação da gestão para conseguir entrar no sistema."); 
      document.getElementById("cadNome").value = ""; document.getElementById("cadUsuario").value = ""; document.getElementById("cadSenha").value = ""; mostrarLogin();
    }
  } catch (erro) { msgErro.textContent = "Erro ao enviar pedido."; msgErro.style.display = "block"; } finally { btn.textContent = "Solicitar Aprovação"; btn.disabled = false; }
}

/* ================= CAIXAS NATIVAS REFORMULADAS (PROMISSES) ================= */
function confirmarCustom(titulo, msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('modalConfirm');
    modal.style.zIndex = '10000'; 
    document.getElementById('confirmTitle').textContent = titulo; document.getElementById('confirmMsg').textContent = msg; openModal('modalConfirm');
    const btnConf = document.getElementById('confirmBtn'); const btnCanc = document.getElementById('confirmCancelBtn');
    const clear = () => { btnConf.onclick = null; btnCanc.onclick = null; modal.style.zIndex = ''; closeModal('modalConfirm'); };
    btnConf.onclick = () => { clear(); resolve(true); }; btnCanc.onclick = () => { clear(); resolve(false); };
  });
}

function alertarCustom(titulo, msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('modalConfirm');
    document.getElementById('confirmTitle').textContent = titulo; document.getElementById('confirmMsg').textContent = msg;
    modal.style.zIndex = '10000'; openModal('modalConfirm');
    const btnConf = document.getElementById('confirmBtn'); const btnCanc = document.getElementById('confirmCancelBtn');
    const classeAntiga = btnConf.className; btnConf.textContent = 'OK'; btnConf.className = 'btn success'; btnCanc.style.display = 'none';
    const clear = () => { btnConf.onclick = null; btnConf.textContent = 'Confirmar'; btnConf.className = classeAntiga; btnCanc.style.display = 'inline-block'; modal.style.zIndex = ''; closeModal('modalConfirm'); };
    btnConf.onclick = () => { clear(); resolve(true); };
  });
}

function pedirKmCustom(titulo, msg, valorPadrao) {
  return new Promise(resolve => {
    const modal = document.getElementById('modalPrompt');
    modal.style.zIndex = '10000';
    document.getElementById('promptTitle').textContent = titulo; document.getElementById('promptMsg').textContent = msg;
    const input = document.getElementById('promptInput'); input.value = valorPadrao > 0 ? Number(valorPadrao).toLocaleString('pt-BR') : '';
    openModal('modalPrompt'); setTimeout(() => input.focus(), 100);
    const btnConf = document.getElementById('promptBtnOk'); const btnCanc = document.getElementById('promptBtnCancel');
    const clear = () => { btnConf.onclick = null; btnCanc.onclick = null; modal.style.zIndex = ''; closeModal('modalPrompt'); };
    btnConf.onclick = () => { clear(); resolve(input.value); }; btnCanc.onclick = () => { clear(); resolve(null); };
  });
}

/* ================= FILA E COMUNICAÇÃO ================= */
let _fila = Promise.resolve();
function enfileirar(fn) { const p = _fila.then(fn); _fila = p.catch(() => {}); return p; }
function setLoading(v) { carregando = v; document.getElementById('loadingOverlay').classList.toggle('show', v); }
function execBackground(asyncFn, failMsg) { asyncFn().catch(e => { console.error(e); toast(`${failMsg}: ${e.message}`, true); }); }

async function apiGet() {
  return enfileirar(async () => {
    for (let i = 0; i < 3; i++) {
      try { const res = await fetch(API_URL + '?action=getAll'); if (res.ok) return res.json(); } 
      catch(e) { await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    throw new Error('Falha de conexão com o banco.');
  });
}

async function apiPost(action, data) {
  return enfileirar(async () => {
    let ultimoErro = 'Erro desconhecido';
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action, data }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json;
      } catch(e) { ultimoErro = e.message; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    throw new Error(`Falha após 3 tentativas de envio (${ultimoErro}).`);
  });
}

function normalizarDadosDaPlanilha(raw) {
  const veiculos = (raw.veiculos || []).map(v => ({ placa: String(v.placa).trim().toUpperCase(), kmAtual: Number(v.kmAtual) || 0 }));
  const manutencoes = (raw.manutencoes || []).map(m => ({
    id: String(m.id), placa: String(m.placa).trim().toUpperCase(), tipo: String(m.tipo || '').trim().toLowerCase(),
    descricao: String(m.descricao || m['descrição'] || m['Descricao'] || m['Descrição'] || m['descriçao'] || m['Descriçao'] || '').trim(),
    km: Number(m.km) || 0, data: formatarDataPlanilhaParaISO(m.data), valor: Number(m.valor) || 0, observacao: m.observacao || '', nome: m.nome || m['Nome'] || m.responsavel || '' 
  }));
  const limites = {};
  (raw.limites || []).forEach(l => {
    const p = String(l.placa).trim().toUpperCase(); if (!limites[p]) limites[p] = {};
    limites[p][String(l.tipo || '').trim()] = { modo: l.modo, km: Number(l.km) || 0, meses: Number(l.meses) || 0 };
  });
  
  const alertas = (raw.alertas || []).filter(a => a.status !== 'resolvido').map(a => ({
    id: String(a.id), placa: String(a.placa).trim().toUpperCase(), tipo: String(a.tipo || '').trim(), status: a.status || 'ativo',
    dataAnalise: a.dataAnalise ? formatarDataPlanilhaParaISO(a.dataAnalise) : null, dataResolucao: a.dataResolucao ? formatarDataPlanilhaParaISO(a.dataResolucao) : null
  }));
  
  const agendamentos = (raw.agendamentos || []).map(a => ({
    id: String(a.id), placa: String(a.placa).trim().toUpperCase(), tipo: String(a.tipo || '').trim(),
    descricao: a.descricao || a['descrição'] || a['Descricao'] || a['Descrição'] || a['descriçao'] || a['Descriçao'] || '',
    dataPrevista: a.dataPrevista ? formatarDataPlanilhaParaISO(a.dataPrevista) : '', valor: Number(a.valor) || 0, observacao: a.observacao || '', criadoEm: a.criadoEm ? formatarDataPlanilhaParaISO(a.criadoEm) : '', nome: a.nome || a['Nome'] || a.responsavel || ''
  }));
  
 const pendentes = (raw.pendentes || []).map(p => ({
    nome: String(p.nome || p['Nome'] || ''), 
    usuario: String(p.usuario || p['Usuario'] || p['Usuário'] || ''), 
    status: String(p.status || p['Status'] || p['Aprovação'] || p['Aprovacao'] || '')
  })).filter(p => p.status.trim().toUpperCase() === 'AGUARDANDO');

  manutencoes.forEach(m => {
    if (m.tipo !== 'outro' || m.descricao) return;
    const alerta = alertas.find(a => a.placa === m.placa && a.status === 'resolvido' && a.dataResolucao === m.data && a.tipo && !TIPOS[a.tipo]);
    if (alerta) m.descricao = String(alerta.tipo).trim();
  });
  
  return { veiculos, manutencoes, limites, alertas, agendamentos, pendentes };
}

function formatarDataPlanilhaParaISO(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  const d = new Date(valor); if (isNaN(d.getTime())) return '';
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
    if (!silencioso) toast('Erro ao carregar dados: ' + e.message, true);
  } finally {
    if (!silencioso) setLoading(false);
  }
}

function garantirLimites(placa) {
  if (!db.limites[placa]) db.limites[placa] = {};
  TIPOS_RASTREADOS.forEach(t => { if (!db.limites[placa][t]) db.limites[placa][t] = Object.assign({}, LIMITES_PADRAO[t]); });
}

function gerarId() { return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }
function fmtData(iso) { if (!iso) return '-'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function dataHoraAtual() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function hojeISO() { return new Date().toISOString().split('T')[0]; }
function hojeLocal() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtMoeda(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtKm(v) { return (v || 0).toLocaleString('pt-BR') + ' km'; }

function parseNumeroBR(str) {
  if (str === null || str === undefined) return NaN;
  let s = String(str).trim(); if (s === '') return NaN;
  return Number(s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
}

function normPeca(str) {
  let s = String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/['"´`]/g, "").toLowerCase();
  s = s.replace(/\b(de|da|do|das|dos|e|p|para|com|sem)\b/g, ' '); 
  return s.replace(/\s+/g, " ").trim();
}

function atualizarDatalistServicos() {
  const dl = document.getElementById('listaServicos');
  if (!dl) return;
  const tiposUnicos = new Set();
  Object.values(TIPOS).forEach(t => tiposUnicos.add(t)); 
  
  db.manutencoes.forEach(m => {
     const t = m.tipo === 'outro' ? m.descricao : TIPOS[m.tipo] || m.tipo;
     if (t && t.trim() !== '' && t !== 'Registro de KM') {
         tiposUnicos.add(t.trim()); 
     }
  });
  const arr = Array.from(tiposUnicos).sort();
  dl.innerHTML = arr.map(t => `<option value="${t}">`).join('');
}

function toast(msg, isErr) { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : ''); setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 3500); }
function addMeses(iso, meses) { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + meses); return d.toISOString().split('T')[0]; }
function normalizarPlaca(p) { return p.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function placaValida(p) { return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function nomeTipo(t) { return TIPOS[t] || t; }
function nomeManutencao(item) {
  const tipo = String(item?.tipo || '').trim().toLowerCase();
  if (tipo === 'outro') return String(item?.descricao || item?.['descrição'] || item?.['Descricao'] || item?.['Descrição'] || '').trim() || 'Outro';
  return TIPOS[tipo] || item?.tipo || 'Outro';
}

/* ================= INTELIGÊNCIA: VALIDAÇÃO DO KM ================= */
function validarSaltoKm(placa, novoKm, dataReferencia, isCorrecaoManual = false) {
  if (isNaN(novoKm) || novoKm <= 0) return { erro: true, msg: 'KM inválido.' };
  const v = db.veiculos.find(x => x.placa === placa);
  if (!v) return null;

  const kmAnterior = v.kmAtual; 
  
  if (novoKm < kmAnterior && dataReferencia === hojeISO()) {
     if (isCorrecaoManual) {
         return { alerta: true, msg: `⚠️ CORREÇÃO DE KM\n\nO valor digitado (${fmtKm(novoKm)}) é MENOR que o último KM do painel (${fmtKm(kmAnterior)}).\n\nTem certeza que deseja abaixar o KM do veículo no sistema?` };
     } else {
         return { erro: true, msg: `Bloqueio Retroativo:\nO KM não pode ser menor que o do painel atual (${fmtKm(kmAnterior)}).\n\nSe você digitou errado no passado, use o botão "Atualizar KM" lá no topo do painel do veículo para forçar a correção do erro.` };
     }
  }
  
  if (novoKm > kmAnterior) {
     const diffKm = novoKm - kmAnterior;
     if (diffKm > 2000) { 
         const ms = db.manutencoes.filter(m => m.placa === placa && m.km > 0).sort((a,b) => new Date(b.data) - new Date(a.data));
         const dataAnterior = ms.length > 0 ? ms[0].data : hojeISO();
         let diffDias = Math.floor((new Date(dataReferencia + 'T00:00:00') - new Date(dataAnterior + 'T00:00:00')) / (1000*60*60*24));
         if (diffDias < 1) diffDias = 1; 
         
         const media = diffKm / diffDias;
         if (media > 800) { 
            return { alerta: true, msg: `⚠️ SALTO SUSPEITO\n\nForam lançados ${fmtKm(diffKm)} em ${diffDias} dia(s) (Média irreal de ${Math.round(media)} km/dia).\n\nVocê tem certeza absoluta que digitou o valor correto?` };
         }
     }
  }
  return null; 
}

/* ================= NAVEGAÇÃO ================= */
function renderTelaAtual() {
  const tabAtiva = document.querySelector('.navbtn.active').dataset.tab;
  if (tabAtiva === 'manutencao') { if (veiculoSel) renderDetalhe(); else renderManutTab(); }
  else if (tabAtiva === 'dashboard') renderDashboard();
  else if (tabAtiva === 'alertas') renderAlertas();
  else if (tabAtiva === 'aprovacoes') renderAprovacoes();
}

document.querySelectorAll('.navbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active')); document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active'); document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderTelaAtual();
  });
});

async function atualizarManualmente() {
  const btn = document.getElementById('btnAtualizar'); btn.disabled = true;
  await carregarDoServidor(); sincronizarAlertas(false); renderTelaAtual(); toast('Dados sincronizados da nuvem.'); btn.disabled = false;
}

/* ================= ABA APROVAÇÕES MASTER ================= */
function renderAprovacoes() {
  const el = document.getElementById('listaAprovacoes');
  const badge = document.getElementById('badgeAprovacoes');
  
  if (!db.pendentes || db.pendentes.length === 0) { 
    el.innerHTML = '<div class="empty">Nenhum cadastro pendente.</div>'; 
    if (badge) badge.style.display = 'none'; 
    return; 
  }
  
  let html = '<table><thead><tr><th>Nome</th><th>Usuário</th><th>Ações</th></tr></thead><tbody>';
  db.pendentes.forEach(p => {
    html += `<tr><td>${p.nome}</td><td>${p.usuario}</td><td><select id="perfil_${p.usuario}" style="width: auto; display: inline-block; padding: 4px; margin-right: 8px;"><option value="mecanico">Mecânico</option><option value="admin">Admin</option><option value="master">Master</option></select><button class="btn success small" onclick="aprovarUsu('${p.usuario}')">Aprovar</button> <button class="btn danger small" onclick="recusarUsu('${p.usuario}')">Recusar</button></td></tr>`;
  });
  html += '</tbody></table>'; 
  el.innerHTML = html;
  
  if (badge) {
      badge.textContent = db.pendentes.length; 
      badge.style.display = 'inline-block';
  }
}

async function aprovarUsu(usuario) {
  toast('Processando aprovação, aguarde...');
  try {
    const perfil = document.getElementById(`perfil_${usuario}`).value;
    await apiPost('aprovarUsuario', { usuario, perfil });
    db.pendentes = db.pendentes.filter(p => p.usuario !== usuario); salvarCache(); renderAprovacoes(); toast('✅ Usuário aprovado com sucesso!');
  } catch(e) { toast('Erro ao aprovar: ' + e.message, true); }
}

async function recusarUsu(usuario) {
  toast('Processando recusa, aguarde...');
  try {
    await apiPost('recusarUsuario', { usuario });
    db.pendentes = db.pendentes.filter(p => p.usuario !== usuario); salvarCache(); renderAprovacoes(); toast('❌ Usuário recusado e removido!');
  } catch(e) { toast('Erro ao recusar: ' + e.message, true); }
}

/* ================= ABA UNIFICADA: VEÍCULOS & MANUTENÇÃO ================= */
let veiculoSel = null; let manutEditId = null; let resolverAlertaId = null; let resolverAgendamentoId = null;

async function cadastrarVeiculo() {
  if (localStorage.getItem("perfilUsuario") === "mecanico") return toast("Acesso negado: Apenas gestores podem cadastrar frota.", true);
  
  const input = document.getElementById('inputPlaca'); const err = document.getElementById('errPlaca'); err.textContent = ''; input.classList.remove('err');
  const placa = normalizarPlaca(input.value);
  if (!placa) { err.textContent = 'Informe a placa do veículo.'; input.classList.add('err'); return; }
  if (!placaValida(placa)) { err.textContent = 'Placa inválida.'; input.classList.add('err'); return; }
  if (db.veiculos.some(v => v.placa === placa)) { err.textContent = 'Veículo já cadastrado.'; input.classList.add('err'); return; }
  
  db.veiculos.push({ placa, kmAtual: 0 }); garantirLimites(placa); salvarCache(); input.value = ''; 
  closeModal('modalCadVeiculo'); renderManutTab(); toast('Sincronizando novo veículo...');
  execBackground(async () => { await apiPost('addVeiculo', { placa }); sincronizarAlertas(true); }, 'Erro ao salvar na planilha');
}

async function excluirVeiculo(placa) {
  if (localStorage.getItem("perfilUsuario") === "mecanico") return toast("Acesso negado: Você não tem permissão de excluir a frota.", true);

  const quer = await confirmarCustom('Excluir Caminhão', `Atenção: Tem certeza de que deseja excluir permanentemente a placa ${placa} e apagar todo o seu histórico financeiro do Dashboard?`);
  if (!quer) return;
  db.veiculos = db.veiculos.filter(v => v.placa !== placa); db.manutencoes = db.manutencoes.filter(m => m.placa !== placa); db.agendamentos = db.agendamentos.filter(a => a.placa !== placa); db.alertas = db.alertas.filter(a => a.placa !== placa);
  salvarCache(); renderManutTab(); toast('Excluindo veículo...');
  execBackground(async () => { await apiPost('deleteVeiculo', { placa }); }, 'Erro ao excluir veículo');
}

function statusVeiculo(placa) {
  const al = db.alertas.filter(a => a.placa === placa && a.status !== 'resolvido');
  if (al.some(a => a.status === 'ativo')) return 'atrasado';
  if (al.some(a => a.status === 'analise')) return 'analise';
  return 'ok';
}

function renderManutTab() {
  veiculoSel = null; document.getElementById('manutDetalheWrap').style.display = 'none'; document.getElementById('manutListaWrap').style.display = 'block';
  const wrap = document.getElementById('chipsVeiculos');
  
  const perfil = localStorage.getItem("perfilUsuario") || "admin"; const isAdmin = perfil !== "mecanico";
  let htmlBotaoAdd = isAdmin ? `<div class="placa-veiculo add-btn" onclick="openModal('modalCadVeiculo')"><div class="add-icon">🚛 +</div><div class="add-text">Novo Caminhão</div></div>` : '';

  let htmlVeiculos = db.veiculos.map(v => {
    const st = statusVeiculo(v.placa); const cor = st === 'atrasado' ? 'var(--danger)' : (st === 'analise' ? 'var(--warning)' : 'var(--success)');
    const isMercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(v.placa); const classePlaca = isMercosul ? 'mercosul' : 'antiga'; const nomeTopo = isMercosul ? 'BRASIL' : 'TRANSMARINA';
    return `<div class="placa-veiculo ${classePlaca}" onclick="selecionarVeiculo('${v.placa}')"><div class="placa-status-dot" style="background:${cor}"></div><div class="placa-topo">${nomeTopo}</div><div class="placa-numero">${v.placa}</div></div>`;
  }).join('');
  
  wrap.innerHTML = htmlBotaoAdd + htmlVeiculos;
}

function selecionarVeiculo(placa) { veiculoSel = placa; document.getElementById('manutListaWrap').style.display = 'none'; document.getElementById('manutDetalheWrap').style.display = 'block'; renderDetalhe(); }

function ultimaManut(placa, tipo) { return db.manutencoes.filter(m => m.placa === placa && m.tipo === tipo && m.descricao !== 'Registro de KM').sort((a, b) => new Date(b.data) - new Date(a.data))[0] || null; }
function calcularLimite(placa, tipo) {
  garantirLimites(placa); const cfg = db.limites[placa][tipo]; if (!cfg) return null;
  const ult = ultimaManut(placa, tipo); if (!ult) return { temUltima: false, cfg };
  return { temUltima: true, ultima: ult, limiteKm: cfg.modo !== 'meses' ? ult.km + Number(cfg.km) : null, limiteData: cfg.modo !== 'km' ? addMeses(ult.data, Number(cfg.meses)) : null, cfg };
}
function verificarAlerta(placa, tipo) {
  const info = calcularLimite(placa, tipo); if (!info) return null;
  if (!info.temUltima) return { deveAlertar: true, semHistorico: true, info };
  const v = db.veiculos.find(x => x.placa === placa); const kmAtual = v ? v.kmAtual : 0; const hoje = hojeISO();
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
          const resolvidos = db.manutencoes.filter(m => m.placa === v.placa && m.tipo === tipo && m.descricao !== 'Registro de KM').sort((a,b) => new Date(b.data) - new Date(a.data));
          const ultResolvido = resolvidos[0];
          let deveRecriar = true;
          if (ultResolvido) deveRecriar = db.manutencoes.some(m => m.placa === v.placa && m.tipo === tipo && m.data >= ultResolvido.data);
          if (deveRecriar) paraAdicionar.push({ id: gerarId(), placa: v.placa, tipo, status: 'ativo', dataAnalise: null, dataResolucao: null });
        }
      } else if (abertoExistente && abertoExistente.status === 'ativo') {
        idsParaRemover.push(abertoExistente.id);
      }
    }
  }
  if (paraAdicionar.length === 0 && idsParaRemover.length === 0) return;
  db.alertas = db.alertas.filter(a => !idsParaRemover.includes(a.id)); db.alertas.push(...paraAdicionar); salvarCache();
  if (bgSync) { execBackground(async () => { try { await apiPost('syncAlertas', { adicionar: paraAdicionar, remover: idsParaRemover }); } catch(e) { for (const id of idsParaRemover) await apiPost('deleteAlerta', { id }); for (const a of paraAdicionar) await apiPost('addAlerta', a); } }, 'Falha oculta na sincronização de alertas'); }
}

function renderDetalhe() {
  const placa = veiculoSel; const v = db.veiculos.find(x => x.placa === placa); if (!v) return;
  garantirLimites(placa); 
  
  const msAll = db.manutencoes.filter(m => m.placa === placa).sort((a, b) => new Date(b.data) - new Date(a.data));
  const msUi = msAll.filter(m => m.descricao !== 'Registro de KM');
  const msReais = msAll.filter(m => m.descricao !== 'Registro de KM');
  const total = msReais.reduce((s, m) => s + m.valor, 0); 
  const agends = db.agendamentos.filter(a => a.placa === placa); const cfg = db.limites[placa];
  
  const proximoLimiteTexto = (tipo) => {
    const info = calcularLimite(placa, tipo); if (!info || !info.temUltima) return 'Sem histórico';
    
    let txtKm = '';
    let txtData = '';
    
    if (info.limiteKm !== null) {
        const faltaKm = info.limiteKm - v.kmAtual;
        txtKm = faltaKm >= 0 ? `${fmtKm(info.limiteKm)} (faltam ${fmtKm(faltaKm)})` : `${fmtKm(info.limiteKm)} (excedido há ${fmtKm(-faltaKm)})`;
    }
    
    if (info.limiteData !== null) {
        const hojeObj = new Date(hojeISO() + 'T00:00:00');
        const limiteObj = new Date(info.limiteData + 'T00:00:00');
        const diffDias = Math.round((limiteObj - hojeObj) / (1000 * 60 * 60 * 24));
        
        if (diffDias >= 0) {
            txtData = `${fmtData(info.limiteData)} (faltam ${diffDias} dias)`;
        } else {
            txtData = `${fmtData(info.limiteData)} (excedido há ${-diffDias} dias)`;
        }
    }
    
    if (info.cfg.modo === 'km') return txtKm;
    if (info.cfg.modo === 'meses') return txtData;
    
    if (txtKm && txtData) return `${txtKm} ou ${txtData}`;
    return txtKm || txtData || '-';
  };
  const cardsTipos = TIPOS_RASTREADOS.map(t => { const ult = ultimaManut(placa, t); return `<div class="kpi"><div class="label">${LABEL_ULTIMA[t]}</div><div class="value" style="font-size:15px;">${ult ? fmtData(ult.data) + ' · ' + fmtKm(ult.km) : 'Sem registro'}</div></div>`; }).join('');
  const perfil = localStorage.getItem("perfilUsuario") || "admin"; const isAdmin = perfil !== "mecanico";
  const isMercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placa); const classePlaca = isMercosul ? 'mercosul' : 'antiga'; const nomeTopo = isMercosul ? 'BRASIL' : 'TRANSMARINA';

  const ultRegistro = msAll[0];
  const dataHover = ultRegistro ? `Última alteração: ${fmtData(ultRegistro.data)}\nKM: ${fmtKm(ultRegistro.km)}\nResponsável: ${ultRegistro.nome}` : 'Nenhum histórico registrado';

  document.getElementById('manutDetalheWrap').innerHTML = `
    <button class="back-btn" onclick="renderManutTab()">⬅ Voltar para a lista de Caminhões</button>
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div class="veiculo-header-info">
          <div class="placa-veiculo ${classePlaca}" style="cursor:default; margin:0;"><div class="placa-topo">${nomeTopo}</div><div class="placa-numero">${placa}</div></div>
          
          <div class="veiculo-km-box" title="${dataHover}" style="cursor:help;">
            <span class="veiculo-km-label">Km atual:</span> 
            <span class="veiculo-km-valor">${fmtKm(v.kmAtual)}</span>
            <div style="font-size:10px; color:var(--dim); margin-top:2px;">ℹ️ Passe o mouse para ver detalhes</div>
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          ${isAdmin ? `<button class="btn secondary" onclick="abrirModalKm('${placa}')">Atualizar KM</button>
                       <button class="btn danger" onclick="excluirVeiculo('${placa}')">Excluir Caminhão</button>` : ''}
          <button class="btn" onclick="abrirModalManut('${placa}')">Marcar manutenção</button>
        </div>
      </div>
    </div>
    ${isAdmin ? `<div class="grid-cards"><div class="kpi"><div class="label">Total gasto</div><div class="value">${fmtMoeda(total)}</div></div><div class="kpi"><div class="label">Nº manutenções</div><div class="value">${msReais.length}</div></div>${cardsTipos}</div>` : ''}
    ${isAdmin ? `<div class="card"><h2>Configuração de alertas</h2><div class="alert-config-container">${TIPOS_RASTREADOS.map(tipo => `<div class="limitbox"><div style="font-weight:bold;margin-bottom:8px;">${TIPOS[tipo]}</div><div class="row"><div class="field"><label>Critério</label><select onchange="atualizarCfg('${placa}','${tipo}','modo',this.value)"><option value="km" ${cfg[tipo].modo === 'km' ? 'selected' : ''}>Somente km</option><option value="meses" ${cfg[tipo].modo === 'meses' ? 'selected' : ''}>Somente meses</option><option value="km_e_meses" ${cfg[tipo].modo === 'km_e_meses' ? 'selected' : ''}>O que vencer primeiro</option></select></div></div><div class="row" style="margin-top:8px;"><div class="field"><label>A cada (km)</label><input type="number" min="0" value="${cfg[tipo].km}" onchange="atualizarCfg('${placa}','${tipo}','km',this.value)"></div><div class="field"><label>A cada (meses)</label><input type="number" min="0" value="${cfg[tipo].meses}" onchange="atualizarCfg('${placa}','${tipo}','meses',this.value)"></div></div><div style="margin-top:8px;font-size:12px;color:var(--dim);">Próximo: <b style="color:var(--text)">${proximoLimiteTexto(tipo)}</b></div></div>`).join('')}</div></div>` : ''}
    
    <div class="card">
      <div class="header-tabela"><h2>Histórico</h2><input type="text" id="filtroHistorico" placeholder="🔎 Pesquisar manutenção..." onkeyup="filtrarHistorico()"></div>
      <table id="tabelaHistorico">
        <thead><tr><th>Tipo</th><th>Data</th><th>KM Registrado</th><th>Valor</th><th>Obs</th><th>Ações</th></tr></thead>
        <tbody>
          ${msUi.map(m => `<tr title="👤 Última alteração: ${m.nome || 'Não identificado'}"><td>${nomeManutencao(m)}</td><td>${fmtData(m.data)}</td><td><div style="font-size: 10px; color: var(--dim); text-transform: uppercase;">Apurado com</div><div style="font-weight: 600;">${fmtKm(m.km)}</div></td><td>${fmtMoeda(m.valor)}</td><td>${m.observacao || '-'}</td><td><button class="btn secondary small" onclick="editarManutencao('${m.id}')">Editar</button> ${isAdmin ? `<button class="btn danger small" onclick="excluirManutencao('${m.id}')">Excluir</button>` : ''}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${agends.length ? `<div class="card"><h2>Agendadas</h2><table><thead><tr><th>Tipo</th><th>Previsão</th><th>Valor</th><th>Obs</th><th>Ações</th></tr></thead><tbody>${agends.map(g => `<tr title="👤 Registrado por: ${g.nome || 'Não identificado'}"><td>${nomeManutencao(g)}</td><td>${g.dataPrevista ? fmtData(g.dataPrevista) : '-'}</td><td>${g.valor ? fmtMoeda(g.valor) : '-'}</td><td>${g.observacao || '-'}</td><td><button class="btn success small" onclick="resolverAgendamento('${g.id}')">Resolvido</button> <button class="btn secondary small" onclick="editarAgendamento('${g.id}')">Editar</button> ${isAdmin ? `<button class="btn danger small" onclick="cancelarAgendamento('${g.id}')">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  `;
}

function atualizarCfg(placa, tipo, campo, valor) { garantirLimites(placa); if (campo === 'modo') db.limites[placa][tipo].modo = valor; else db.limites[placa][tipo][campo] = Number(valor) || 0; salvarCache(); renderDetalhe(); sincronizarAlertas(false); execBackground(async () => { await apiPost('updateLimite', { placa, tipo, modo: db.limites[placa][tipo].modo, km: db.limites[placa][tipo].km, meses: db.limites[placa][tipo].meses }); }, 'Erro configuração'); }

function abrirModalKm(placa) { veiculoSel = placa; const v = db.veiculos.find(x => x.placa === placa); document.getElementById('kmAtualInput').value = v.kmAtual > 0 ? Number(v.kmAtual).toLocaleString('pt-BR') : ''; document.getElementById('errKmAtual').textContent = ''; openModal('modalKm'); }

async function salvarKmAtual() {
  const input = document.getElementById('kmAtualInput'); const val = parseNumeroBR(input.value);
  if (isNaN(val) || val <= 0) { input.classList.add('err'); return; }
  const validacao = validarSaltoKm(veiculoSel, val, hojeISO(), true);
  if (validacao) {
     if (validacao.erro) return toast(validacao.msg, true);
     if (validacao.alerta) { const quer = await confirmarCustom('Atenção ao KM', validacao.msg); if (!quer) return; }
  }
  closeModal('modalKm'); const v = db.veiculos.find(x => x.placa === veiculoSel); if (v) v.kmAtual = val;
  
  const nomeUsuario = (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")";
  const registro = { id: gerarId(), placa: veiculoSel, tipo: 'outro', descricao: 'Registro de KM', km: val, data: hojeISO(), valor: 0, observacao: 'Atualização rápida do painel', nome: nomeUsuario };
  db.manutencoes.push(registro);
  
  salvarCache(); renderDetalhe(); sincronizarAlertas(false); toast('Sincronizando KM...');
  execBackground(async () => { await apiPost('addManutencao', registro); await apiPost('updateKmVeiculo', { placa: veiculoSel, kmAtual: val }); }, 'Erro ao salvar KM');
}

function onModoChange() { const ag = document.getElementById('mModo').value === 'agendar'; document.getElementById('mDataRealizadaWrap').style.display = ag ? 'none' : 'block'; document.getElementById('mDataPrevistaWrap').style.display = ag ? 'block' : 'none'; }

function abrirModalManut(placa, manut, modo) {
  veiculoSel = placa; manutEditId = manut ? manut.id : null;
  atualizarDatalistServicos(); 
  document.getElementById('manutTitle').textContent = (manut ? 'Editar' : 'Marcar') + ' manutenção — ' + placa;
  document.getElementById('mModo').value = modo || 'realizada'; document.getElementById('mModo').disabled = !!manut;
  let valTipo = ''; if (manut) valTipo = manut.tipo === 'outro' ? manut.descricao : TIPOS[manut.tipo];
  document.getElementById('mTipoInput').value = valTipo; 
  document.getElementById('mKm').value = (manut && manut.km > 0) ? Number(manut.km).toLocaleString('pt-BR') : ''; 
  document.getElementById('mData').value = manut ? manut.data : hojeISO(); document.getElementById('mDataPrevista').value = ''; 
  document.getElementById('mValor').value = (manut && manut.valor > 0) ? Number(manut.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''; 
  document.getElementById('mObs').value = manut ? (manut.observacao || '') : '';
  onModoChange(); const infoEdicao = document.getElementById('infoEdicao'); infoEdicao.textContent = manut ? ("👤 Última alteração: " + (manut.nome || "Não identificado")) : ("👤 Lançando como: " + (localStorage.getItem("usuarioLogado") || "Desconhecido")); openModal('modalManut');
}

async function salvarManutencao() {
  const modo = document.getElementById('mModo').value; const textoTipo = document.getElementById('mTipoInput').value.trim(); const kmInput = document.getElementById('mKm').value.trim(); const data = document.getElementById('mData').value; const dataPrevista = document.getElementById('mDataPrevista').value; 
  const valor = parseNumeroBR(document.getElementById('mValor').value) || 0; 
  const observacao = document.getElementById('mObs').value.trim();
  
  if (!textoTipo) return toast('Informe qual manutenção será feita.', true);
  const txtMin = textoTipo.toLowerCase(); let tipoFinal = 'outro'; let descricaoFinal = textoTipo;
  if (txtMin === 'alinhamento') { tipoFinal = 'alinhamento'; descricaoFinal = ''; } else if (txtMin === 'oleo' || txtMin === 'óleo' || txtMin === 'troca de oleo' || txtMin === 'troca de óleo') { return toast('⚠️ Especifique o óleo: Motor, Caixa ou Diferencial?', true); } else if (txtMin.includes('oleo') || txtMin.includes('óleo')) { if (txtMin.includes('caixa')) { tipoFinal = 'oleo_caixa'; descricaoFinal = ''; } else if (txtMin.includes('diferencial')) { tipoFinal = 'oleo_diferencial'; descricaoFinal = ''; } else if (txtMin.includes('motor')) { tipoFinal = 'oleo'; descricaoFinal = ''; } }
  const kmParsed = parseNumeroBR(kmInput);
  if ((modo !== 'agendar' && !data) || (kmInput !== '' && (isNaN(kmParsed) || kmParsed <= 0))) { return toast('Preencha os campos de Data e KM corretamente', true); }

  const placa = veiculoSel; const v = db.veiculos.find(x => x.placa === placa);
  const dataReferencia = modo === 'agendar' ? dataPrevista : data;
  
  if (kmInput !== '') {
     const validacao = validarSaltoKm(placa, kmParsed, dataReferencia, false);
     if (validacao) {
        if (validacao.erro) return toast(validacao.msg, true);
        if (validacao.alerta) { const quer = await confirmarCustom('Aviso de KM', validacao.msg); if (!quer) return; }
     }
  }
  
  closeModal('modalManut');
  const km = kmInput !== '' ? kmParsed : (v ? v.kmAtual : 0);
  if (v && km > v.kmAtual) v.kmAtual = km; 

  const editando = !!manutEditId; const nomeUsuario = (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")";
  
  if (modo === 'agendar') {
    const agOriginal = editando ? db.agendamentos.find(a => a.id === manutEditId) : null;
    const ag = { id: editando ? manutEditId : gerarId(), placa, tipo: tipoFinal, descricao: descricaoFinal, dataPrevista, valor, observacao, criadoEm: agOriginal ? agOriginal.criadoEm : hojeISO(), nome: nomeUsuario };
    if (editando) { const idx = db.agendamentos.findIndex(a => a.id === manutEditId); if (idx >= 0) db.agendamentos[idx] = ag; } else { db.agendamentos.push(ag); }
    salvarCache(); renderTelaAtual(); toast(editando ? 'Agendamento atualizado...' : 'Agendamento salvo...');
    execBackground(async () => { try { await apiPost(editando ? 'updateAgendamento' : 'addAgendamento', ag); } catch(e) { if(editando){ await apiPost('deleteAgendamento', { id: ag.id }); await apiPost('addAgendamento', ag); } else throw e; } }, 'Erro agendamento');
    if (kmInput !== '') { execBackground(async () => { await apiPost('updateKmVeiculo', { placa, kmAtual: km }); }, 'Erro KM'); } return;
  }

  const registro = { id: editando ? manutEditId : gerarId(), placa, tipo: tipoFinal, descricao: descricaoFinal, km, data, valor, observacao, nome: nomeUsuario };
  
  const agCumpridos = db.agendamentos.filter(a => a.placa === placa && normPeca(a.tipo === 'outro' ? a.descricao : a.tipo) === normPeca(tipoFinal === 'outro' ? descricaoFinal : tipoFinal));
  
  if (editando) { const idx = db.manutencoes.findIndex(m => m.id === manutEditId); if (idx >= 0) db.manutencoes[idx] = registro; } else { db.manutencoes.push(registro); }
  db.agendamentos = db.agendamentos.filter(a => !agCumpridos.includes(a));
  
  let alertaAtivo = db.alertas.find(a => a.placa === placa && normPeca(a.tipo) === normPeca(tipoFinal === 'outro' ? descricaoFinal : tipoFinal) && a.status !== 'resolvido');
  if (alertaAtivo) db.alertas = db.alertas.filter(x => x.id !== alertaAtivo.id);
  
  salvarCache(); renderDetalhe(); sincronizarAlertas(false); toast('Manutenção salva...');
  execBackground(async () => {
    await apiPost(editando ? 'updateManutencao' : 'addManutencao', registro);
    for (const ag of agCumpridos) await apiPost('deleteAgendamento', { id: ag.id });
    if (alertaAtivo) await apiPost('deleteAlerta', { id: alertaAtivo.id });
    if (v && km > v.kmAtual) await apiPost('updateKmVeiculo', { placa, kmAtual: km });
    sincronizarAlertas(true);
  }, 'Erro manutenção');
}

async function resolverAgendamento(id) {
  const ag = db.agendamentos.find(a => a.id === id); if (!ag) return;
  const v = db.veiculos.find(x => x.placa === ag.placa);
  let kmInformado = await pedirKmCustom('Registrar KM', `Manutenção: ${ag.descricao || nomeTipo(ag.tipo)}\n\nInforme o KM ATUAL do veículo ${ag.placa} no momento desta troca:`, v ? v.kmAtual : '');
  if (kmInformado === null) return; 
  let kmParsed = parseNumeroBR(kmInformado);
  if (isNaN(kmParsed) || kmParsed <= 0) kmParsed = v ? v.kmAtual : 0;
  
  const validacao = validarSaltoKm(ag.placa, kmParsed, hojeISO(), false);
  if (validacao) {
     if (validacao.erro) return toast(validacao.msg, true);
     if (validacao.alerta) { const quer = await confirmarCustom('Aviso de KM', validacao.msg); if (!quer) return; }
  }
  if (v && kmParsed > v.kmAtual) v.kmAtual = kmParsed; 
  const nomeUsuario = (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")";
  const registro = { id: gerarId(), placa: ag.placa, tipo: ag.tipo, descricao: String(ag.descricao || '').trim(), km: kmParsed, data: ag.dataPrevista || hojeISO(), valor: Number(ag.valor) || 0, observacao: ag.observacao || '', nome: nomeUsuario };
  
  db.manutencoes.push(registro); db.agendamentos = db.agendamentos.filter(a => a.id !== ag.id);
  
  const tipoA = ag.tipo === 'outro' ? ag.descricao : ag.tipo;
  const ex = db.alertas.find(a => a.placa === ag.placa && normPeca(a.tipo) === normPeca(tipoA) && a.status !== 'resolvido');
  if (ex) db.alertas = db.alertas.filter(x => x.id !== ex.id); 
  
  salvarCache(); renderTelaAtual(); sincronizarAlertas(false); toast('Resolvido e salvo no histórico!');
  execBackground(async () => {
    await apiPost('addManutencao', registro); await apiPost('deleteAgendamento', { id: ag.id }); await apiPost('updateKmVeiculo', { placa: ag.placa, kmAtual: kmParsed });
    if (ex) await apiPost('deleteAlerta', { id: ex.id });
    sincronizarAlertas(true);
  }, 'Erro ao resolver');
}

function editarManutencao(id) { abrirModalManut(veiculoSel, db.manutencoes.find(m => m.id === id)); }
function editarAgendamento(id) {
  const ag = db.agendamentos.find(a => a.id === id); if (!ag) return;
  veiculoSel = ag.placa; manutEditId = ag.id; resolverAlertaId = null; resolverAgendamentoId = null;
  document.getElementById('manutTitle').textContent = 'Editar agendamento — ' + ag.placa; document.getElementById('mModo').value = 'agendar'; document.getElementById('mModo').disabled = true;
  document.getElementById('mTipoInput').value = ag.tipo === 'outro' ? ag.descricao : TIPOS[ag.tipo]; document.getElementById('mKm').value = ''; document.getElementById('mData').value = hojeISO(); document.getElementById('mDataPrevista').value = ag.dataPrevista || ''; document.getElementById('mValor').value = ag.valor || ''; document.getElementById('mObs').value = ag.observacao || '';
  onModoChange(); const infoEdicao = document.getElementById('infoEdicao'); infoEdicao.textContent = "👤 Agendado por: " + (ag.nome || "Não identificado"); openModal('modalManut');
}
async function excluirManutencao(id) {
  if (localStorage.getItem("perfilUsuario") === "mecanico") return toast("Acesso negado: Apenas gestores podem excluir.", true);
  
  const quer = await confirmarCustom('Excluir manutenção', 'Tem certeza que deseja excluir do histórico?');
  if (!quer) return;
  const m = db.manutencoes.find(x => x.id === id); db.manutencoes = db.manutencoes.filter(x => x.id !== id); salvarCache(); renderTelaAtual(); sincronizarAlertas(false); toast('Excluindo...');
  execBackground(async () => { 
    await apiPost('deleteManutencao', { id }); 
    if (m) { const orfaos = db.alertas.filter(a => a.status === 'resolvido' && a.placa === m.placa && a.dataResolucao === m.data); for (const a of orfaos) await apiPost('deleteAlerta', { id: a.id }); }
    sincronizarAlertas(true); 
  }, 'Erro ao excluir');
}
function cancelarAgendamento(id) { 
  if (localStorage.getItem("perfilUsuario") === "mecanico") return toast("Acesso negado: Apenas gestores podem excluir.", true);
  
  db.agendamentos = db.agendamentos.filter(a => a.id !== id); salvarCache(); renderTelaAtual(); toast('Cancelado...'); execBackground(async () => { await apiPost('deleteAgendamento', { id }); }, 'Erro cancelar'); 
}

/* ================= ABA 3: DASHBOARD ANALÍTICO (R$/KM E CICLOS) ================= */

window.limparFiltroDatasDashboard = function() {
  document.getElementById('dashDataInicio').value = '';
  document.getElementById('dashDataFim').value = '';
  renderDashboard();
}

/**
 * Estima a distância rodada em um intervalo.
 * Entre duas leituras de odômetro, distribui a diferença uniformemente
 * pelos dias decorridos.
 */
function estimarKmNoPeriodo(veiculo, manutencoes, inicioISO, fimISO) {
  const leiturasPorData = new Map();

  manutencoes
    .filter(m => m.placa === veiculo.placa && Number(m.km) > 0 && m.data)
    .forEach(m => {
      const km = Number(m.km);
      const kmExistente = leiturasPorData.get(m.data);
      if (kmExistente === undefined || km > kmExistente) {
        leiturasPorData.set(m.data, km);
      }
    });

  const hoje = hojeLocal();
  const kmAtual = Number(veiculo.kmAtual) || 0;
  const kmNaDataDeHoje = leiturasPorData.get(hoje) || 0;

  if (kmAtual > 0 && kmAtual > kmNaDataDeHoje) {
    leiturasPorData.set(hoje, kmAtual);
  }

  const leituras = [...leiturasPorData.entries()]
    .map(([data, km]) => ({ data, km, dia: new Date(`${data}T00:00:00`) }))
    .sort((a, b) => a.dia - b.dia);

  if (leituras.length < 2) {
    return { km: 0, diasCobertos: 0 };
  }

  const inicio = new Date(`${inicioISO}T00:00:00`);
  const fimExclusivo = new Date(`${fimISO}T00:00:00`);
  fimExclusivo.setDate(fimExclusivo.getDate() + 1);

  let kmEstimado = 0;
  let diasCobertos = 0;

  for (let i = 1; i < leituras.length; i++) {
    const anterior = leituras[i - 1];
    const atual = leituras[i];

    const diasEntreLeituras = (atual.dia - anterior.dia) / (24 * 60 * 60 * 1000);

    if (diasEntreLeituras <= 0 || atual.km <= anterior.km) continue;

    const inicioSobreposto = Math.max(inicio.getTime(), anterior.dia.getTime());
    const fimSobreposto = Math.min(fimExclusivo.getTime(), atual.dia.getTime());

    if (fimSobreposto <= inicioSobreposto) continue;

    const diasSobrepostos = (fimSobreposto - inicioSobreposto) / (24 * 60 * 60 * 1000);
    const kmEntreLeituras = atual.km - anterior.km;
    const kmPorDia = kmEntreLeituras / diasEntreLeituras;

    kmEstimado += kmPorDia * diasSobrepostos;
    diasCobertos += diasSobrepostos;
  }

  return {
    km: Math.round(kmEstimado),
    diasCobertos: Math.round(diasCobertos * 100) / 100
  };
}

/* ================= ABA 3: DASHBOARD ANALÍTICO (FUNÇÃO ÚNICA BLINDADA) ================= */
function renderDashboard() {
  const sel = document.getElementById('dashVeiculo'), atual = sel ? sel.value : 'todos'; 
  sel.innerHTML = '<option value="todos">Todos os veículos</option>' + db.veiculos.map(v => `<option value="${v.placa}">${v.placa}</option>`).join(''); 
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  const veiculo = sel.value;
  
  const dtInicioStr = document.getElementById('dashDataInicio').value;
  const dtFimStr = document.getElementById('dashDataFim').value;
  
  let limiteInicio = dtInicioStr ? new Date(dtInicioStr + 'T00:00:00') : new Date('2000-01-01T00:00:00');
  let limiteFim = dtFimStr ? new Date(dtFimStr + 'T23:59:59') : new Date('2100-01-01T23:59:59');

  let maxGasto = 500, maxKm = 500; 
  let kmEstimadoGeral = 0;
  let diasCobertosGeral = 0;
  const chartData = [];
  
  let gastoGeral = 0, manutGeral = 0, kmGeralMatematica = 0, litrosGerais = 0;

  db.veiculos.forEach(v => {
      let msV_All = db.manutencoes.filter(m => m.placa === v.placa).sort((a,b) => new Date(a.data) - new Date(b.data));
      let msV_Per = msV_All.filter(m => { let d = new Date(m.data + 'T00:00:00'); return d >= limiteInicio && d <= limiteFim; });
      
      let gastoComb = 0, gastoOfic = 0;
      msV_Per.forEach(m => {
          if (m.tipo === 'abastecimento') {
              gastoComb += Number(m.valor) || 0;
              const lMatch = m.observacao.match(/Qtd:\s*([\d.]+)\s*L/);
              if (lMatch) litrosGerais += parseFloat(lMatch[1]);
          } else if (m.descricao !== 'Registro de KM') {
              gastoOfic += Number(m.valor) || 0;
          }
      });
      let gastoTotalV = gastoComb + gastoOfic;
      let qtdeV = msV_Per.filter(m => m.descricao !== 'Registro de KM' && m.tipo !== 'abastecimento').length;
      
      const inicioPeriodoISO = dtInicioStr || (msV_All.find(m => Number(m.km) > 0 && m.data)?.data || hojeLocal());
      const fimPeriodoISO = dtFimStr || hojeLocal();

      let estimativa = { km: 0, diasCobertos: 0 };
      try {
          estimativa = estimarKmNoPeriodo(v, db.manutencoes, inicioPeriodoISO, fimPeriodoISO);
      } catch(e) {
          console.error(e);
      }

      const distanciaReal = Number(estimativa.km) || 0;
      const kmRodadoGrafico = (!dtInicioStr && !dtFimStr) ? (Number(v.kmAtual) || 0) : distanciaReal;

      if (gastoTotalV > maxGasto) maxGasto = gastoTotalV;
      if (kmRodadoGrafico > maxKm) maxKm = kmRodadoGrafico;

      if (veiculo === 'todos' || v.placa === veiculo) {
          kmEstimadoGeral += distanciaReal;
          diasCobertosGeral += (Number(estimativa.diasCobertos) || 0);
          gastoGeral += gastoTotalV; 
          manutGeral += qtdeV; 
          kmGeralMatematica += distanciaReal; 
          
          if (gastoTotalV > 0 || kmRodadoGrafico > 0 || msV_Per.length > 0 || (!dtInicioStr && !dtFimStr)) {
              chartData.push({ placa: v.placa, gastoTotal: gastoTotalV, gastoComb: gastoComb, gastoOfic: gastoOfic, km: kmRodadoGrafico });
          }
      }
  });

  let chartHTML = `<div class="chart-vertical-container">`;
  
  chartData.forEach(d => {
      let hTotal = (d.gastoTotal > 0 && maxGasto > 0) ? Math.max((d.gastoTotal / maxGasto) * 100, 2) : 0;
      let ratioComb = d.gastoTotal > 0 ? (d.gastoComb / d.gastoTotal) : 0;
      let ratioOfic = d.gastoTotal > 0 ? (d.gastoOfic / d.gastoTotal) : 0;
      let hComb = hTotal * ratioComb;
      let hOficina = hTotal * ratioOfic;
      let hKm = (d.km > 0 && maxKm > 0) ? Math.max((d.km / maxKm) * 100, 2) : 0;
      
      chartHTML += `
      <div class="bar-group-wrapper">
        <div class="bar-group">
          <!-- COLUNA 1: FINANCEIRA EMPILHADA -->
          <div class="bar-track">
            ${d.gastoTotal > 0 ? `<div class="bar-col-val" style="bottom: calc(${hTotal}\% + 5px)">${fmtMoeda(d.gastoTotal)}</div>` : ''}
            <div class="bar-col-fill fifa-fuel" style="height:${hComb}%; border-radius: 4px 4px 0 0;" title="Combustível: ${fmtMoeda(d.gastoComb)}"></div>
            <div class="bar-col-fill fifa-office" style="height:${hOficina}%; border-radius: ${hComb === 0 ? '4px 4px 0 0' : '0'};" title="Oficina: ${fmtMoeda(d.gastoOfic)}"></div>
          </div>
          <!-- COLUNA 2: RODAGEM AZUL -->
          <div class="bar-track">
            ${d.km > 0 ? `<div class="bar-col-val" style="bottom: calc(${hKm}\% + 5px)">${fmtKm(d.km)}</div>` : ''}
            <div class="bar-col-fill fifa-km" style="height:${hKm}%; border-radius: 4px 4px 0 0;" title="Rodagem: ${fmtKm(d.km)}"></div>
          </div>
        </div>
        <div class="bar-col-label">${d.placa}</div>
      </div>`;
  });
  chartHTML += `</div>`;
  document.getElementById('dashChartVertical').innerHTML = chartHTML;

  const mediaKmDia = diasCobertosGeral > 0 ? Math.round(kmEstimadoGeral / diasCobertosGeral) : 0;

  let custoKmGlobal = 'R$ 0,00 / km';
  if (kmGeralMatematica > 0) {
     let calc = gastoGeral / kmGeralMatematica;
     custoKmGlobal = (calc > 0 && calc < 0.01) ? calc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 }) + ' / km' : fmtMoeda(calc) + ' / km';
  }
  
  let consumoMedio = (litrosGerais > 0 && kmGeralMatematica > 0) ? (kmGeralMatematica / litrosGerais).toFixed(2) + ' Km/L' : '-';

  document.getElementById('dashKpis').innerHTML = `
    <div class="kpi"><div class="label">Média estimada diária</div><div class="value">${fmtKm(mediaKmDia)}</div></div>
    <div class="kpi"><div class="label">Gasto Analisado (Comb. + Peças)</div><div class="value">${fmtMoeda(gastoGeral)}</div></div>
    <div class="kpi"><div class="label">Visitas à Oficina</div><div class="value">${manutGeral}</div></div>
    <div class="kpi"><div class="label">Consumo de Combustível</div><div class="value" style="color:var(--warning)">${consumoMedio}</div></div>
    <div class="kpi" title="Calculado dividindo o Custo Analisado (Comb. + Peças) pela Rodagem Real no período"><div class="label">Custo por Km Rodado</div><div class="value" style="color:var(--primary)">${custoKmGlobal}</div></div>
  `;

  renderDashboardCiclos();
}

/* ================= ABA 4: ALERTAS ================= */
async function marcarResolvido(id) { 
  const a = db.alertas.find(x => x.id === id); if (!a) return;
  const v = db.veiculos.find(x => x.placa === a.placa);
  let kmInformado = await pedirKmCustom('Registrar KM', `Alerta: ${nomeTipo(a.tipo)}\n\nInforme o KM ATUAL do veículo ${a.placa} no momento desta troca:`, v ? v.kmAtual : '');
  if (kmInformado === null) return;
  let kmParsed = parseNumeroBR(kmInformado);
  if (isNaN(kmParsed) || kmParsed <= 0) kmParsed = v ? v.kmAtual : 0;
  
  const validacao = validarSaltoKm(a.placa, kmParsed, hojeISO(), false);
  if(validacao) {
     if (validacao.erro) return toast(validacao.msg, true);
     if (validacao.alerta) { const quer = await confirmarCustom('Aviso de KM', validacao.msg); if (!quer) return; }
  }
  if (v && kmParsed > v.kmAtual) v.kmAtual = kmParsed;
  
  const registro = { id: gerarId(), placa: a.placa, tipo: TIPOS_RASTREADOS.includes(a.tipo) ? a.tipo : 'outro', descricao: !TIPOS_RASTREADOS.includes(a.tipo) ? a.tipo : '', km: kmParsed, data: hojeISO(), valor: 0, observacao: '', nome: (localStorage.getItem("usuarioLogado") || "Desconhecido") + " (em " + dataHoraAtual() + ")" };
  db.manutencoes.push(registro); db.alertas = db.alertas.filter(x => x.id !== a.id); salvarCache(); renderTelaAtual(); toast('Marcado como resolvido no histórico!');
  execBackground(async () => { await apiPost('addManutencao', registro); await apiPost('deleteAlerta', { id: a.id }); await apiPost('updateKmVeiculo', { placa: a.placa, kmAtual: kmParsed }); sincronizarAlertas(true); }, 'Erro marcar resolvido');
}

function alterarAlerta(id, status) {
  const a = db.alertas.find(x => x.id === id); if (!a) return;
  a.status = status; a.dataAnalise = status === 'analise' ? hojeISO() : null; salvarCache(); renderTelaAtual(); execBackground(async () => { await apiPost('updateAlerta', { id, status, dataAnalise: a.dataAnalise, dataResolucao: null }); }, 'Erro alerta');
}
function marcarAnalise(id) { alterarAlerta(id, 'analise'); }
function reabrirAlerta(id) { alterarAlerta(id, 'ativo'); }

async function reativarResolvido(id) { 
  const m = db.manutencoes.find(x => x.id === id); if (!m) return;
  const quer = await confirmarCustom('Desfazer Manutenção', `Isto apagará o registro de ${fmtMoeda(m.valor)} do histórico do ${m.placa} e recriará a pendência. Confirma?`);
  if (!quer) return;
  db.manutencoes = db.manutencoes.filter(x => x.id !== m.id);
  const novoAg = { id: gerarId(), placa: m.placa, tipo: m.tipo, descricao: m.descricao, dataPrevista: m.data, valor: m.valor, observacao: m.observacao, criadoEm: hojeISO(), nome: localStorage.getItem("usuarioLogado") || 'Desconhecido' };
  db.agendamentos.push(novoAg); salvarCache(); renderTelaAtual(); sincronizarAlertas(false); toast('Desfeito! Voltou para agendamentos.');
  execBackground(async () => { await apiPost('deleteManutencao', { id: m.id }); await apiPost('addAgendamento', novoAg); sincronizarAlertas(true); }, 'Erro desfazer');
}

function iniciarAnaliseAgendamento(id) {
  const ag = db.agendamentos.find(a => a.id === id); if (!ag) return;
  const tipoA = ag.tipo === 'outro' ? ag.descricao : ag.tipo;
  let ex = db.alertas.find(a => a.placa === ag.placa && normPeca(a.tipo) === normPeca(tipoA) && a.status !== 'resolvido');
  if (ex) { ex.status = 'analise'; ex.dataAnalise = hojeISO(); salvarCache(); renderTelaAtual(); execBackground(async () => { await apiPost('updateAlerta', { id: ex.id, status: 'analise', dataAnalise: ex.dataAnalise }); }, 'Erro andamento'); } 
  else { const novoAlerta = { id: gerarId(), placa: ag.placa, tipo: tipoA, status: 'analise', dataAnalise: hojeISO(), dataResolucao: null }; db.alertas.push(novoAlerta); salvarCache(); renderTelaAtual(); execBackground(async () => { await apiPost('addAlerta', novoAlerta); }, 'Erro andamento'); }
}
function irParaVeiculo(placa) { document.querySelector('.navbtn[data-tab="manutencao"]').click(); selecionarVeiculo(placa); }
const estadoAccordions = { atrasado: true, pendente: true, andamento: true, resolvido: false };
function toggleSecaoAlerta(header, secaoId) {
  const corpo = header.nextElementSibling; const seta = header.querySelector('.alert-secao-seta'); const estavaAberto = corpo.style.display !== 'none';
  corpo.style.display = estavaAberto ? 'none' : 'block'; seta.textContent = estavaAberto ? '▸' : '▾'; estadoAccordions[secaoId] = !estavaAberto; 
}
function grupoAlerta(a) { if (a.status === 'resolvido') return 'resolvido'; if (a.status === 'analise') return 'andamento'; const ag = db.agendamentos.find(ag => ag.placa === a.placa && ag.tipo === a.tipo); return (!ag || (ag.dataPrevista && ag.dataPrevista < hojeLocal())) ? 'atrasado' : 'pendente'; }
function dataCriacaoAlertaTs(a) { const p = String(a.id || '').split('_'); if (p.length >= 2) { const ts = parseInt(p[1], 36); if (!isNaN(ts)) return ts; } return Date.now(); }

function montarCardAlerta(a) {
  const v = db.veiculos.find(x => x.placa === a.placa), km = v ? fmtKm(v.kmAtual) : '-', grp = grupoAlerta(a);
  const isAdmin = (localStorage.getItem("perfilUsuario") || "admin") !== "mecanico";
  let btn = grp === 'resolvido' ? `<button class="btn small secondary" onclick="reativarResolvido('${a.id}')">Reabrir</button>${isAdmin ? `<button class="btn small danger" onclick="excluirManutencao('${a.id}')">Excluir</button>` : ''}` :
            grp === 'andamento' ? `<button class="btn small" onclick="marcarResolvido('${a.id}')">Resolvido</button><button class="btn small secondary" onclick="reabrirAlerta('${a.id}')">Voltar</button>` :
            `<button class="btn small secondary" onclick="marcarAnalise('${a.id}')">Em andamento</button><button class="btn small" onclick="marcarResolvido('${a.id}')">Resolvido</button>`;
  return `<div class="alert-card ${grp}"><div class="alert-info"><div class="alert-title">${a.placa} — ${nomeTipo(a.tipo)}</div><div class="alert-sub">Km: ${km}</div></div><div class="alert-actions">${btn}</div></div>`;
}

function montarCardAgAtrasado(ag) { 
    return `<div class="alert-card atrasado"><div class="alert-info"><div class="alert-title">${ag.placa} — ${(ag.tipo === 'outro' && ag.descricao) ? ag.descricao : nomeTipo(ag.tipo)}</div><div class="alert-sub" style="color:var(--danger); font-weight:bold;">⚠️ Atrasado: ${ag.dataPrevista ? fmtData(ag.dataPrevista) : '-'}</div></div><div class="alert-actions"><button class="btn small secondary" onclick="iniciarAnaliseAgendamento('${ag.id}')">Em andamento</button><button class="btn small" onclick="resolverAgendamento('${ag.id}')">Resolvido</button><button class="btn small secondary" onclick="editarAgendamento('${ag.id}')">Editar</button></div></div>`; 
}

function montarCardAgPendente(ag) { 
    return `<div class="alert-card pendente"><div class="alert-info"><div class="alert-title">${ag.placa} — ${(ag.tipo === 'outro' && ag.descricao) ? ag.descricao : nomeTipo(ag.tipo)}</div><div class="alert-sub">Agendado para: ${ag.dataPrevista ? fmtData(ag.dataPrevista) : '-'}</div></div><div class="alert-actions"><button class="btn small secondary" onclick="iniciarAnaliseAgendamento('${ag.id}')">Em andamento</button><button class="btn small" onclick="resolverAgendamento('${ag.id}')">Resolvido</button><button class="btn small secondary" onclick="editarAgendamento('${ag.id}')">Editar</button></div></div>`; 
}

function renderAlertas() {
  const s = document.getElementById('tab-alertas'); if (!s) return; 
  let filtroInput = document.getElementById('filtroPlacaAlerta'); const card = s.querySelector('.card');
  if (!filtroInput && card) {
    filtroInput = document.createElement('input'); filtroInput.type = 'text'; filtroInput.id = 'filtroPlacaAlerta'; 
    filtroInput.placeholder = '🔎 Filtrar por placa ou serviço...'; 
    filtroInput.style.marginBottom = '16px'; filtroInput.oninput = renderAlertas;
    const listaAtual = card.querySelector('#alertasLista'); if (listaAtual) card.insertBefore(filtroInput, listaAtual); else card.appendChild(filtroInput);
  }
  let c = document.getElementById('alertasLista'); if (!c && card) { c = document.createElement('div'); c.id = 'alertasLista'; card.appendChild(c); }
  
  const termoOriginal = filtroInput ? filtroInput.value.trim().toUpperCase() : '';
  const termoLimpo = termoOriginal.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  
  let baseAgs = db.agendamentos.filter(ag => { const tipoMapeado = ag.tipo === 'outro' ? (ag.descricao || 'outro') : ag.tipo; return !db.alertas.some(a => a.placa === ag.placa && normPeca(a.tipo) === normPeca(tipoMapeado) && a.status !== 'resolvido'); });
  let baseAlertas = db.alertas.filter(a => a.tipo !== 'Registro de KM');

  if (termoLimpo) { 
    baseAgs = baseAgs.filter(ag => {
        const desc = (ag.tipo === 'outro' && ag.descricao) ? ag.descricao : nomeTipo(ag.tipo);
        const textoBusca = (ag.placa + " " + desc).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        return textoBusca.includes(termoLimpo);
    }); 
    baseAlertas = baseAlertas.filter(a => {
        const desc = nomeTipo(a.tipo);
        const textoBusca = (a.placa + " " + desc).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        return textoBusca.includes(termoLimpo);
    }); 
  }

  const g = { atrasado: [], pendente: [], andamento: [], resolvido: [] };
  baseAlertas.forEach(a => g[grupoAlerta(a)].push(a));
  
  const resolvidosComputados = db.manutencoes
      .filter(m => m.descricao !== 'Registro de KM')
      .map(m => ({ id: m.id, placa: m.placa, tipo: m.tipo === 'outro' ? m.descricao : m.tipo, status: 'resolvido', dataResolucao: m.data }));
      
  g.resolvido = resolvidosComputados.sort((a,b) => new Date(b.dataResolucao) - new Date(a.dataResolucao));
  
  if (termoLimpo) {
      g.resolvido = g.resolvido.filter(a => {
         const textoBusca = (a.placa + " " + a.tipo).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
         return textoBusca.includes(termoLimpo);
      });
  }

  if (baseAlertas.length === 0 && baseAgs.length === 0 && g.resolvido.length === 0) { c.innerHTML = '<p class="empty">Nenhum alerta encontrado. ✅</p>'; return; }

  const hoje = hojeLocal(); const agsAtrasados = baseAgs.filter(ag => ag.dataPrevista && ag.dataPrevista < hoje); const agsPendentes = baseAgs.filter(ag => !(ag.dataPrevista && ag.dataPrevista < hoje));
  const listaAtrasados = [ ...g.atrasado.map(a => ({ html: montarCardAlerta(a), ts: dataCriacaoAlertaTs(a) })), ...agsAtrasados.map(ag => ({ html: montarCardAgAtrasado(ag), ts: new Date(ag.dataPrevista + 'T00:00:00').getTime() })) ];
  listaAtrasados.sort((a, b) => a.ts - b.ts);
  
  const sec = (grp, tit, html, num) => { if(num === 0) return ''; const exp = estadoAccordions[grp]; return `<div class="alert-secao ${grp}"><div class="alert-secao-header" onclick="toggleSecaoAlerta(this, '${grp}')"><span>${tit}</span><span class="alert-secao-count">${num}</span><span class="alert-secao-seta">${exp ? '▾' : '▸'}</span></div><div class="alert-secao-corpo" style="display:${exp ? 'block' : 'none'}">${html}</div></div>`; };
  const htmlAtrasados = listaAtrasados.map(item => item.html).join(''); const htmlPendentes = g.pendente.map(montarCardAlerta).join('') + agsPendentes.map(montarCardAgPendente).join('');
  c.innerHTML = sec('atrasado', '🔴 Atrasado', htmlAtrasados, listaAtrasados.length) + sec('pendente', '🟡 Pendente', htmlPendentes, g.pendente.length + agsPendentes.length) + sec('andamento', '🟠 Em andamento', g.andamento.map(montarCardAlerta).join(''), g.andamento.length) + sec('resolvido', '🟢 Resolvido', g.resolvido.map(montarCardAlerta).join(''), g.resolvido.length);
}

function filtrarHistorico() {
  const input = document.getElementById('filtroHistorico').value.toLowerCase(); const termo = input.normalize('NFD').replace(/[\u0300-\u036f]/g, ""); const linhas = document.querySelectorAll('#tabelaHistorico tbody tr');
  linhas.forEach(linha => { const textoLinha = linha.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ""); linha.style.display = textoLinha.includes(termo) ? '' : 'none'; });
}

iniciar();


/* ================= DASHBOARD CICLOS / REPETIÇÃO ================= */
function renderDashboardCiclos() {
  const sel = document.getElementById('dashFiltroCiclo');
  if (!sel) return;

  const servicosSet = new Set();
  db.manutencoes.forEach(m => {
    if (m.descricao !== 'Registro de KM' && m.tipo !== 'abastecimento') {
      let nomeServico = m.tipo === 'outro' ? m.descricao : (TIPOS[m.tipo] || m.tipo);
      if (nomeServico) servicosSet.add(nomeServico);
    }
  });

  const servicosArray = Array.from(servicosSet).sort();
  const atual = sel.value;
  const resEl = document.getElementById('dashCiclosTabela');

  if (servicosArray.length === 0) {
    sel.innerHTML = '<option value="">Nenhum serviço registrado</option>';
    if (resEl) resEl.innerHTML = '<div class="empty" style="padding: 15px; font-size: 13px; color: var(--dim);">As médias de repetição aparecerão aqui assim que houver manutenções cadastradas.</div>';
    return;
  }

  sel.innerHTML = '<option value="">Selecione um serviço ou peça...</option>' + servicosArray.map(s => `<option value="${s}">${s}</option>`).join('');
  
  if ([...sel.options].some(o => o.value === atual)) {
    sel.value = atual;
  }

  if (sel.value && typeof calcularCicloServico === 'function') {
    calcularCicloServico(sel.value);
  } else if (resEl && !sel.value) {
    resEl.innerHTML = '<div class="empty" style="padding: 15px; font-size: 13px; color: var(--dim);">Selecione um item acima para ver o intervalo médio de troca por veículo.</div>';
  }
}

function calcularCicloServico(servicoNome) {
  const resEl = document.getElementById('dashCiclosTabela');
  if (!resEl || !servicoNome) return;

  const termoBusca = normPeca(servicoNome);
  const historico = db.manutencoes.filter(m => {
    let nomeServico = m.tipo === 'outro' ? m.descricao : (TIPOS[m.tipo] || m.tipo);
    return normPeca(nomeServico) === termoBusca;
  });

  if (historico.length === 0) {
    resEl.innerHTML = `<div class="empty" style="padding: 15px; font-size: 13px; color: var(--dim);">Nenhum registro encontrado para "${servicoNome}".</div>`;
    return;
  }

  // Agrupa os registros por veículo (placa)
  const porVeiculo = {};
  historico.forEach(m => {
    if (!porVeiculo[m.placa]) porVeiculo[m.placa] = [];
    porVeiculo[m.placa].push(m);
  });

  let htmlResult = `<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">`;

  Object.keys(porVeiculo).sort().forEach(placa => {
    const manutencoesPlaca = porVeiculo[placa].sort((a, b) => new Date(a.data) - new Date(b.data));
    
    let somaKm = 0;
    let contagemIntervalos = 0;
    for (let i = 1; i < manutencoesPlaca.length; i++) {
      let diffKm = manutencoesPlaca[i].km - manutencoesPlaca[i-1].km;
      if (diffKm > 0) {
        somaKm += diffKm;
        contagemIntervalos++;
      }
    }

    let mediaKmPlaca = contagemIntervalos > 0 ? Math.round(somaKm / contagemIntervalos) : 0;

    htmlResult += `
      <div style="background: var(--surface-card, #f8fafc); padding: 12px 15px; border-radius: 6px; border: 1px solid var(--border, #e2e8f0); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <div style="font-weight: 600; color: var(--primary); margin-bottom: 4px; font-size: 15px;">🚛 Placa: ${placa}</div>
          <div style="font-size: 13px; color: var(--text);">Média de Troca: <b>${mediaKmPlaca > 0 ? '~' + fmtKm(mediaKmPlaca) : 'Dados insuficientes para média'}</b></div>
        </div>
        <div style="font-size: 12px; color: var(--dim); text-align: right;">
          ${manutencoesPlaca.length} intervenção(ões) registrada(s)<br>
          Última em: ${fmtData(manutencoesPlaca[manutencoesPlaca.length - 1].data)} (${fmtKm(manutencoesPlaca[manutencoesPlaca.length - 1].km)})
        </div>
      </div>
    `;
  });

  htmlResult += `</div>`;
  resEl.innerHTML = htmlResult;
}
