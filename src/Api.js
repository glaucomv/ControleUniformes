/**
 * Api.js - Ponto unico de entrada chamado pela interface (google.script.run.api).
 * Cada acao declara a permissao exigida e se grava dados (escrita => LockService).
 * Retorno sempre serializavel: { ok: true, data } ou { ok: false, error }.
 */

function api(action, payload) {
  var execId = Utilities.getUuid();
  var h = HANDLERS[action];
  var user = null;
  Db.reset();
  try {
    if (!h) throw new UserError('Acao desconhecida: ' + action);
    user = Auth.exigir(h.perm);
    var data;
    if (h.write) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) throw new UserError('Sistema ocupado por outro usuario. Tente novamente em instantes.');
      try {
        data = h.fn(payload || {}, user, execId);
        registrarLog(execId, user.email, action, resumoPayload(payload), 'OK');
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    } else {
      data = h.fn(payload || {}, user, execId);
    }
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    var msg = e && e.userMessage ? e.message : traduzirErro(e, execId);
    try { registrarLog(execId, user ? user.email : Auth.emailAtual(), action, msg, 'ERRO'); } catch (ignore) { /* log nunca derruba a resposta */ }
    return { ok: false, error: msg };
  }
}

function traduzirErro(e, execId) {
  var m = String(e && e.message || e);
  if (/permission|permiss|acesso negado|access denied/i.test(m)) {
    return 'Sua conta nao tem acesso a planilha do sistema. Peca ao gestor para compartilha-la com voce (como Editor).';
  }
  return 'Erro inesperado (ref. ' + String(execId).slice(0, 8) + '): ' + m;
}

function resumoPayload(p) {
  if (!p) return '';
  var s = JSON.stringify(p);
  return s.length > 300 ? s.slice(0, 297) + '...' : s;
}

function registrarLog(execId, email, acao, detalhe, status) {
  var sh = Db.sheet('Log');
  if (sh.getLastRow() > LOG_MAX_LINHAS) sh.deleteRows(2, LOG_REMOVER_LINHAS);
  Db.insert('Log', [{ execution_id: execId, data_hora: Db.agora(), usuario: email || '', acao: acao, detalhe: detalhe || '', status: status }]);
}

// =================================================================== contexto
function lerConfig() {
  var c = {};
  Object.keys(CONFIG_PADRAO).forEach(function (k) { c[k] = CONFIG_PADRAO[k]; });
  Db.all('Config').forEach(function (r) { if (r.chave) c[r.chave] = r.valor; });
  return c;
}

function entregasPlanas() {
  var porId = Logic.indexar(Db.all('Entregas'), 'id');
  return Db.all('EntregaItens').map(function (ei) {
    var e = porId[ei.entrega_id] || {};
    return {
      entrega_id: ei.entrega_id, colaborador_id: e.colaborador_id, data: e.data, origem: e.origem,
      item_id: ei.item_id, tamanho: ei.tamanho, quantidade: ei.quantidade, motivo: ei.motivo
    };
  });
}

/** Carrega dados e calcula (sob demanda) pendencias, estoque e pedidos. */
function Contexto() {
  var self = this;
  this.hoje = Db.hoje();
  this.config = lerConfig();
  this.itens = Db.all('Itens');
  this.grades = Db.all('Grades');
  this.itensPorId = Logic.indexar(this.itens, 'id');
  this.gradesPorId = Logic.indexar(this.grades, 'id');
  var memo = {};
  function lazy(nome, fn) { return function () { if (!(nome in memo)) memo[nome] = fn(); return memo[nome]; }; }
  this.entregas = lazy('entregas', entregasPlanas);
  this.pendencias = lazy('pendencias', function () {
    return Logic.calcularPendencias({
      colaboradores: Db.all('Colaboradores'), kits: Db.all('KitCargo'), itens: self.itens,
      entregas: self.entregas(), hoje: self.hoje, toleranciaDias: Number(self.config.tolerancia_dias) || 0
    });
  });
  this.estoque = lazy('estoque', function () {
    return Logic.calcularEstoque({
      recebimentoItens: Db.all('RecebimentoItens'), entregaItens: self.entregas(), ajustes: Db.all('AjustesEstoque')
    });
  });
  this.pedidos = lazy('pedidos', function () {
    return Logic.calcularPedidos({
      pedidos: Db.all('Pedidos'), pedidoItens: Db.all('PedidoItens'), recebimentos: Db.all('Recebimentos'),
      recebimentoItens: Db.all('RecebimentoItens'), hoje: self.hoje
    });
  });
  this.previsao = function (horizonte) {
    return Logic.calcularPrevisao({
      colaboradores: Db.all('Colaboradores'), kits: Db.all('KitCargo'), itens: self.itens,
      hoje: self.hoje, horizonteDias: horizonte
    });
  };
  this.nomeItem = function (id) { return (self.itensPorId[id] || {}).nome || id; };
  this.ordenar = function (lista) { return lista.sort(Logic.comparadorItemTamanho(self.itensPorId, self.gradesPorId)); };
  this.validarLinhas = function (linhas, opts) {
    return Logic.validarLinhas(linhas, { itens: self.itensPorId, grades: self.gradesPorId }, opts);
  };
}

