/**
 * Main.js - Entrada do Web App.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Controle de Uniformes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Inclui o conteudo de outro arquivo HTML (usado no template Index). */
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

