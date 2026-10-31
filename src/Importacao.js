/**
 * Importacao.js - Importacao das planilhas atuais via abas-modelo.
 *
 * Fluxo: o gestor cola os dados na aba "Importar_*", executa a importacao
 * (menu Uniformes > Importar ou Cadastros > Importacao). A importacao e
 * "tudo ou nada": se houver qualquer erro, nada e gravado e cada linha recebe
 * o erro na coluna "status". Linhas ja importadas sao ignoradas.
 */
var MODELOS_IMPORTACAO = {
  colaboradores: {
    aba: 'Importar_Colaboradores',
    colunas: function () {
      var tams = Db.all('Grades').filter(function (g) { return g.ativo && g.id !== Logic.GRADE_UNICA; })
        .map(function (g) { return 'tam_' + g.id; });
      return ['matricula', 'nome', 'cargo', 'posto', 'admissao', 'telefone'].concat(tams).concat(['status']);
    },
    ajuda: 'Uma linha por colaborador. admissao: DD/MM/AAAA. Colunas tam_*: tamanho conforme a grade. ' +
      'Se a matricula ja existir, o cadastro e atualizado. Cargos inexistentes sao criados.'
  },
  entregas: {
    aba: 'Importar_Entregas',
    colunas: function () { return ['matricula', 'data', 'item', 'tamanho', 'quantidade', 'motivo', 'status']; },
    ajuda: 'Historico de entregas ja realizadas (nao baixa estoque). motivo: KIT ou SUBSTITUICAO (vazio = KIT). ' +
      'item: nome exatamente como cadastrado em Itens.'
  },
  estoque: {
    aba: 'Importar_Estoque',
    colunas: function () { return ['item', 'tamanho', 'quantidade', 'status']; },
    ajuda: 'Saldo inicial do estoque (inventario). Gera ajustes de entrada.'
  }
};

