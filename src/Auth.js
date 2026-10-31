/**
 * Auth.js - Identificacao do usuario e perfis de acesso.
 *
 * O Web App e publicado como "Executar como: usuario que acessa", entao
 * Session.getActiveUser() devolve o e-mail real (funciona com Gmail comum).
 */
var PERFIS = ['GESTOR', 'COMPRADOR', 'ALMOXARIFE'];

/** Permissao -> perfis autorizados. */
var PERMISSOES = {
  ver: ['GESTOR', 'COMPRADOR', 'ALMOXARIFE'],
  pedidos: ['GESTOR', 'COMPRADOR'],
  fornecedores: ['GESTOR', 'COMPRADOR'],
  recebimentos: ['GESTOR', 'ALMOXARIFE'],
  entregas: ['GESTOR', 'ALMOXARIFE'],
  estoque: ['GESTOR', 'ALMOXARIFE'],
  colaboradores: ['GESTOR', 'ALMOXARIFE'],
  admin: ['GESTOR']
};

var Auth = (function () {
  function emailAtual() {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  }

  function permissoesDo(perfil) {
    return Object.keys(PERMISSOES).filter(function (p) { return PERMISSOES[p].indexOf(perfil) >= 0; });
  }

  function usuarioAtual() {
    var email = emailAtual();
    if (!email) throw new UserError('Nao foi possivel identificar sua conta Google. Entre com sua conta e recarregue a pagina.');
    var u = Db.all('Usuarios').filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    if (!u || !u.ativo) {
      throw new UserError('Acesso nao liberado para ' + email + '. Peca ao gestor para cadastrar seu e-mail em Cadastros > Usuarios.');
    }
    return { email: email, nome: u.nome || email, perfil: u.perfil, permissoes: permissoesDo(u.perfil) };
  }

  function exigir(perm) {
    var u = usuarioAtual();
    if (u.permissoes.indexOf(perm) < 0) throw new UserError('Seu perfil (' + u.perfil + ') nao permite esta operacao.');
    return u;
  }

  return { emailAtual: emailAtual, usuarioAtual: usuarioAtual, exigir: exigir, permissoesDo: permissoesDo };
})();

