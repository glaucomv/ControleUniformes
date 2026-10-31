/**
 * Logic.js - Regras de negocio puras (sem dependencia de servicos Google).
 *
 * Todas as funcoes aqui sao deterministicas: recebem dados e devolvem dados.
 * Isso permite testar no Node (`npm test`) e reaproveitar no Apps Script.
 *
 * Convencoes:
 *  - Datas sao strings ISO 'AAAA-MM-DD' (comparaveis lexicograficamente).
 *  - Chave de estoque/demanda = item_id + '|' + tamanho.
 */
var Logic = (function () {
  'use strict';

  var MOTIVO_KIT = 'KIT';                   // conta para o direito do ciclo
  var MOTIVO_SUBSTITUICAO = 'SUBSTITUICAO'; // reposicao (dano/perda): nao abate o direito
  var MOTIVOS_ENTREGA = [MOTIVO_KIT, MOTIVO_SUBSTITUICAO];
  var TAMANHO_UNICO = 'U';
  var GRADE_UNICA = 'UNICO';
  var ORIGEM_IMPORTACAO = 'IMPORTACAO';     // entregas historicas: nao movimentam estoque

  // ---------------------------------------------------------------- datas
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseISO(s) {
    var p = String(s).slice(0, 10).split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function isISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = parseISO(s);
    return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }

  function toUTC(s) { var p = parseISO(s); return Date.UTC(p.y, p.m - 1, p.d); }

  function fromUTC(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }

  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }

  /** Soma meses preservando o dia (limitado ao ultimo dia do mes). */
  function addMonths(s, n) {
    var d = parseISO(s);
    var total = d.y * 12 + (d.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(d.d, daysInMonth(y, m)));
  }

  /**
   * Normaliza datas digitadas: 'AAAA-MM-DD', 'AAAA-MM-DDTHH..', 'DD/MM/AAAA'.
   * Retorna '' para vazio, null para invalido.
   */
  function normalizarData(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (!s) return '';
    var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) s = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) s = m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    else return null;
    return isISODate(s) ? s : null;
  }

  /**
   * Ciclo vigente de um direito periodico.
   * Ciclos contam a partir de `ref` (admissao) a cada `periodicidade` meses.
   * periodicidade <= 0 => direito unico (ciclo sem fim).
   */
  function cicloAtual(ref, periodicidade, hoje) {
    var p = Number(periodicidade) || 0;
    if (p <= 0) return { inicio: ref, fim: null, numero: 1 };
    if (hoje < ref) return { inicio: ref, fim: addMonths(ref, p), numero: 1 };
    var a = parseISO(ref), h = parseISO(hoje);
    var k = Math.max(0, Math.floor(((h.y - a.y) * 12 + (h.m - a.m)) / p));
    while (k > 0 && addMonths(ref, k * p) > hoje) k--;
    while (addMonths(ref, (k + 1) * p) <= hoje) k++;
    return { inicio: addMonths(ref, k * p), fim: addMonths(ref, (k + 1) * p), numero: k + 1 };
  }

  // ---------------------------------------------------------------- utilitarios
  function indexar(lista, campo) {
    var o = {};
    (lista || []).forEach(function (x) { o[x[campo]] = x; });
    return o;
  }

  function agrupar(lista, fnChave) {
    var o = {};
    (lista || []).forEach(function (x) {
      var k = fnChave(x);
      (o[k] = o[k] || []).push(x);
    });
    return o;
  }

  function chave(itemId, tamanho) { return itemId + '|' + tamanho; }

  function separarChave(k) {
    var i = k.lastIndexOf('|');
    return { item_id: k.slice(0, i), tamanho: k.slice(i + 1) };
  }

  function num(v) { return Number(v) || 0; }

  function isInteiro(v) { return typeof v === 'number' ? Math.floor(v) === v : /^-?\d+$/.test(String(v).trim()); }

  function tamanhosDaGrade(grade) {
    if (!grade) return [TAMANHO_UNICO];
    if (grade.id === GRADE_UNICA) return [TAMANHO_UNICO];
    return String(grade.tamanhos || '').split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
  }

  function tamanhoDoColaborador(colab, item) {
    if (!item.grade_id || item.grade_id === GRADE_UNICA) return TAMANHO_UNICO;
    var t = (colab.tamanhos || {})[item.grade_id];
    return t ? String(t) : '';
  }

  function dataReferencia(colab, hoje) {
    return colab.admissao || String(colab.criado_em || '').slice(0, 10) || hoje;
  }

  function entregaContaNoCiclo(e, ciclo) {
    if (e.motivo !== MOTIVO_KIT) return false;
    var aposInicio = ciclo.numero === 1 || e.data >= ciclo.inicio;
    var antesFim = ciclo.fim === null || e.data < ciclo.fim;
    return aposInicio && antesFim;
  }

  // ---------------------------------------------------------------- pendencias
  /**
   * Pendencias por colaborador x item do kit do cargo, no ciclo vigente.
   * @param {{colaboradores, kits, itens, entregas, hoje, toleranciaDias}} p
   *   entregas: lista plana {colaborador_id, item_id, tamanho, quantidade, motivo, data}
   */
  function calcularPendencias(p) {
    var hoje = p.hoje, tol = num(p.toleranciaDias);
    var itens = indexar(p.itens, 'id');
    var kitsPorCargo = agrupar(p.kits, function (k) { return k.cargo_id; });
    var entregasPor = agrupar(p.entregas, function (e) { return e.colaborador_id + '|' + e.item_id; });
    var out = [];
    (p.colaboradores || []).forEach(function (c) {
      if (!c.ativo) return;
      var ref = dataReferencia(c, hoje);
      (kitsPorCargo[c.cargo_id] || []).forEach(function (k) {
        var item = itens[k.item_id];
        if (!item || item.ativo === false) return;
        var ciclo = cicloAtual(ref, k.periodicidade_meses, hoje);
        var entregue = 0;
        (entregasPor[c.id + '|' + k.item_id] || []).forEach(function (e) {
          if (entregaContaNoCiclo(e, ciclo)) entregue += num(e.quantidade);
        });
        var direito = num(k.quantidade);
        var pendente = Math.max(0, direito - entregue);
        var tamanho = tamanhoDoColaborador(c, item);
        var dias = Math.max(0, diffDays(ciclo.inicio, hoje));
        out.push({
          colaborador_id: c.id,
          item_id: k.item_id,
          tamanho: tamanho,
          direito: direito,
          entregue: entregue,
          pendente: pendente,
          ciclo_inicio: ciclo.inicio,
          ciclo_fim: ciclo.fim,
          ciclo_numero: ciclo.numero,
          dias_em_aberto: pendente > 0 ? dias : 0,
          atrasada: pendente > 0 && dias > tol,
          sem_tamanho: pendente > 0 && !tamanho
        });
      });
    });
    return out;
  }

  /** Trocas periodicas que vencem entre hoje (exclusivo) e hoje + horizonte (inclusivo). */
  function calcularPrevisao(p) {
    var hoje = p.hoje;
    var limite = addDays(hoje, num(p.horizonteDias));
    var itens = indexar(p.itens, 'id');
    var kitsPorCargo = agrupar(p.kits, function (k) { return k.cargo_id; });
    var out = [];
    (p.colaboradores || []).forEach(function (c) {
      if (!c.ativo) return;
      var ref = dataReferencia(c, hoje);
      (kitsPorCargo[c.cargo_id] || []).forEach(function (k) {
        var per = num(k.periodicidade_meses);
        var item = itens[k.item_id];
        if (per <= 0 || !item || item.ativo === false) return;
        var ciclo = cicloAtual(ref, per, hoje);
        var n = ciclo.numero;
        var inicio = ciclo.fim;
        while (inicio <= limite) {
          out.push({
            colaborador_id: c.id, item_id: k.item_id,
            tamanho: tamanhoDoColaborador(c, item),
            data: inicio, quantidade: num(k.quantidade)
          });
          n++;
          inicio = addMonths(ref, n * per);
        }
      });
    });
    return out;
  }

  // ---------------------------------------------------------------- estoque
  function qtdAceita(r) { return Math.max(0, num(r.qtd_recebida) - num(r.qtd_rejeitada)); }

  /** Estoque = recebido aceito - entregue (exceto historico importado) + ajustes. */
  function calcularEstoque(p) {
    var m = {};
    function soma(item, tam, q) {
      var k = chave(item, tam);
      if (!m[k]) m[k] = { item_id: item, tamanho: tam, quantidade: 0 };
      m[k].quantidade += q;
    }
    (p.recebimentoItens || []).forEach(function (r) { soma(r.item_id, r.tamanho, qtdAceita(r)); });
    (p.entregaItens || []).forEach(function (e) {
      if (e.origem === ORIGEM_IMPORTACAO) return;
      soma(e.item_id, e.tamanho, -num(e.quantidade));
    });
    (p.ajustes || []).forEach(function (a) { soma(a.item_id, a.tamanho, num(a.quantidade)); });
    return m;
  }

  // ---------------------------------------------------------------- pedidos
  /**
   * Situacao de cada pedido (pedido x recebido) e saldo em aberto por item/tamanho.
   * Status manuais (CANCELADO, ENCERRADO) prevalecem; os demais sao calculados.
   */
  function calcularPedidos(p) {
    var hoje = p.hoje;
    var recPorId = indexar(p.recebimentos, 'id');
    var recebido = {}; // pedido_id -> chave -> {aceita, rejeitada}
    (p.recebimentoItens || []).forEach(function (ri) {
      var r = recPorId[ri.recebimento_id];
      if (!r || !r.pedido_id) return;
      var porPedido = recebido[r.pedido_id] = recebido[r.pedido_id] || {};
      var k = chave(ri.item_id, ri.tamanho);
      var acc = porPedido[k] = porPedido[k] || { aceita: 0, rejeitada: 0 };
      acc.aceita += qtdAceita(ri);
      acc.rejeitada += num(ri.qtd_rejeitada);
    });

    var itensPorPedido = agrupar(p.pedidoItens, function (i) { return i.pedido_id; });
    var emPedido = {};

    var pedidos = (p.pedidos || []).map(function (ped) {
      var rec = recebido[ped.id] || {};
      var pedidoPorChave = {};
      var ordem = [];
      (itensPorPedido[ped.id] || []).forEach(function (pi) {
        var k = chave(pi.item_id, pi.tamanho);
        if (!(k in pedidoPorChave)) { pedidoPorChave[k] = 0; ordem.push(k); }
        pedidoPorChave[k] += num(pi.quantidade);
      });
      var tot = { pedido: 0, recebido: 0, rejeitado: 0, saldo: 0 };
      var itens = ordem.map(function (k) {
        var r = rec[k] || { aceita: 0, rejeitada: 0 };
        var q = pedidoPorChave[k];
        var linha = separarChave(k);
        linha.quantidade = q;
        linha.recebido = r.aceita;
        linha.rejeitado = r.rejeitada;
        linha.saldo = Math.max(0, q - r.aceita);
        linha.excedente = Math.max(0, r.aceita - q);
        tot.pedido += q; tot.recebido += Math.min(q, r.aceita);
        tot.rejeitado += r.rejeitada; tot.saldo += linha.saldo;
        return linha;
      });
      var naoPedidos = Object.keys(rec).filter(function (k) { return !(k in pedidoPorChave); })
        .map(function (k) {
          var linha = separarChave(k);
          linha.recebido = rec[k].aceita;
          linha.rejeitado = rec[k].rejeitada;
          tot.rejeitado += rec[k].rejeitada;
          return linha;
        });

      var status = ped.status;
      if (status !== 'CANCELADO' && status !== 'ENCERRADO') {
        status = tot.saldo === 0 ? 'CONCLUIDO' : (tot.recebido > 0 ? 'PARCIAL' : 'ABERTO');
      }
      var aberto = status === 'ABERTO' || status === 'PARCIAL';
      if (aberto) {
        itens.forEach(function (l) {
          if (l.saldo > 0) emPedido[chave(l.item_id, l.tamanho)] = (emPedido[chave(l.item_id, l.tamanho)] || 0) + l.saldo;
        });
      }
      var out = {};
      for (var f in ped) if (Object.prototype.hasOwnProperty.call(ped, f)) out[f] = ped[f];
      out.status = status;
      out.aberto = aberto;
      out.atrasado = aberto && !!ped.previsao_entrega && ped.previsao_entrega < hoje;
      out.itens = itens;
      out.nao_pedidos = naoPedidos;
      out.total_pedido = tot.pedido;
      out.total_recebido = tot.recebido;
      out.total_rejeitado = tot.rejeitado;
      out.total_saldo = tot.saldo;
      return out;
    });
    return { pedidos: pedidos, emPedido: emPedido };
  }

  /** Lista de divergencias de um pedido ja calculado por calcularPedidos. */
  function divergenciasPedido(ped) {
    var out = [];
    ped.itens.forEach(function (l) {
      if (l.saldo > 0) out.push({ tipo: 'FALTANTE', item_id: l.item_id, tamanho: l.tamanho, quantidade: l.saldo });
      if (l.excedente > 0) out.push({ tipo: 'EXCEDENTE', item_id: l.item_id, tamanho: l.tamanho, quantidade: l.excedente });
      if (l.rejeitado > 0) out.push({ tipo: 'REJEITADO', item_id: l.item_id, tamanho: l.tamanho, quantidade: l.rejeitado });
    });
    ped.nao_pedidos.forEach(function (l) {
      if (l.recebido > 0) out.push({ tipo: 'NAO_PEDIDO', item_id: l.item_id, tamanho: l.tamanho, quantidade: l.recebido });
      if (l.rejeitado > 0) out.push({ tipo: 'REJEITADO', item_id: l.item_id, tamanho: l.tamanho, quantidade: l.rejeitado });
    });
    return out;
  }

  // ---------------------------------------------------------------- sugestao de compra
  /**
   * Sugestao = demanda atual + troca prevista - estoque - saldo em pedidos abertos.
   * Pendencias sem tamanho cadastrado nao entram (sao listadas a parte).
   */
  function calcularSugestao(p) {
    var linhas = {};
    function linha(k) {
      if (!linhas[k]) {
        var l = separarChave(k);
        l.demanda_atual = 0; l.demanda_prevista = 0; l.estoque = 0; l.em_pedido = 0;
        linhas[k] = l;
      }
      return linhas[k];
    }
    var semTamanho = [];
    (p.pendencias || []).forEach(function (x) {
      if (x.pendente <= 0) return;
      if (!x.tamanho) { semTamanho.push(x); return; }
      linha(chave(x.item_id, x.tamanho)).demanda_atual += x.pendente;
    });
    (p.previsao || []).forEach(function (x) {
      if (!x.tamanho) { semTamanho.push(x); return; }
      linha(chave(x.item_id, x.tamanho)).demanda_prevista += num(x.quantidade);
    });
    Object.keys(linhas).forEach(function (k) {
      var l = linhas[k];
      l.estoque = p.estoque && p.estoque[k] ? p.estoque[k].quantidade : 0;
      l.em_pedido = (p.emPedido && p.emPedido[k]) || 0;
      l.sugerido = Math.max(0, l.demanda_atual + l.demanda_prevista - Math.max(0, l.estoque) - l.em_pedido);
    });
    return {
      linhas: Object.keys(linhas).map(function (k) { return linhas[k]; }),
      semTamanho: semTamanho
    };
  }

  // ---------------------------------------------------------------- validacoes
  /**
   * Valida linhas {item_id, tamanho, quantidade[, motivo]}.
   * @param ctx {{itens: Object<id,item>, grades: Object<id,grade>}}
   * @param opts {{exigeMotivo?: boolean, campoQtd?: string, permiteNegativo?: boolean}}
   * @returns {string[]} erros
   */
  function validarLinhas(linhas, ctx, opts) {
    opts = opts || {};
    var campo = opts.campoQtd || 'quantidade';
    var erros = [];
    if (!linhas || !linhas.length) return ['Informe ao menos um item.'];
    linhas.forEach(function (l, i) {
      var n = 'Linha ' + (i + 1) + ': ';
      var item = ctx.itens[l.item_id];
      if (!item) { erros.push(n + 'item invalido.'); return; }
      var tams = tamanhosDaGrade(ctx.grades[item.grade_id]);
      if (tams.indexOf(String(l.tamanho)) < 0) erros.push(n + 'tamanho "' + l.tamanho + '" nao existe na grade de ' + item.nome + '.');
      var q = l[campo];
      if (!isInteiro(q) || (opts.permiteNegativo ? Number(q) === 0 : Number(q) <= 0)) erros.push(n + 'quantidade invalida.');
      if (opts.exigeMotivo && MOTIVOS_ENTREGA.indexOf(l.motivo) < 0) erros.push(n + 'motivo invalido.');
    });
    return erros;
  }

  /** Verifica se ha estoque para as linhas (agregando repeticoes). */
  function validarDisponibilidade(linhas, estoque, nomeItem) {
    var req = {};
    linhas.forEach(function (l) { var k = chave(l.item_id, l.tamanho); req[k] = (req[k] || 0) + num(l.quantidade); });
    var erros = [];
    Object.keys(req).forEach(function (k) {
      var disp = estoque[k] ? estoque[k].quantidade : 0;
      if (req[k] > disp) {
        var c = separarChave(k);
        erros.push('Estoque insuficiente de ' + (nomeItem ? nomeItem(c.item_id) : c.item_id) +
          ' tam. ' + c.tamanho + ': disponivel ' + disp + ', solicitado ' + req[k] + '.');
      }
    });
    return erros;
  }

  /** Ordena por nome do item e pela ordem do tamanho dentro da grade. */
  function comparadorItemTamanho(itens, grades) {
    return function (a, b) {
      var ia = itens[a.item_id] || {}, ib = itens[b.item_id] || {};
      var na = String(ia.nome || a.item_id), nb = String(ib.nome || b.item_id);
      if (na !== nb) return na < nb ? -1 : 1;
      var tams = tamanhosDaGrade(grades[ia.grade_id]);
      var pa = tams.indexOf(String(a.tamanho)), pb = tams.indexOf(String(b.tamanho));
      if (pa !== pb) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
      return String(a.tamanho) < String(b.tamanho) ? -1 : (String(a.tamanho) > String(b.tamanho) ? 1 : 0);
    };
  }

  return {
    MOTIVO_KIT: MOTIVO_KIT,
    MOTIVO_SUBSTITUICAO: MOTIVO_SUBSTITUICAO,
    MOTIVOS_ENTREGA: MOTIVOS_ENTREGA,
    TAMANHO_UNICO: TAMANHO_UNICO,
    GRADE_UNICA: GRADE_UNICA,
    ORIGEM_IMPORTACAO: ORIGEM_IMPORTACAO,
    pad: pad,
    isISODate: isISODate,
    addDays: addDays,
    addMonths: addMonths,
    diffDays: diffDays,
    normalizarData: normalizarData,
    cicloAtual: cicloAtual,
    indexar: indexar,
    agrupar: agrupar,
    chave: chave,
    separarChave: separarChave,
    isInteiro: isInteiro,
    tamanhosDaGrade: tamanhosDaGrade,
    tamanhoDoColaborador: tamanhoDoColaborador,
    calcularPendencias: calcularPendencias,
    calcularPrevisao: calcularPrevisao,
    qtdAceita: qtdAceita,
    calcularEstoque: calcularEstoque,
    calcularPedidos: calcularPedidos,
    divergenciasPedido: divergenciasPedido,
    calcularSugestao: calcularSugestao,
    validarLinhas: validarLinhas,
    validarDisponibilidade: validarDisponibilidade,
    comparadorItemTamanho: comparadorItemTamanho
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