// =================================================================== helpers
function exigirTexto(v, nome) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) throw new UserError('Informe ' + nome + '.');
  return s;
}

function texto(v) { return String(v === undefined || v === null ? '' : v).trim(); }

function exigirData(v, nome, opcional) {
  var d = Logic.normalizarData(v);
  if (d === null) throw new UserError(nome + ' invalida. Use o formato DD/MM/AAAA.');
  if (!d && !opcional) throw new UserError('Informe ' + nome + '.');
  return d;
}

function falharSe(erros) {
  if (erros && erros.length) throw new UserError(erros.slice(0, 8).join('\n') + (erros.length > 8 ? '\n(+' + (erros.length - 8) + ' erros)' : ''));
}

function inteiro(v, nome, min) {
  if (!Logic.isInteiro(v)) throw new UserError(nome + ' deve ser um numero inteiro.');
  var n = Number(v);
  if (min !== undefined && n < min) throw new UserError(nome + ' deve ser no minimo ' + min + '.');
  return n;
}

function nomesMapa(table, campo) {
  var o = {};
  Db.all(table).forEach(function (r) { o[r.id] = r[campo || 'nome']; });
  return o;
}

/** Agrupa linhas repetidas (mesmo item/tamanho[/motivo]) somando quantidades. */
function agregarLinhas(linhas, campos) {
  var out = [], idx = {};
  linhas.forEach(function (l) {
    var k = campos.map(function (c) { return l[c]; }).join('|');
    if (k in idx) out[idx[k]].quantidade += Number(l.quantidade);
    else { idx[k] = out.length; var c = {}; Object.keys(l).forEach(function (f) { c[f] = l[f]; }); c.quantidade = Number(l.quantidade); out.push(c); }
  });
  return out;
}

function resumoColaborador(c) {
  return { id: c.id, matricula: c.matricula, nome: c.nome, cargo_id: c.cargo_id, posto: c.posto, ativo: c.ativo, tamanhos: c.tamanhos, admissao: c.admissao };
}

// =================================================================== handlers
function hBootstrap(p, user) {
  var ctx = new Contexto();
  var pUrl = '';
  try { pUrl = Db.spreadsheet().getUrl(); } catch (e) { /* ignore */ }
  return {
    user: user,
    hoje: ctx.hoje,
    config: ctx.config,
    grades: ctx.grades,
    itens: ctx.itens,
    cargos: Db.all('Cargos'),
    kits: Db.all('KitCargo'),
    fornecedores: Db.all('Fornecedores'),
    colaboradores: Db.all('Colaboradores').map(resumoColaborador),
    perfis: PERFIS,
    planilhaUrl: pUrl
  };
}