var Importacao = (function () {

  function celula(v) {
    if (v instanceof Date) return Utilities.formatDate(v, Db.timeZone(), 'yyyy-MM-dd');
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function criarModelo(tipo, forcar) {
    var m = MODELOS_IMPORTACAO[tipo];
    var ss = Db.spreadsheet();
    var sh = ss.getSheetByName(m.aba);
    if (sh && !forcar) return false;
    if (sh && sh.getLastRow() > 1) {
      throw new UserError('A aba ' + m.aba + ' contem dados. Limpe-a antes de recriar o modelo.');
    }
    if (!sh) sh = ss.insertSheet(m.aba);
    var cols = m.colunas();
    sh.clear();
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#fde68a');
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, cols.length + 2).setValue('AJUDA: ' + m.ajuda).setFontStyle('italic');
    return true;
  }

  function lerModelo(tipo) {
    var m = MODELOS_IMPORTACAO[tipo];
    var sh = Db.spreadsheet().getSheetByName(m.aba);
    if (!sh) throw new UserError('Aba ' + m.aba + ' nao encontrada. Use "Recriar modelos de importacao".');
    var last = sh.getLastRow();
    var ncol = sh.getLastColumn();
    var header = sh.getRange(1, 1, 1, ncol).getValues()[0].map(function (h) { return celula(h); });
    var statusCol = header.indexOf('status');
    if (statusCol < 0) throw new UserError('Coluna "status" nao encontrada na aba ' + m.aba + '.');
    var linhas = [];
    if (last >= 2) {
      sh.getRange(2, 1, last - 1, ncol).getValues().forEach(function (r, i) {
        var o = {};
        header.forEach(function (h, j) { if (h && j < statusCol + 1) o[h] = celula(r[j]); });
        var vazia = header.every(function (h, j) { return j === statusCol || !celula(r[j]); });
        if (vazia || /^IMPORTADO/.test(o.status)) return;
        o._linha = i + 2;
        linhas.push(o);
      });
    }
    return { sh: sh, statusCol: statusCol + 1, linhas: linhas };
  }

  function marcar(modelo, resultados) {
    resultados.forEach(function (r) { modelo.sh.getRange(r.linha, modelo.statusCol).setValue(r.status); });
  }

  function executar(tipo, user) {
    if (!MODELOS_IMPORTACAO[tipo]) throw new UserError('Tipo de importacao invalido.');
    var modelo = lerModelo(tipo);
    if (!modelo.linhas.length) return { tipo: tipo, importadas: 0, erros: 0, mensagem: 'Nenhuma linha nova para importar.' };
    var fn = { colaboradores: importarColaboradores, entregas: importarEntregas, estoque: importarEstoque }[tipo];
    var ctx = new Contexto();
    var erros = {};
    var plano = fn(modelo.linhas, ctx, erros, user, true);
    var qtdErros = Object.keys(erros).length;
    if (qtdErros) {
      marcar(modelo, modelo.linhas.map(function (l) { return { linha: l._linha, status: erros[l._linha] ? 'ERRO: ' + erros[l._linha] : 'OK (aguardando correcao das demais linhas)' }; }));
      return { tipo: tipo, importadas: 0, erros: qtdErros, mensagem: qtdErros + ' linha(s) com erro. Nada foi importado. Corrija na aba ' + MODELOS_IMPORTACAO[tipo].aba + ' (coluna status) e repita.' };
    }
    plano();
    var carimbo = 'IMPORTADO ' + Db.agora();
    marcar(modelo, modelo.linhas.map(function (l) { return { linha: l._linha, status: carimbo }; }));
    return { tipo: tipo, importadas: modelo.linhas.length, erros: 0, mensagem: modelo.linhas.length + ' linha(s) importada(s).' };
  }

  // Cada importador valida tudo e devolve uma funcao que grava (executada so se nao houver erros).
  function importarColaboradores(linhas, ctx, erros) {
    var grades = ctx.gradesPorId;
    var cargos = {};
    Db.all('Cargos').forEach(function (c) { cargos[c.nome.toLowerCase()] = c.id; });
    var porMatricula = {};
    Db.all('Colaboradores').forEach(function (c) { if (c.matricula) porMatricula[c.matricula] = c; });
    var vistos = {};
    var registros = [];
    linhas.forEach(function (l) {
      var e = [];
      if (!l.nome) e.push('nome vazio');
      if (!l.cargo) e.push('cargo vazio');
      var adm = Logic.normalizarData(l.admissao);
      if (!adm) e.push('admissao invalida');
      if (l.matricula) {
        if (vistos[l.matricula]) e.push('matricula repetida na planilha');
        vistos[l.matricula] = true;
      }
      var tamanhos = {};
      Object.keys(l).forEach(function (k) {
        if (k.indexOf('tam_') !== 0 || !l[k]) return;
        var g = grades[k.slice(4)];
        if (!g) { e.push('grade ' + k.slice(4) + ' inexistente'); return; }
        var t = l[k].toUpperCase();
        var validos = Logic.tamanhosDaGrade(g);
        var achado = validos.filter(function (v) { return v.toUpperCase() === t; })[0];
        if (!achado) e.push(k + '="' + l[k] + '" invalido'); else tamanhos[g.id] = achado;
      });
      if (e.length) erros[l._linha] = e.join('; ');
      else registros.push({ l: l, adm: adm, tamanhos: tamanhos });
    });
    return function () {
      var novosCargos = [];
      registros.forEach(function (r) {
        var k = r.l.cargo.toLowerCase();
        if (!cargos[k]) {
          var id = Db.nextIds('Cargos', 'CAR', novosCargos.length + 1, 3)[novosCargos.length];
          cargos[k] = id;
          novosCargos.push({ id: id, nome: r.l.cargo, ativo: true });
        }
      });
      Db.insert('Cargos', novosCargos);
      var novos = registros.filter(function (r) { return !(r.l.matricula && porMatricula[r.l.matricula]); });
      var ids = Db.nextIds('Colaboradores', 'COL', novos.length, 5);
      var agora = Db.agora();
      var inserir = [];
      registros.forEach(function (r) {
        var dados = {
          matricula: r.l.matricula, nome: r.l.nome, cargo_id: cargos[r.l.cargo.toLowerCase()], posto: r.l.posto,
          admissao: r.adm, telefone: r.l.telefone, ativo: true, atualizado_em: agora
        };
        var existente = r.l.matricula && porMatricula[r.l.matricula];
        if (existente) {
          var t = {};
          Object.keys(existente.tamanhos || {}).forEach(function (g) { t[g] = existente.tamanhos[g]; });
          Object.keys(r.tamanhos).forEach(function (g) { t[g] = r.tamanhos[g]; });
          dados.tamanhos = t;
          Db.update('Colaboradores', existente.id, dados);
        } else {
          dados.id = ids[inserir.length];
          dados.tamanhos = r.tamanhos;
          dados.criado_em = agora;
          inserir.push(dados);
        }
      });
      Db.insert('Colaboradores', inserir);
    };
  }

  function itemPorNome(ctx) {
    var m = {};
    ctx.itens.forEach(function (i) { m[i.nome.toLowerCase()] = i; });
    return m;
  }

  function validarItemTamanho(l, ctx, itens, e) {
    var item = itens[String(l.item).toLowerCase()];
    if (!item) { e.push('item "' + l.item + '" nao cadastrado'); return null; }
    var validos = Logic.tamanhosDaGrade(ctx.gradesPorId[item.grade_id]);
    var t = String(l.tamanho || (validos.length === 1 ? validos[0] : '')).toUpperCase();
    var achado = validos.filter(function (v) { return v.toUpperCase() === t; })[0];
    if (!achado) { e.push('tamanho "' + l.tamanho + '" invalido para ' + item.nome); return null; }
    return { item: item, tamanho: achado };
  }

  function importarEntregas(linhas, ctx, erros) {
    var itens = itemPorNome(ctx);
    var colabs = {};
    Db.all('Colaboradores').forEach(function (c) { if (c.matricula) colabs[c.matricula] = c; });
    var grupos = {}, ordem = [];
    linhas.forEach(function (l) {
      var e = [];
      var c = colabs[l.matricula];
      if (!c) e.push('matricula "' + l.matricula + '" nao cadastrada');
      var data = Logic.normalizarData(l.data);
      if (!data) e.push('data invalida');
      else if (data > ctx.hoje) e.push('data futura');
      var it = validarItemTamanho(l, ctx, itens, e);
      if (!Logic.isInteiro(l.quantidade) || Number(l.quantidade) <= 0) e.push('quantidade invalida');
      var motivo = (l.motivo || Logic.MOTIVO_KIT).toUpperCase();
      if (Logic.MOTIVOS_ENTREGA.indexOf(motivo) < 0) e.push('motivo invalido');
      if (e.length) { erros[l._linha] = e.join('; '); return; }
      var k = c.id + '|' + data;
      if (!grupos[k]) { grupos[k] = { colaborador_id: c.id, data: data, itens: [] }; ordem.push(k); }
      grupos[k].itens.push({ item_id: it.item.id, tamanho: it.tamanho, quantidade: Number(l.quantidade), motivo: motivo });
    });
    return function () {
      var ids = Db.nextIds('Entregas', 'ENT', ordem.length);
      var agora = Db.agora();
      var email = Auth.emailAtual();
      var cab = [], det = [];
      ordem.forEach(function (k, i) {
        var g = grupos[k], id = ids[i];
        cab.push({ id: id, colaborador_id: g.colaborador_id, data: g.data, obs: 'Historico importado', origem: Logic.ORIGEM_IMPORTACAO, entregue_por: email, criado_em: agora });
        g.itens.forEach(function (it, j) {
          det.push({ id: id + '-' + (j + 1), entrega_id: id, item_id: it.item_id, tamanho: it.tamanho, quantidade: it.quantidade, motivo: it.motivo });
        });
      });
      Db.insert('Entregas', cab);
      Db.insert('EntregaItens', det);
    };
  }

  function importarEstoque(linhas, ctx, erros) {
    var itens = itemPorNome(ctx);
    var ajustes = [];
    linhas.forEach(function (l) {
      var e = [];
      var it = validarItemTamanho(l, ctx, itens, e);
      if (!Logic.isInteiro(l.quantidade) || Number(l.quantidade) <= 0) e.push('quantidade invalida');
      if (e.length) { erros[l._linha] = e.join('; '); return; }
      ajustes.push({ item_id: it.item.id, tamanho: it.tamanho, quantidade: Number(l.quantidade) });
    });
    return function () {
      var ids = Db.nextIds('AjustesEstoque', 'AJU', ajustes.length);
      var agora = Db.agora(), email = Auth.emailAtual();
      Db.insert('AjustesEstoque', ajustes.map(function (a, i) {
        return { id: ids[i], data: ctx.hoje, item_id: a.item_id, tamanho: a.tamanho, quantidade: a.quantidade, motivo: 'Inventario inicial (importacao)', usuario: email, criado_em: agora };
      }));
    };
  }

  return { criarModelo: criarModelo, executar: executar };
})();

