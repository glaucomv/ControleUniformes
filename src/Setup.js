/**
 * Setup.js - Menu da planilha, configuracao inicial e dados de demonstracao.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Uniformes')
    .addItem('Abrir o sistema', 'menuAbrirSistema')
    .addSeparator()
    .addItem('Configurar planilha (1a vez / apos atualizar)', 'menuConfigurar')
    .addSubMenu(ui.createMenu('Importar')
      .addItem('Colaboradores', 'menuImportarColaboradores')
      .addItem('Entregas historicas', 'menuImportarEntregas')
      .addItem('Estoque inicial', 'menuImportarEstoque')
      .addSeparator()
      .addItem('Recriar modelos de importacao (abas vazias)', 'menuRecriarModelos'))
    .addSeparator()
    .addItem('Carregar dados de demonstracao', 'menuDemo')
    .addToUi();
}

function menuConfigurar() {
  var r = configurarPlanilha();
  SpreadsheetApp.getUi().alert('Configuracao concluida',
    'Abas criadas: ' + (r.criadas.join(', ') || 'nenhuma (ja existiam)') + '\n' +
    (r.gestor ? 'Voce (' + r.gestor + ') foi cadastrado como GESTOR.\n' : '') +
    '\nProximo passo: publique o Web App (Extensoes > Apps Script > Implantar).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuAbrirSistema() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('O sistema ainda nao foi publicado. Veja docs/IMPLANTACAO.md (passo "Publicar o Web App").');
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif"><p>Endereco do sistema (salve nos favoritos e compartilhe com a equipe):</p>' +
    '<p><a href="' + url + '" target="_blank">' + url + '</a></p></div>').setWidth(520).setHeight(160);
  ui.showModalDialog(html, 'Controle de Uniformes');
}

function menuImportar_(tipo) {
  var ui = SpreadsheetApp.getUi();
  var r = api('importar', { tipo: tipo });
  ui.alert('Importacao', r.ok ? r.data.mensagem : r.error, ui.ButtonSet.OK);
}
function menuImportarColaboradores() { menuImportar_('colaboradores'); }
function menuImportarEntregas() { menuImportar_('entregas'); }
function menuImportarEstoque() { menuImportar_('estoque'); }

function menuRecriarModelos() {
  Db.reset();
  var feitos = [];
  Object.keys(MODELOS_IMPORTACAO).forEach(function (t) {
    try { Importacao.criarModelo(t, true); feitos.push(MODELOS_IMPORTACAO[t].aba); } catch (e) { feitos.push(MODELOS_IMPORTACAO[t].aba + ' (ignorada: ' + e.message + ')'); }
  });
  SpreadsheetApp.getUi().alert('Modelos de importacao:\n' + feitos.join('\n'));
}

function menuDemo() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Dados de demonstracao', 'Isso cria itens, cargos, colaboradores, pedidos e entregas FICTICIOS. ' +
    'So funciona com a planilha sem colaboradores. Continuar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  try { ui.alert(carregarDemo()); } catch (e) { ui.alert(e.message); }
}

/** Cria/atualiza todas as abas do esquema. Idempotente. */
function configurarPlanilha() {
  Db.reset();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('America/Sao_Paulo');
  var criadas = [];
  Object.keys(SCHEMA).forEach(function (table) {
    var d = Db.def(table);
    var sh = ss.getSheetByName(table);
    if (!sh) { sh = ss.insertSheet(table); criadas.push(table); }
    var n = d._f.length;
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    sh.getRange(1, 1, 1, n).setValues([d._f.map(function (f) { return f.name; })])
      .setFontWeight('bold').setBackground('#dbeafe');
    sh.setFrozenRows(1);
    d._f.forEach(function (f, j) {
      if (sh.getMaxRows() > 1) sh.getRange(2, j + 1, sh.getMaxRows() - 1, 1).setNumberFormat(Db.formatoColuna(f.type));
    });
  });
  // Remove a aba padrao vazia criada pelo Google
  ['Sheet1', 'Pagina1', 'Página1', 'Planilha1'].forEach(function (nome) {
    var sh = ss.getSheetByName(nome);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  Db.reset();
  if (!Db.all('Grades').length) Db.insert('Grades', GRADES_PADRAO);
  if (!Db.all('Config').length) {
    Db.insert('Config', Object.keys(CONFIG_PADRAO).map(function (k) { return { chave: k, valor: CONFIG_PADRAO[k] }; }));
  }
  var gestor = null;
  if (!Db.all('Usuarios').length) {
    gestor = Auth.emailAtual();
    if (gestor) Db.insert('Usuarios', [{ email: gestor, nome: 'Gestor', perfil: 'GESTOR', ativo: true, criado_em: Db.agora() }]);
  }
  Object.keys(MODELOS_IMPORTACAO).forEach(function (t) { if (Importacao.criarModelo(t, false)) criadas.push(MODELOS_IMPORTACAO[t].aba); });
  return { criadas: criadas, gestor: gestor };
}

/** Carrega um cenario ficticio completo para treinamento. */
function carregarDemo() {
  Db.reset();
  if (Db.all('Colaboradores').length) throw new UserError('Ja existem colaboradores cadastrados. A demonstracao so pode ser carregada em planilha vazia.');
  var user = Auth.usuarioAtual();
  var hoje = Db.hoje();
  function ok(r) { if (!r.ok) throw new UserError(r.error); return r.data; }
  var call = function (acao, p) { return ok(api(acao, p)); };

  var camisa = call('itens.save', { nome: 'Camisa polo', grade_id: 'CAMISA' }).id;
  var calca = call('itens.save', { nome: 'Calca operacional', grade_id: 'CALCA' }).id;
  var botina = call('itens.save', { nome: 'Botina de seguranca', grade_id: 'CALCADO', unidade: 'par' }).id;
  var jaqueta = call('itens.save', { nome: 'Jaqueta', grade_id: 'CAMISA' }).id;
  var bone = call('itens.save', { nome: 'Bone', grade_id: 'UNICO' }).id;

  var vig = call('cargos.save', { nome: 'Vigilante' }).id;
  var limp = call('cargos.save', { nome: 'Auxiliar de limpeza' }).id;
  call('kit.save', { cargo_id: vig, itens: [
    { item_id: camisa, quantidade: 3, periodicidade_meses: 6 }, { item_id: calca, quantidade: 2, periodicidade_meses: 6 },
    { item_id: botina, quantidade: 1, periodicidade_meses: 12 }, { item_id: jaqueta, quantidade: 1, periodicidade_meses: 0 }] });
  call('kit.save', { cargo_id: limp, itens: [
    { item_id: camisa, quantidade: 3, periodicidade_meses: 6 }, { item_id: calca, quantidade: 2, periodicidade_meses: 6 },
    { item_id: botina, quantidade: 1, periodicidade_meses: 12 }, { item_id: bone, quantidade: 1, periodicidade_meses: 12 }] });

  var forn = call('fornecedores.save', { nome: 'Confeccoes Exemplo Ltda', contato: 'Fulano', telefone: '(21) 0000-0000' }).id;

  var nomes = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Alves', 'Elaine Rocha', 'Fabio Nunes',
    'Gabriela Reis', 'Henrique Melo', 'Isabela Costa', 'Joao Pereira', 'Karina Lopes', 'Lucas Martins'];
  var tCam = ['P', 'M', 'G', 'GG'], tCal = ['38', '40', '42', '44', '46'], tCalc = ['36', '38', '40', '41', '42', '43'];
  var colabs = nomes.map(function (n, i) {
    return call('colaboradores.save', {
      matricula: String(1001 + i), nome: n, cargo_id: i % 3 === 2 ? limp : vig, posto: i % 2 ? 'Posto Centro' : 'Posto Sul',
      admissao: Logic.addDays(Logic.addMonths(hoje, -(i * 2 + 1)), -i),
      tamanhos: i === 11 ? {} : { CAMISA: tCam[i % 4], CALCA: tCal[i % 5], CALCADO: tCalc[i % 6] }
    }).id;
  });

  call('estoque.ajustar', { item_id: camisa, tamanho: 'M', quantidade: 6, motivo: 'Inventario inicial (demo)' });
  call('estoque.ajustar', { item_id: bone, tamanho: 'U', quantidade: 5, motivo: 'Inventario inicial (demo)' });

  var ped = call('pedidos.criar', {
    fornecedor_id: forn, data: Logic.addDays(hoje, -20), previsao_entrega: Logic.addDays(hoje, -5),
    itens: [{ item_id: camisa, tamanho: 'G', quantidade: 10 }, { item_id: calca, tamanho: '42', quantidade: 6 },
      { item_id: botina, tamanho: '41', quantidade: 4 }, { item_id: botina, tamanho: '42', quantidade: 4 }]
  }).id;
  call('recebimentos.criar', {
    pedido_id: ped, data: Logic.addDays(hoje, -3), nota_fiscal: '12345',
    itens: [{ item_id: camisa, tamanho: 'G', qtd_recebida: 10, qtd_rejeitada: 1, motivo_rejeicao: 'Costura com defeito' },
      { item_id: calca, tamanho: '42', qtd_recebida: 4, qtd_rejeitada: 0 },
      { item_id: botina, tamanho: '43', qtd_recebida: 4, qtd_rejeitada: 0 }]
  });

  call('entregas.criar', { colaborador_id: colabs[1], data: Logic.addDays(hoje, -2), itens: [
    { item_id: camisa, tamanho: 'M', quantidade: 2, motivo: 'KIT' }] });
  call('entregas.criar', { colaborador_id: colabs[2], data: Logic.addDays(hoje, -1), itens: [
    { item_id: camisa, tamanho: 'G', quantidade: 3, motivo: 'KIT' }, { item_id: bone, tamanho: 'U', quantidade: 1, motivo: 'KIT' }] });

  return 'Demonstracao carregada para ' + user.email + ': 5 itens, 2 cargos, 12 colaboradores, 1 pedido parcial e 2 entregas.';
}