function hPainel() {
  var ctx = new Contexto();
  var pend = ctx.pendencias(), est = ctx.estoque(), ped = ctx.pedidos();
  var colabs = Db.all('Colaboradores');
  var nomes = Logic.indexar(colabs, 'id');
  var abertas = pend.filter(function (x) { return x.pendente > 0; });
  var colabsPend = {};
  abertas.forEach(function (x) { colabsPend[x.colaborador_id] = true; });

  // Pendencias por item/tamanho x estoque disponivel
  var porChave = {};
  abertas.forEach(function (x) {
    var k = Logic.chave(x.item_id, x.tamanho || '?');
    if (!porChave[k]) porChave[k] = { item_id: x.item_id, tamanho: x.tamanho || '?', pendente: 0, colaboradores: 0 };
    porChave[k].pendente += x.pendente;
    porChave[k].colaboradores += 1;
  });
  var prontas = 0;
  var porItem = Object.keys(porChave).map(function (k) {
    var l = porChave[k];
    l.estoque = est[k] ? est[k].quantidade : 0;
    l.em_pedido = ped.emPedido[k] || 0;
    l.pronto_entrega = Math.max(0, Math.min(l.pendente, l.estoque));
    prontas += l.pronto_entrega;
    return l;
  });

  var prev = ctx.previsao(90);
  function trocasAte(d) {
    var lim = Logic.addDays(ctx.hoje, d);
    return prev.filter(function (x) { return x.data <= lim; }).reduce(function (s, x) { return s + x.quantidade; }, 0);
  }

  var atrasadas = abertas.filter(function (x) { return x.atrasada; })
    .sort(function (a, b) { return b.dias_em_aberto - a.dias_em_aberto; })
    .slice(0, 50)
    .map(function (x) {
      var c = nomes[x.colaborador_id] || {};
      return { colaborador_id: x.colaborador_id, colaborador: c.nome, matricula: c.matricula, item_id: x.item_id, tamanho: x.tamanho, pendente: x.pendente, dias: x.dias_em_aberto };
    });

  var fornecedores = nomesMapa('Fornecedores');
  var abertos = ped.pedidos.filter(function (x) { return x.aberto; });
  return {
    kpis: {
      colaboradores_ativos: colabs.filter(function (c) { return c.ativo; }).length,
      itens_pendentes: abertas.reduce(function (s, x) { return s + x.pendente; }, 0),
      colaboradores_com_pendencia: Object.keys(colabsPend).length,
      pendencias_atrasadas: abertas.filter(function (x) { return x.atrasada; }).length,
      sem_tamanho: abertas.filter(function (x) { return x.sem_tamanho; }).length,
      prontas_para_entrega: prontas,
      pedidos_abertos: abertos.length,
      saldo_fornecedor: abertos.reduce(function (s, x) { return s + x.total_saldo; }, 0),
      pedidos_atrasados: abertos.filter(function (x) { return x.atrasado; }).length,
      trocas_30: trocasAte(30), trocas_60: trocasAte(60), trocas_90: trocasAte(90)
    },
    atrasadas: atrasadas,
    porItem: ctx.ordenar(porItem),
    pedidosAtrasados: abertos.filter(function (x) { return x.atrasado; }).map(function (x) {
      return { id: x.id, fornecedor: fornecedores[x.fornecedor_id], previsao_entrega: x.previsao_entrega, total_saldo: x.total_saldo };
    }),
    tolerancia: ctx.config.tolerancia_dias
  };
}

// ------------------------------------------------------------- colaboradores
function hColaboradoresList() {
  var ctx = new Contexto();
  var resumo = {};
  ctx.pendencias().forEach(function (x) {
    var r = resumo[x.colaborador_id] = resumo[x.colaborador_id] || { pendentes: 0, atrasada: false, sem_tamanho: false };
    r.pendentes += x.pendente;
    r.atrasada = r.atrasada || x.atrasada;
    r.sem_tamanho = r.sem_tamanho || x.sem_tamanho;
  });
  var cargos = nomesMapa('Cargos');
  return Db.all('Colaboradores').map(function (c) {
    var r = resumo[c.id] || { pendentes: 0, atrasada: false, sem_tamanho: false };
    var o = resumoColaborador(c);
    o.cargo = cargos[c.cargo_id] || '';
    o.pendentes = r.pendentes; o.atrasada = r.atrasada; o.sem_tamanho = r.sem_tamanho;
    return o;
  }).sort(function (a, b) { return a.nome < b.nome ? -1 : (a.nome > b.nome ? 1 : 0); });
}

function hColaboradorFicha(p) {
  var c = Db.find('Colaboradores', p.id);
  if (!c) throw new UserError('Colaborador nao encontrado.');
  var ctx = new Contexto();
  var pend = ctx.pendencias().filter(function (x) { return x.colaborador_id === c.id; });
  var itensEntrega = Logic.agrupar(Db.all('EntregaItens'), function (i) { return i.entrega_id; });
  var historico = Db.all('Entregas').filter(function (e) { return e.colaborador_id === c.id; })
    .sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : (a.id < b.id ? 1 : -1)); })
    .map(function (e) {
      return { id: e.id, data: e.data, origem: e.origem, entregue_por: e.entregue_por, obs: e.obs, itens: itensEntrega[e.id] || [] };
    });
  var cargo = Db.find('Cargos', c.cargo_id) || {};
  return { colaborador: c, cargo: cargo.nome || '', pendencias: ctx.ordenar(pend), historico: historico };
}

