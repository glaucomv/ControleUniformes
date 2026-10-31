/**
 * Schema.js - Estrutura das abas da planilha (banco de dados).
 * Formato do campo: 'nome:tipo'  (s=texto, n=numero, b=booleano, d=data ISO, j=JSON)
 * A ordem dos campos define a ordem das colunas. Novos campos devem ser
 * adicionados SEMPRE ao final, para nao desalinhar dados existentes.
 */
var SCHEMA = {
  Usuarios: { key: 'email', fields: ['email:s', 'nome:s', 'perfil:s', 'ativo:b', 'criado_em:s'] },
  Grades: { fields: ['id:s', 'nome:s', 'tamanhos:s', 'ordem:n', 'ativo:b'] },
  Itens: { fields: ['id:s', 'nome:s', 'grade_id:s', 'unidade:s', 'ativo:b', 'criado_em:s'] },
  Cargos: { fields: ['id:s', 'nome:s', 'ativo:b'] },
  KitCargo: { fields: ['id:s', 'cargo_id:s', 'item_id:s', 'quantidade:n', 'periodicidade_meses:n'] },
  Colaboradores: {
    fields: ['id:s', 'matricula:s', 'nome:s', 'cargo_id:s', 'posto:s', 'admissao:d', 'tamanhos:j',
      'telefone:s', 'ativo:b', 'desligamento:d', 'obs:s', 'criado_em:s', 'atualizado_em:s']
  },
  Fornecedores: { fields: ['id:s', 'nome:s', 'cnpj:s', 'contato:s', 'telefone:s', 'email:s', 'ativo:b'] },
  Pedidos: {
    fields: ['id:s', 'fornecedor_id:s', 'data:d', 'previsao_entrega:d', 'status:s', 'obs:s',
      'criado_por:s', 'criado_em:s']
  },
  PedidoItens: { fields: ['id:s', 'pedido_id:s', 'item_id:s', 'tamanho:s', 'quantidade:n'] },
  Recebimentos: {
    fields: ['id:s', 'pedido_id:s', 'data:d', 'nota_fiscal:s', 'obs:s', 'recebido_por:s', 'criado_em:s']
  },
  RecebimentoItens: {
    fields: ['id:s', 'recebimento_id:s', 'item_id:s', 'tamanho:s', 'qtd_recebida:n', 'qtd_rejeitada:n',
      'motivo_rejeicao:s']
  },
  Entregas: { fields: ['id:s', 'colaborador_id:s', 'data:d', 'obs:s', 'origem:s', 'entregue_por:s', 'criado_em:s'] },
  EntregaItens: { fields: ['id:s', 'entrega_id:s', 'item_id:s', 'tamanho:s', 'quantidade:n', 'motivo:s'] },
  AjustesEstoque: {
    fields: ['id:s', 'data:d', 'item_id:s', 'tamanho:s', 'quantidade:n', 'motivo:s', 'usuario:s', 'criado_em:s']
  },
  Config: { key: 'chave', fields: ['chave:s', 'valor:s'] },
  Log: { key: 'execution_id', fields: ['execution_id:s', 'data_hora:s', 'usuario:s', 'acao:s', 'detalhe:s', 'status:s'] }
};

/** Valores padrao de configuracao (aba Config). */
var CONFIG_PADRAO = {
  empresa_nome: 'Minha Empresa',
  tolerancia_dias: '15',
  horizonte_previsao_dias: '60',
  termo_texto: 'Declaro que recebi os itens de uniforme acima relacionados, em perfeito estado, ' +
    'comprometendo-me a utiliza-los exclusivamente no exercicio de minhas funcoes e a zelar por sua conservacao.'
};

/** Grades de tamanho iniciais (editaveis em Cadastros > Grades). */
var GRADES_PADRAO = [
  { id: 'UNICO', nome: 'Tamanho unico', tamanhos: 'U', ordem: 0, ativo: true },
  { id: 'CAMISA', nome: 'Camisa / Camiseta', tamanhos: 'PP,P,M,G,GG,XG,XGG', ordem: 1, ativo: true },
  { id: 'CALCA', nome: 'Calca', tamanhos: '36,38,40,42,44,46,48,50,52,54,56', ordem: 2, ativo: true },
  { id: 'CALCADO', nome: 'Calcado', tamanhos: '34,35,36,37,38,39,40,41,42,43,44,45,46', ordem: 3, ativo: true }
];

var LOG_MAX_LINHAS = 5000;
var LOG_REMOVER_LINHAS = 1000;

