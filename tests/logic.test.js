const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../src/Logic.js');

describe('Logic - Datas e Ciclos', () => {
  it('normalizarData deve padronizar formatos validos e rejeitar invalidos', () => {
    assert.equal(Logic.normalizarData('2026-10-31'), '2026-10-31');
    assert.equal(Logic.normalizarData('31/10/2026'), '2026-10-31');
    assert.equal(Logic.normalizarData('05/04/2026'), '2026-04-05');
    assert.equal(Logic.normalizarData(''), '');
    assert.equal(Logic.normalizarData(null), '');
    assert.equal(Logic.normalizarData('31/02/2026'), null); // 31 de fev invalido
    assert.equal(Logic.normalizarData('texto_aleatorio'), null);
  });

  it('addMonths deve preservar dias respeitando o limite do mes', () => {
    assert.equal(Logic.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(Logic.addMonths('2024-01-31', 1), '2024-02-29'); // bissexto
    assert.equal(Logic.addMonths('2026-03-15', 6), '2026-09-15');
    assert.equal(Logic.addMonths('2026-08-15', 6), '2027-02-15');
  });

  it('cicloAtual com periodicidade 0 deve ser unico e sem fim', () => {
    const c = Logic.cicloAtual('2026-01-15', 0, '2026-10-31');
    assert.equal(c.inicio, '2026-01-15');
    assert.equal(c.fim, null);
    assert.equal(c.numero, 1);
  });

  it('cicloAtual com periodicidade 6 meses deve calcular ciclos sucessivos', () => {
    // Admitido em 2025-01-10
    // Ciclo 1: 2025-01-10 ate 2025-07-10
    // Ciclo 2: 2025-07-10 ate 2026-01-10
    // Ciclo 3: 2026-01-10 ate 2026-07-10
    // Ciclo 4: 2026-07-10 ate 2027-01-10
    const c1 = Logic.cicloAtual('2025-01-10', 6, '2025-03-01');
    assert.equal(c1.inicio, '2025-01-10');
    assert.equal(c1.fim, '2025-07-10');
    assert.equal(c1.numero, 1);

    const c4 = Logic.cicloAtual('2025-01-10', 6, '2026-10-31');
    assert.equal(c4.inicio, '2026-07-10');
    assert.equal(c4.fim, '2027-01-10');
    assert.equal(c4.numero, 4);
  });
});

describe('Logic - Pendencias de Colaboradores', () => {
  const itens = [
    { id: 'ITM-01', nome: 'Camisa polo', grade_id: 'CAMISA', ativo: true },
    { id: 'ITM-02', nome: 'Bota', grade_id: 'CALCADO', ativo: true }
  ];
  const kits = [
    { cargo_id: 'CAR-01', item_id: 'ITM-01', quantidade: 3, periodicidade_meses: 6 },
    { cargo_id: 'CAR-01', item_id: 'ITM-02', quantidade: 1, periodicidade_meses: 12 }
  ];
  const colab = {
    id: 'COL-001', nome: 'Joao Silva', cargo_id: 'CAR-01', admissao: '2026-01-01',
    tamanhos: { CAMISA: 'G' }, // falta tamanho da bota
    ativo: true
  };

  it('deve identificar pendencias totais quando nada foi entregue', () => {
    const res = Logic.calcularPendencias({
      colaboradores: [colab],
      kits: kits,
      itens: itens,
      entregas: [],
      hoje: '2026-01-20',
      toleranciaDias: 15
    });

    assert.equal(res.length, 2);
    const camisa = res.find(r => r.item_id === 'ITM-01');
    assert.equal(camisa.direito, 3);
    assert.equal(camisa.entregue, 0);
    assert.equal(camisa.pendente, 3);
    assert.equal(camisa.tamanho, 'G');
    assert.equal(camisa.atrasada, true); // 19 dias > 15 dias tol
    assert.equal(camisa.sem_tamanho, false);

    const bota = res.find(r => r.item_id === 'ITM-02');
    assert.equal(bota.pendente, 1);
    assert.equal(bota.tamanho, '');
    assert.equal(bota.sem_tamanho, true);
  });

  it('entregas parciais de KIT devem abater a pendencia; SUBSTITUICAO nao deve abater', () => {
    const entregas = [
      { colaborador_id: 'COL-001', item_id: 'ITM-01', tamanho: 'G', quantidade: 2, motivo: 'KIT', data: '2026-01-05' },
      { colaborador_id: 'COL-001', item_id: 'ITM-01', tamanho: 'G', quantidade: 1, motivo: 'SUBSTITUICAO', data: '2026-01-10' }
    ];

    const res = Logic.calcularPendencias({
      colaboradores: [colab],
      kits: kits,
      itens: itens,
      entregas: entregas,
      hoje: '2026-01-20',
      toleranciaDias: 15
    });

    const camisa = res.find(r => r.item_id === 'ITM-01');
    assert.equal(camisa.direito, 3);
    assert.equal(camisa.entregue, 2); // 2 de KIT; 1 de SUBSTITUICAO nao entra
    assert.equal(camisa.pendente, 1);
  });
});

describe('Logic - Calculo de Estoque', () => {
  it('deve somar recebimentos aceitos, subtrair entregas e somar ajustes', () => {
    const recebimentoItens = [
      // 10 recebidos, 2 rejeitados => 8 aceitos
      { item_id: 'ITM-01', tamanho: 'M', qtd_recebida: 10, qtd_rejeitada: 2 },
      { item_id: 'ITM-01', tamanho: 'G', qtd_recebida: 5, qtd_rejeitada: 0 }
    ];
    const entregaItens = [
      { item_id: 'ITM-01', tamanho: 'M', quantidade: 3, origem: 'SISTEMA' },
      // entrega de importacao historica NAO deve baixar estoque
      { item_id: 'ITM-01', tamanho: 'M', quantidade: 2, origem: 'IMPORTACAO' }
    ];
    const ajustes = [
      { item_id: 'ITM-01', tamanho: 'M', quantidade: -1 }, // perda
      { item_id: 'ITM-01', tamanho: 'G', quantidade: 2 }   // sobra
    ];

    const estoque = Logic.calcularEstoque({
      recebimentoItens,
      entregaItens,
      ajustes
    });

    // M: 8 aceitos - 3 entregues - 1 ajuste = 4
    assert.equal(estoque['ITM-01|M'].quantidade, 4);
    // G: 5 aceitos - 0 entregues + 2 ajuste = 7
    assert.equal(estoque['ITM-01|G'].quantidade, 7);
  });
});

describe('Logic - Pedidos e Divergencias', () => {
  it('deve calcular status de pedido e apontar faltas, excessos e rejeicoes', () => {
    const pedidos = [
      { id: 'PED-001', fornecedor_id: 'FOR-01', status: 'ABERTO', previsao_entrega: '2026-10-20' }
    ];
    const pedidoItens = [
      { pedido_id: 'PED-001', item_id: 'ITM-01', tamanho: 'G', quantidade: 10 },
      { pedido_id: 'PED-001', item_id: 'ITM-01', tamanho: 'M', quantidade: 5 }
    ];
    const recebimentos = [
      { id: 'REC-001', pedido_id: 'PED-001' }
    ];
    const recebimentoItens = [
      // G: recebeu 7, rejeitou 1 (com defeito) => 6 aceitos (faltam 4)
      { recebimento_id: 'REC-001', item_id: 'ITM-01', tamanho: 'G', qtd_recebida: 7, qtd_rejeitada: 1 },
      // M: recebeu 5 perfeito => 5 aceitos (saldo 0)
      { recebimento_id: 'REC-001', item_id: 'ITM-01', tamanho: 'M', qtd_recebida: 5, qtd_rejeitada: 0 },
      // P: item nao pedido, veio por engano
      { recebimento_id: 'REC-001', item_id: 'ITM-01', tamanho: 'P', qtd_recebida: 2, qtd_rejeitada: 0 }
    ];

    const res = Logic.calcularPedidos({
      pedidos, pedidoItens, recebimentos, recebimentoItens, hoje: '2026-10-31'
    });

    const ped = res.pedidos[0];
    assert.equal(ped.status, 'PARCIAL');
    assert.equal(ped.atrasado, true); // previsao 2026-10-20 < hoje 2026-10-31
    assert.equal(ped.total_pedido, 15);
    assert.equal(ped.total_recebido, 11); // 6 + 5
    assert.equal(ped.total_saldo, 4);

    const div = Logic.divergenciasPedido(ped);
    // Deve conter: FALTANTE de G (4), REJEITADO de G (1), NAO_PEDIDO de P (2)
    assert.ok(div.some(d => d.tipo === 'FALTANTE' && d.tamanho === 'G' && d.quantidade === 4));
    assert.ok(div.some(d => d.tipo === 'REJEITADO' && d.tamanho === 'G' && d.quantidade === 1));
    assert.ok(div.some(d => d.tipo === 'NAO_PEDIDO' && d.tamanho === 'P' && d.quantidade === 2));
  });
});

describe('Logic - Sugestao de Compra', () => {
  it('deve subtrair estoque e pedidos abertos da demanda', () => {
    const pendencias = [
      { item_id: 'ITM-01', tamanho: 'M', pendente: 10 },
      { item_id: 'ITM-01', tamanho: 'G', pendente: 5 },
      { item_id: 'ITM-01', tamanho: '', pendente: 2, colaborador_id: 'COL-X' } // sem tamanho
    ];
    const previsao = [
      { item_id: 'ITM-01', tamanho: 'M', quantidade: 4 } // 4 trocas futuras
    ];
    const estoque = {
      'ITM-01|M': { quantidade: 3 },
      'ITM-01|G': { quantidade: 8 }
    };
    const emPedido = {
      'ITM-01|M': 5 // 5 ja pedidos
    };

    const sug = Logic.calcularSugestao({ pendencias, previsao, estoque, emPedido });

    // M: demanda 10 + 4 (prev) = 14; estoque 3; em_pedido 5 => sugerido = 14 - 3 - 5 = 6
    const m = sug.linhas.find(l => l.item_id === 'ITM-01' && l.tamanho === 'M');
    assert.equal(m.sugerido, 6);

    // G: demanda 5; estoque 8; em_pedido 0 => sugerido = 0 (nao negativo)
    const g = sug.linhas.find(l => l.item_id === 'ITM-01' && l.tamanho === 'G');
    assert.equal(g.sugerido, 0);

    // Sem tamanho deve ser retornado separadamente
    assert.equal(sug.semTamanho.length, 1);
    assert.equal(sug.semTamanho[0].colaborador_id, 'COL-X');
  });
});

describe('Logic - Validacoes', () => {
  const ctx = {
    itens: { 'ITM-01': { id: 'ITM-01', nome: 'Camisa', grade_id: 'CAMISA' } },
    grades: { CAMISA: { id: 'CAMISA', tamanhos: 'P,M,G,GG' } }
  };

  it('validarLinhas deve rejeitar tamanhos fora da grade e quantidades invalidas', () => {
    const linhas = [
      { item_id: 'ITM-01', tamanho: '42', quantidade: 2 }, // tamanho errado
      { item_id: 'ITM-01', tamanho: 'M', quantidade: -3 }  // qtd negativa
    ];
    const err = Logic.validarLinhas(linhas, ctx);
    assert.equal(err.length, 2);
  });

  it('validarDisponibilidade deve bloquear saidas maiores que o estoque', () => {
    const linhas = [
      { item_id: 'ITM-01', tamanho: 'M', quantidade: 3 },
      { item_id: 'ITM-01', tamanho: 'M', quantidade: 2 } // total 5 de M
    ];
    const estoque = {
      'ITM-01|M': { quantidade: 4 }
    };
    const err = Logic.validarDisponibilidade(linhas, estoque, id => id);
    assert.equal(err.length, 1);
    assert.match(err[0], /disponivel 4, solicitado 5/);
  });
});