function hColaboradorSave(p, user) {
  var nome = exigirTexto(p.nome, 'o nome');
  if (!Db.find('Cargos', p.cargo_id)) throw new UserError('Selecione um cargo valido.');
  var admissao = exigirData(p.admissao, 'Data de admissao');
  var desligamento = exigirData(p.desligamento, 'Data de desligamento', true);
  var matricula = texto(p.matricula);
  if (matricula) {
    var dup = Db.all('Colaboradores').filter(function (c) { return c.matricula === matricula && c.id !== p.id; })[0];
    if (dup) throw new UserError('Matricula ' + matricula + ' ja pertence a ' + dup.nome + '.');
  }
  var grades = Logic.indexar(Db.all('Grades'), 'id');
  var tamanhos = {};
  Object.keys(p.tamanhos || {}).forEach(function (g) {
    var t = texto(p.tamanhos[g]);
    if (!t) return;
    if (!grades[g]) throw new UserError('Grade desconhecida: ' + g);
    if (Logic.tamanhosDaGrade(grades[g]).indexOf(t) < 0) throw new UserError('Tamanho "' + t + '" invalido para ' + grades[g].nome + '.');
    tamanhos[g] = t;
  });
  var dados = {
    matricula: matricula, nome: nome, cargo_id: p.cargo_id, posto: texto(p.posto), admissao: admissao,
    tamanhos: tamanhos, telefone: texto(p.telefone), ativo: p.ativo !== false, desligamento: desligamento,
    obs: texto(p.obs), atualizado_em: Db.agora()
  };
  if (p.id) {
    Db.update('Colaboradores', p.id, dados);
    return { id: p.id };
  }
  dados.id = Db.nextId('Colaboradores', 'COL', 5);
  dados.criado_em = Db.agora();
  Db.insert('Colaboradores', [dados]);
  return { id: dados.id };
}

// ------------------------------------------------------------- entregas
function hEntregasList(p) {
  var colabs = Logic.indexar(Db.all('Colaboradores'), 'id');
  var itensEntrega = Logic.agrupar(Db.all('EntregaItens'), function (i) { return i.entrega_id; });
  var lista = Db.all('Entregas').filter(function (e) { return !p.colaborador_id || e.colaborador_id === p.colaborador_id; })
    .sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : (a.id < b.id ? 1 : -1)); });
  var limite = Number(p.limite) || 300;
  return lista.slice(0, limite).map(function (e) {
    var c = colabs[e.colaborador_id] || {};
    return { id: e.id, data: e.data, origem: e.origem, colaborador_id: e.colaborador_id, colaborador: c.nome, matricula: c.matricula, entregue_por: e.entregue_por, itens: itensEntrega[e.id] || [] };
  });
}

function hEntregaCriar(p, user) {
  var c = Db.find('Colaboradores', p.colaborador_id);
  if (!c) throw new UserError('Selecione o colaborador.');
  if (!c.ativo) throw new UserError('Colaborador inativo.');
  var ctx = new Contexto();
  var data = exigirData(p.data || ctx.hoje, 'Data da entrega');
  if (data > ctx.hoje) throw new UserError('A data da entrega nao pode ser futura.');
  var linhas = (p.itens || []).filter(function (l) { return String(l.quantidade === undefined ? '' : l.quantidade).trim() !== '' && Number(l.quantidade) !== 0; })
    .map(function (l) { return { item_id: l.item_id, tamanho: texto(l.tamanho), quantidade: l.quantidade, motivo: l.motivo || Logic.MOTIVO_KIT }; });
  falharSe(ctx.validarLinhas(linhas, { exigeMotivo: true }));
  linhas = agregarLinhas(linhas, ['item_id', 'tamanho', 'motivo']);
  falharSe(Logic.validarDisponibilidade(linhas, ctx.estoque(), ctx.nomeItem));
  var id = Db.nextId('Entregas', 'ENT');
  Db.insert('Entregas', [{ id: id, colaborador_id: c.id, data: data, obs: texto(p.obs), origem: 'SISTEMA', entregue_por: user.email, criado_em: Db.agora() }]);
  Db.insert('EntregaItens', linhas.map(function (l, i) {
    return { id: id + '-' + (i + 1), entrega_id: id, item_id: l.item_id, tamanho: l.tamanho, quantidade: l.quantidade, motivo: l.motivo };
  }));
  return { id: id };
}

function hTermo(p) {
  var e = Db.find('Entregas', p.id);
  if (!e) throw new UserError('Entrega nao encontrada.');
  var c = Db.find('Colaboradores', e.colaborador_id) || {};
  var cargo = Db.find('Cargos', c.cargo_id) || {};
  var itens = Db.all('EntregaItens').filter(function (i) { return i.entrega_id === e.id; });
  var usuario = Db.find('Usuarios', e.entregue_por) || {};
  return { entrega: e, colaborador: c, cargo: cargo.nome || '', itens: itens, entregue_por_nome: usuario.nome || e.entregue_por, config: lerConfig() };
}

