# Sistema de Controle e Gestão de Uniformes

Sistema completo, simples e 100% gratuito desenvolvido para controle ponta a ponta da cadeia de uniformes da empresa, rodando sobre o **Google Sheets** e **Google Apps Script**.

Acesso via computador e celular (responsivo), sem necessidade de hospedagem, servidores ou compra de domínio.

---

## 🎯 Problemas Resolvidos

1. **Falta de visibilidade do que cada colaborador precisa:** Cálculo automático baseado no Kit do Cargo, na data de admissão e no ciclo de trocas periódicas (ex: a cada 6 ou 12 meses).
2. **Entregas parciais e esquecimento:** Ficha individual por colaborador mostrando exatamente o que já foi entregue e o que ainda falta entregar.
3. **Erros do fornecedor (peças a menos, tamanhos errados ou defeitos):** Módulo de conferência no recebimento com registro de divergências e acompanhamento de saldo pendente do fornecedor.
4. **Previsão de compras sem achismos:** Painel que cruza demanda atual, trocas futuras, estoque real e saldo de pedidos em aberto para sugerir a compra exata.
5. **Comprovação legal:** Geração instantânea do Termo de Recebimento de Uniformes para assinatura e impressão em PDF.

---

## 📂 Estrutura do Projeto

```
ControleUniformes/
├── src/                      # Código do sistema (Google Apps Script)
│   ├── Logic.js              # Regras de cálculo (ciclos, pendências, estoque, compras)
│   ├── Schema.js             # Definição das tabelas da planilha Google
│   ├── Db.js                 # Camada de banco de dados e persistência
│   ├── Auth.js               # Perfis de acesso (Gestor, Comprador, Almoxarife)
│   ├── Api.js                # Endpoints e serviços
│   ├── Importacao.js         # Validador e importador das planilhas antigas
│   ├── Setup.js              # Inicialização e menu da planilha Google
│   ├── Main.js               # Ponto de entrada do Web App
│   ├── Index.html            # Estrutura HTML principal
│   ├── Styles.html           # Estilização responsiva (desktop e celular)
│   └── App.html              # Interface do usuário (SPA)
├── tests/                    # Testes automatizados das regras de cálculo
│   └── logic.test.js
├── docs/                     # Documentação completa
│   ├── IMPLANTACAO.md        # Passo a passo de instalação no Google Drive
│   └── MANUAL_OPERACIONAL.md # Guia de uso para a equipe
├── appsscript.json           # Manifesto oficial do Google Apps Script
├── package.json              # Configuração de testes unitários
└── .claspignore              # Arquivos ignorados na sincronização do Apps Script
```

---

## 🚀 Como Colocar no Ar

Consulte o passo a passo em [docs/IMPLANTACAO.md](file:///c:/Users/glauc/ControleUniformes/docs/IMPLANTACAO.md).

Em menos de 10 minutos, copiando os arquivos para o Apps Script ou utilizando o `clasp`, a aplicação estará no ar com uma URL segura fornecida pelo Google.

---

## 🧪 Testes Automatizados

As regras de negócio (cálculo de datas, ciclos periódicos, pendências, estoque e sugestão de compra) possuem testes automatizados com Node.js:

```bash
npm test
```
