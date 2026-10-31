/**
 * Db.js - Camada de acesso a planilha (cada aba = tabela, linha 1 = cabecalho).
 * Le cada aba no maximo uma vez por requisicao (cache) e grava em lote.
 */

/** Erro de negocio: mensagem exibida ao usuario sem detalhes tecnicos. */
function UserError(msg) {
  this.name = 'UserError';
  this.message = msg;
  this.userMessage = true;
}
UserError.prototype = Object.create(Error.prototype);
UserError.prototype.constructor = UserError;

var Db = (function () {
  var cache = {};
  var ssCache = null;

  function spreadsheet() {
    if (ssCache) return ssCache;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    ssCache = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ssCache) throw new UserError('Planilha nao encontrada. Execute "Uniformes > Configurar planilha".');
    return ssCache;
  }

  function def(table) {
    var d = SCHEMA[table];
    if (!d) throw new Error('Tabela desconhecida: ' + table);
    if (!d._f) {
      d._f = d.fields.map(function (f) {
        var p = f.split(':');
        return { name: p[0], type: p[1] || 's' };
      });
    }
    return d;
  }

  function sheet(table) {
    var sh = spreadsheet().getSheetByName(table);
    if (!sh) throw new UserError('Aba "' + table + '" nao encontrada. Execute "Uniformes > Configurar planilha".');
    return sh;
  }

  function timeZone() { return spreadsheet().getSpreadsheetTimeZone() || 'America/Sao_Paulo'; }

  function formatoColuna(type) { return type === 'n' ? '0' : (type === 'b' ? 'General' : '@'); }

  function toValue(type, v) {
    if (v === undefined || v === null) return type === 'b' ? false : '';
    switch (type) {
      case 'n': return v === '' ? '' : (Number(v) || 0);
      case 'b': return v === true || v === 'TRUE' || v === 'true';
      case 'j': return typeof v === 'string' ? v : JSON.stringify(v);
      default: return String(v);
    }
  }

  function fromValue(type, v, tz) {
    switch (type) {
      case 'n': return v === '' || v === null || v === undefined ? 0 : (Number(v) || 0);
      case 'b': return v === true || String(v).toUpperCase() === 'TRUE' || String(v).toUpperCase() === 'SIM';
      case 'j':
        if (!v) return {};
        try { return JSON.parse(v); } catch (e) { return {}; }
      case 'd':
        if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        return String(v === null || v === undefined ? '' : v).slice(0, 10);
      default:
        if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
        return v === null || v === undefined ? '' : String(v);
    }
  }

  function linhaParaValores(d, o) { return d._f.map(function (f) { return toValue(f.type, o[f.name]); }); }

  function formatos(d, n) {
    var linha = d._f.map(function (f) { return formatoColuna(f.type); });
    var out = [];
    for (var i = 0; i < n; i++) out.push(linha);
    return out;
  }

  function garantirLinhas(sh, ultimaNecessaria) {
    var max = sh.getMaxRows();
    if (ultimaNecessaria > max) sh.insertRowsAfter(max, ultimaNecessaria - max + 200);
  }

  function all(table) {
    if (cache[table]) return cache[table];
    var d = def(table), sh = sheet(table), last = sh.getLastRow(), rows = [];
    if (last >= 2) {
      var tz = timeZone();
      var vals = sh.getRange(2, 1, last - 1, d._f.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        if (r[0] === '' || r[0] === null) continue;
        var o = {};
        for (var j = 0; j < d._f.length; j++) o[d._f[j].name] = fromValue(d._f[j].type, r[j], tz);
        Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
        rows.push(o);
      }
    }
    cache[table] = rows;
    return rows;
  }

  function find(table, keyValue) {
    var key = def(table).key || 'id';
    var rows = all(table);
    for (var i = 0; i < rows.length; i++) if (rows[i][key] === keyValue) return rows[i];
    return null;
  }

  function insert(table, objs) {
    if (!objs || !objs.length) return;
    var d = def(table), sh = sheet(table);
    var vals = objs.map(function (o) { return linhaParaValores(d, o); });
    var start = sh.getLastRow() + 1;
    garantirLinhas(sh, start + vals.length - 1);
    sh.getRange(start, 1, vals.length, d._f.length).setNumberFormats(formatos(d, vals.length)).setValues(vals);
    delete cache[table];
  }

  function update(table, keyValue, patch) {
    var d = def(table), row = find(table, keyValue);
    if (!row) throw new UserError('Registro nao encontrado (' + table + ': ' + keyValue + ').');
    var merged = {};
    Object.keys(row).forEach(function (k) { merged[k] = row[k]; });
    Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
    sheet(table).getRange(row._row, 1, 1, d._f.length)
      .setNumberFormats(formatos(d, 1)).setValues([linhaParaValores(d, merged)]);
    delete cache[table];
    return merged;
  }

  /** Reescreve todo o corpo da aba (usado em tabelas pequenas e rotacao de log). */
  function rewrite(table, rows) {
    var d = def(table), sh = sheet(table), last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, d._f.length).clearContent();
    if (rows.length) {
      garantirLinhas(sh, rows.length + 1);
      sh.getRange(2, 1, rows.length, d._f.length).setNumberFormats(formatos(d, rows.length))
        .setValues(rows.map(function (o) { return linhaParaValores(d, o); }));
    }
    delete cache[table];
  }

  /** Proximos IDs sequenciais legiveis: PREFIXO-000001. Chamar sob lock. */
  function nextIds(table, prefix, count, width) {
    width = width || 6;
    var max = 0, re = new RegExp('^' + prefix + '-(\\d+)$');
    all(table).forEach(function (r) {
      var m = re.exec(r.id);
      if (m && +m[1] > max) max = +m[1];
    });
    var out = [];
    for (var i = 1; i <= (count || 1); i++) {
      var s = String(max + i);
      while (s.length < width) s = '0' + s;
      out.push(prefix + '-' + s);
    }
    return out;
  }

  function nextId(table, prefix, width) { return nextIds(table, prefix, 1, width)[0]; }

  function reset() { cache = {}; ssCache = null; }

  function agora() { return Utilities.formatDate(new Date(), timeZone(), 'yyyy-MM-dd HH:mm:ss'); }

  function hoje() { return Utilities.formatDate(new Date(), timeZone(), 'yyyy-MM-dd'); }

  return {
    spreadsheet: spreadsheet,
    def: def,
    sheet: sheet,
    formatoColuna: formatoColuna,
    all: all,
    find: find,
    insert: insert,
    update: update,
    rewrite: rewrite,
    nextId: nextId,
    nextIds: nextIds,
    reset: reset,
    agora: agora,
    hoje: hoje,
    timeZone: timeZone
  };
})();