// ------------------------------------------------------------- estoque
function hEstoque() {
  var ctx = new Contexto();
  var est = ctx.estoque(), ped = ctx.pedidos();
  var demanda = {};
  ctx.pendencias().forEach(function (x) {
    if (x.pendente > 0 && x.tamanho) { var k = Logic.chave(x.item_id, x.tamanho); demanda[k] = (demanda[k] || 0) + x.pendente; }
  });
  var chaves = {};
  [est, demanda, ped.emPedido].forEach(function (m) { Object.keys(m).forEach(function (k) { chaves[k] = true; }); });
  var linhas = Object.keys(chaves).map(function (k) {
    var l = Logic.separarChave(k);
    l.estoque = est[k] ? est[k].quantidade : 0;
    l.pendente = demanda[k] || 0;
    l.em_pedido = ped.emPedido[k] || 0;
    l.saldo_apos = l.estoque - l.pendente;
    return l;
  });
  var ajustes = Db.all('AjustesEstoque').slice(-50).reverse();
  return { linhas: ctx.ordenar(linhas), ajustes: ajustes };
}

function hAjusteEstoque(p, user) {
  var ctx = new Contexto();
  var linha = { item_id: p.item_id, tamanho: texto(p.tamanho), quantidade: p.quantidade };
  falharSe(ctx.validarLinhas([linha], { permiteNegativo: true }));
  var motivo = exigirTexto(p.motivo, 'o motivo do ajuste');
  var data = exigirData(p.data || ctx.hoje, 'Data');
  var q = Number(p.quantidade);
  if (q < 0) {
    var atual = (ctx.estoque()[Logic.chave(linha.item_id, linha.tamanho)] || { quantidade: 0 }).quantidade;
    if (atual + q < 0) throw new UserError('O ajuste deixaria o estoque negativo (atual: ' + atual + ').');
  }
  var id = Db.nextId('AjustesEstoque', 'AJU');
  Db.insert('AjustesEstoque', [{ id: id, data: data, item_id: linha.item_id, tamanho: linha.tamanho, quantidade: q, motivo: motivo, usuario: user.email, criado_em: Db.agora() }]);
  return { id: id };
}

// ------------------------------------------------------------- compras
function hSugestao(p) {
  var ctx = new Contexto();
  var horizonte = p.horizonte === undefined || p.horizonte === '' ? Number(ctx.config.horizonte_previsao_dias) || 0 : Number(p.horizonte) || 0;
  var sug = Logic.calcularSugestao({
    pendencias: ctx.pendencias(), previsao: horizonte > 0 ? ctx.previsao(horizonte) : [],
    estoque: ctx.estoque(), emPedido: ctx.pedidos().emPedido
  });
  var colabs = Logic.indexar(Db.all('Colaboradores'), 'id');
  var semTamanho = {};
  sug.semTamanho.forEach(function (x) {
    var k = x.colaborador_id + '|' + x.item_id;
    if (!semTamanho[k]) semTamanho[k] = { colaborador_id: x.colaborador_id, colaborador: (colabs[x.colaborador_id] || {}).nome, item_id: x.item_id };
  });
  return { horizonte: horizonte, linhas: ctx.ordenar(sug.linhas), semTamanho: Object.keys(semTamanho).map(function (k) { return semTamanho[k]; }) };
}

function hPedidosList() {
  var ctx = new Contexto();
  var forn = nomesMapa('Fornecedores');
  return ctx.pedidos().pedidos.map(function (x) {
    return {
      id: x.id, fornecedor_id: x.fornecedor_id, fornecedor: forn[x.fornecedor_id], data: x.data, previsao_entrega: x.previsao_entrega,
      status: x.status, atrasado: x.atrasado, total_pedido: x.total_pedido, total_recebido: x.total_recebido,
      total_saldo: x.total_saldo, total_rejeitado: x.total_rejeitado, divergencias: x.nao_pedidos.length + (x.total_rejeitado > 0 ? 1 : 0)
    };
  }).sort(function (a, b) { return a.id < b.id ? 1 : -1; });
}

function hPedidoGet(p) {
  var ctx = new Contexto();
  var ped = ctx.pedidos().pedidos.filter(function (x) { return x.id === p.id; })[0];
  if (!ped) throw new UserError('Pedido nao encontrado.');
  var itensRec = Logic.agrupar(Db.all('RecebimentoItens'), function (i) { return i.recebimento_id; });
  var recebimentos = Db.all('Recebimentos').filter(function (r) { return r.pedido_id === ped.id; }).map(function (r) {
    return { id: r.id, data: r.data, nota_fiscal: r.nota_fiscal, obs: r.obs, recebido_por: r.recebido_por, itens: itensRec[r.id] || [] };
  });
  var forn = Db.find('Fornecedores', ped.fornecedor_id) || {};
  ped.itens = ctx.ordenar(ped.itens);
  return { pedido: ped, fornecedor: forn, recebimentos: recebimentos, divergencias: Logic.divergenciasPedido(ped) };
}

function hPedidoCriar(p, user) {
  var ctx = new Contexto();
  var f = Db.find('Fornecedores', p.fornecedor_id);
  if (!f) throw new UserError('Selecione o fornecedor.');
  var data = exigirData(p.data || ctx.hoje, 'Data do pedido');
  var previsao = exigirData(p.previsao_entrega, 'Previsao de entrega', true);
  if (previsao && previsao < data) throw new UserError('A previsao de entrega nao pode ser anterior a data do pedido.');
  var linhas = (p.itens || []).map(function (l) { return { item_id: l.item_id, tamanho: texto(l.tamanho), quantidade: l.quantidade }; });
  falharSe(ctx.validarLinhas(linhas));
  linhas = agregarLinhas(linhas, ['item_id', 'tamanho']);
  var id = Db.nextId('Pedidos', 'PED');
  Db.insert('Pedidos', [{ id: id, fornecedor_id: f.id, data: data, previsao_entrega: previsao, status: 'ABERTO', obs: texto(p.obs), criado_por: user.email, criado_em: Db.agora() }]);
  Db.insert('PedidoItens', linhas.map(function (l, i) {
    return { id: id + '-' + (i + 1), pedido_id: id, item_id: l.item_id, tamanho: l.tamanho, quantidade: l.quantidade };
  }));
  return { id: id };
}

function hPedidoStatus(p) {
  var ctx = new Contexto();
  var ped = ctx.pedidos().pedidos.filter(function (x) { return x.id === p.id; })[0];
  if (!ped) throw new UserError('Pedido nao encontrado.');
  var novo = p.status;
  if (['ABERTO', 'CANCELADO', 'ENCERRADO'].indexOf(novo) < 0) throw new UserError('Status invalido.');
  if (novo === 'CANCELADO' && ped.total_recebido > 0) throw new UserError('Pedido com recebimentos nao pode ser cancelado. Use "Encerrar com pendencia".');
  Db.update('Pedidos', p.id, { status: novo, obs: texto(p.obs) ? (ped.obs ? ped.obs + ' | ' : '') + texto(p.obs) : ped.obs });
  return { id: p.id };
}

function hRecebimentosList() {
  var pedidos = Logic.indexar(Db.all('Pedidos'), 'id');
  var forn = nomesMapa('Fornecedores');
  var itens = Logic.agrupar(Db.all('RecebimentoItens'), function (i) { return i.recebimento_id; });
  return Db.all('Recebimentos').map(function (r) {
    var its = itens[r.id] || [];
    var ped = pedidos[r.pedido_id] || {};
    return {
      id: r.id, pedido_id: r.pedido_id, fornecedor: forn[ped.fornecedor_id] || '', data: r.data, nota_fiscal: r.nota_fiscal,
      recebido_por: r.recebido_por,
      total_recebido: its.reduce(function (s, i) { return s + i.qtd_recebida; }, 0),
      total_rejeitado: its.reduce(function (s, i) { return s + i.qtd_rejeitada; }, 0)
    };
  }).sort(function (a, b) { return a.id < b.id ? 1 : -1; });
}

function hRecebimentoCriar(p, user) {
  var ctx = new Contexto();
  var pedidoId = texto(p.pedido_id);
  if (pedidoId) {
    var ped = ctx.pedidos().pedidos.filter(function (x) { return x.id === pedidoId; })[0];
    if (!ped) throw new UserError('Pedido nao encontrado.');
    if (!ped.aberto) throw new UserError('O pedido ' + pedidoId + ' esta ' + ped.status + '. Reabra-o para registrar recebimento.');
  }
  var data = exigirData(p.data || ctx.hoje, 'Data do recebimento');
  if (data > ctx.hoje) throw new UserError('A data do recebimento nao pode ser futura.');
  var linhas = (p.itens || []).filter(function (l) { return Number(l.qtd_recebida) > 0 || Number(l.qtd_rejeitada) > 0; })
    .map(function (l) {
      return { item_id: l.item_id, tamanho: texto(l.tamanho), qtd_recebida: l.qtd_recebida, qtd_rejeitada: l.qtd_rejeitada || 0, motivo_rejeicao: texto(l.motivo_rejeicao) };
    });
  var erros = ctx.validarLinhas(linhas, { campoQtd: 'qtd_recebida' });
  linhas.forEach(function (l, i) {
    if (!Logic.isInteiro(l.qtd_rejeitada) || Number(l.qtd_rejeitada) < 0 || Number(l.qtd_rejeitada) > Number(l.qtd_recebida)) {
      erros.push('Linha ' + (i + 1) + ': quantidade rejeitada deve estar entre 0 e a quantidade recebida.');
    } else if (Number(l.qtd_rejeitada) > 0 && !l.motivo_rejeicao) {
      erros.push('Linha ' + (i + 1) + ': informe o motivo da rejeicao.');
    }
  });
  falharSe(erros);
  var id = Db.nextId('Recebimentos', 'REC');
  Db.insert('Recebimentos', [{ id: id, pedido_id: pedidoId, data: data, nota_fiscal: texto(p.nota_fiscal), obs: texto(p.obs), recebido_por: user.email, criado_em: Db.agora() }]);
  Db.insert('RecebimentoItens', linhas.map(function (l, i) {
    return { id: id + '-' + (i + 1), recebimento_id: id, item_id: l.item_id, tamanho: l.tamanho, qtd_recebida: Number(l.qtd_recebida), qtd_rejeitada: Number(l.qtd_rejeitada), motivo_rejeicao: l.motivo_rejeicao };
  }));
  var resultado = { id: id, pedido_id: pedidoId, divergencias: [], status: null };
  if (pedidoId) {
    var depois = new Contexto().pedidos().pedidos.filter(function (x) { return x.id === pedidoId; })[0];
    resultado.divergencias = Logic.divergenciasPedido(depois);
    resultado.status = depois.status;
  }
  return resultado;
}

// ------------------------------------------------------------- cadastros
function hGradeSave(p) {
  var id = exigirTexto(p.id, 'o codigo da grade').toUpperCase();
  if (!/^[A-Z0-9_]{2,20}$/.test(id)) throw new UserError('Codigo da grade: use 2 a 20 letras, numeros ou _ (ex.: CAMISA).');
  var tamanhos = exigirTexto(p.tamanhos, 'os tamanhos').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (id === Logic.GRADE_UNICA) tamanhos = [Logic.TAMANHO_UNICO];
  var vistos = {};
  tamanhos.forEach(function (t) { if (vistos[t]) throw new UserError('Tamanho repetido: ' + t); vistos[t] = true; });
  var dados = { id: id, nome: exigirTexto(p.nome, 'o nome da grade'), tamanhos: tamanhos.join(','), ordem: Number(p.ordem) || 0, ativo: p.ativo !== false };
  if (Db.find('Grades', id)) Db.update('Grades', id, dados);
  else Db.insert('Grades', [dados]);
  return { id: id };
}

function hItemSave(p) {
  var nome = exigirTexto(p.nome, 'o nome do item');
  if (!Db.find('Grades', p.grade_id)) throw new UserError('Selecione a grade de tamanhos.');
  var dup = Db.all('Itens').filter(function (i) { return i.nome.toLowerCase() === nome.toLowerCase() && i.id !== p.id; })[0];
  if (dup) throw new UserError('Ja existe um item chamado "' + nome + '".');
  var dados = { nome: nome, grade_id: p.grade_id, unidade: texto(p.unidade) || 'un', ativo: p.ativo !== false };
  if (p.id) { Db.update('Itens', p.id, dados); return { id: p.id }; }
  dados.id = Db.nextId('Itens', 'ITM', 4);
  dados.criado_em = Db.agora();
  Db.insert('Itens', [dados]);
  return { id: dados.id };
}

function hCargoSave(p) {
  var nome = exigirTexto(p.nome, 'o nome do cargo');
  var dup = Db.all('Cargos').filter(function (c) { return c.nome.toLowerCase() === nome.toLowerCase() && c.id !== p.id; })[0];
  if (dup) throw new UserError('Ja existe o cargo "' + nome + '".');
  var dados = { nome: nome, ativo: p.ativo !== false };
  if (p.id) { Db.update('Cargos', p.id, dados); return { id: p.id }; }
  dados.id = Db.nextId('Cargos', 'CAR', 3);
  Db.insert('Cargos', [dados]);
  return { id: dados.id };
}

function hKitSave(p) {
  if (!Db.find('Cargos', p.cargo_id)) throw new UserError('Cargo invalido.');
  var itens = Logic.indexar(Db.all('Itens'), 'id');
  var vistos = {};
  var novos = (p.itens || []).map(function (l, i) {
    var n = 'Linha ' + (i + 1) + ': ';
    if (!itens[l.item_id]) throw new UserError(n + 'item invalido.');
    if (vistos[l.item_id]) throw new UserError(n + 'item repetido no kit.');
    vistos[l.item_id] = true;
    return {
      id: p.cargo_id + '-' + l.item_id, cargo_id: p.cargo_id, item_id: l.item_id,
      quantidade: inteiro(l.quantidade, n + 'quantidade', 1),
      periodicidade_meses: inteiro(l.periodicidade_meses === '' || l.periodicidade_meses === undefined ? 0 : l.periodicidade_meses, n + 'periodicidade', 0)
    };
  });
  var outros = Db.all('KitCargo').filter(function (k) { return k.cargo_id !== p.cargo_id; });
  Db.rewrite('KitCargo', outros.concat(novos));
  return { cargo_id: p.cargo_id, itens: novos.length };
}

function hFornecedorSave(p) {
  var dados = {
    nome: exigirTexto(p.nome, 'o nome do fornecedor'), cnpj: texto(p.cnpj), contato: texto(p.contato),
    telefone: texto(p.telefone), email: texto(p.email), ativo: p.ativo !== false
  };
  if (p.id) { Db.update('Fornecedores', p.id, dados); return { id: p.id }; }
  dados.id = Db.nextId('Fornecedores', 'FOR', 3);
  Db.insert('Fornecedores', [dados]);
  return { id: dados.id };
}

function hUsuariosList() { return Db.all('Usuarios'); }

function hUsuarioSave(p, user) {
  var email = exigirTexto(p.email, 'o e-mail').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('E-mail invalido.');
  if (PERFIS.indexOf(p.perfil) < 0) throw new UserError('Perfil invalido.');
  var ativo = p.ativo !== false;
  var gestoresAtivos = Db.all('Usuarios').filter(function (u) { return u.ativo && u.perfil === 'GESTOR' && u.email !== email; });
  if ((!ativo || p.perfil !== 'GESTOR') && gestoresAtivos.length === 0) throw new UserError('O sistema precisa de ao menos um GESTOR ativo.');
  var dados = { email: email, nome: texto(p.nome), perfil: p.perfil, ativo: ativo };
  var existente = Db.find('Usuarios', email);
  if (existente) Db.update('Usuarios', email, dados);
  else { dados.criado_em = Db.agora(); Db.insert('Usuarios', [dados]); }
  var compartilhado = false, aviso = '';
  if (ativo && !existente) {
    try { Db.spreadsheet().addEditor(email); compartilhado = true; } catch (e) {
      aviso = 'Nao foi possivel compartilhar a planilha automaticamente. Compartilhe-a manualmente com ' + email + ' (Editor).';
    }
  }
  return { email: email, compartilhado: compartilhado, aviso: aviso };
}

function hConfigSave(p) {
  var permitidas = Object.keys(CONFIG_PADRAO);
  if (p.tolerancia_dias !== undefined) inteiro(p.tolerancia_dias, 'Tolerancia', 0);
  if (p.horizonte_previsao_dias !== undefined) inteiro(p.horizonte_previsao_dias, 'Horizonte de previsao', 0);
  var atual = lerConfig();
  permitidas.forEach(function (k) { if (p[k] !== undefined) atual[k] = texto(p[k]); });
  Db.rewrite('Config', permitidas.map(function (k) { return { chave: k, valor: atual[k] }; }));
  return atual;
}

function hImportar(p, user) { return Importacao.executar(p.tipo, user); }

var HANDLERS = {
  'bootstrap': { perm: 'ver', fn: hBootstrap },
  'painel': { perm: 'ver', fn: hPainel },
  'colaboradores.list': { perm: 'ver', fn: hColaboradoresList },
  'colaboradores.ficha': { perm: 'ver', fn: hColaboradorFicha },
  'colaboradores.save': { perm: 'colaboradores', fn: hColaboradorSave, write: true },
  'entregas.list': { perm: 'ver', fn: hEntregasList },
  'entregas.criar': { perm: 'entregas', fn: hEntregaCriar, write: true },
  'entregas.termo': { perm: 'ver', fn: hTermo },
  'estoque.get': { perm: 'ver', fn: hEstoque },
  'estoque.ajustar': { perm: 'estoque', fn: hAjusteEstoque, write: true },
  'sugestao.get': { perm: 'ver', fn: hSugestao },
  'pedidos.list': { perm: 'ver', fn: hPedidosList },
  'pedidos.get': { perm: 'ver', fn: hPedidoGet },
  'pedidos.criar': { perm: 'pedidos', fn: hPedidoCriar, write: true },
  'pedidos.status': { perm: 'pedidos', fn: hPedidoStatus, write: true },
  'recebimentos.list': { perm: 'ver', fn: hRecebimentosList },
  'recebimentos.criar': { perm: 'recebimentos', fn: hRecebimentoCriar, write: true },
  'grades.save': { perm: 'admin', fn: hGradeSave, write: true },
  'itens.save': { perm: 'admin', fn: hItemSave, write: true },
  'cargos.save': { perm: 'admin', fn: hCargoSave, write: true },
  'kit.save': { perm: 'admin', fn: hKitSave, write: true },
  'fornecedores.save': { perm: 'fornecedores', fn: hFornecedorSave, write: true },
  'usuarios.list': { perm: 'admin', fn: hUsuariosList },
  'usuarios.save': { perm: 'admin', fn: hUsuarioSave, write: true },
  'config.save': { perm: 'admin', fn: hConfigSave, write: true },
  'importar': { perm: 'admin', fn: hImportar, write: true }
};
