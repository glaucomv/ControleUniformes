# Guia de Implantação (Google Sheets + Apps Script)

Este sistema é **100% gratuito**, não requer domínio nem servidor próprio e funciona diretamente na sua conta Google (Gmail comum ou Google Workspace).

Existem duas formas simples de colocar o sistema no ar:
- **Opção A (Pelo Navegador — Sem instalar nada):** Ideal para quem prefere copiar e colar os arquivos diretamente no editor do Google.
- **Opção B (Via Terminal com Clasp):** Para quem já usa Node.js e quer sincronizar os arquivos automaticamente com um comando.

---

## Opção A: Pelo Navegador (Recomendada e Fácil)

### Passo 1: Criar a Planilha Google
1. Acesse o seu Google Drive ([drive.google.com](https://drive.google.com)) com sua conta Gmail.
2. Clique em **+ Novo > Planilha Google**.
3. Dê o nome que desejar, por exemplo: `Controle de Uniformes`.

### Passo 2: Abrir o Editor do Apps Script
1. Na planilha aberta, clique no menu superior em **Extensões > Apps Script**.
2. Uma nova aba será aberta com o editor de código. No canto superior esquerdo, você pode nomear o projeto para `Controle de Uniformes`.

### Passo 3: Criar os Arquivos no Apps Script
No painel esquerdo do editor, você verá a lista de arquivos (com um arquivo padrão `Código.gs`). Você vai criar os seguintes arquivos com os conteúdos da pasta `src/`:

1. **`Logic.gs`** (Tipo: *Script*): Copie e cole todo o conteúdo de `src/Logic.js`.
2. **`Schema.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Schema.js`.
3. **`Db.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Db.js`.
4. **`Auth.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Auth.js`.
5. **`Api.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Api.js`.
6. **`Importacao.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Importacao.js`.
7. **`Setup.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Setup.js`.
8. **`Main.gs`** (Tipo: *Script*): Copie e cole o conteúdo de `src/Main.js`.
9. **`Index.html`** (Tipo: *HTML* — clique em **+ > HTML**): Copie e cole o conteúdo de `src/Index.html`.
10. **`Styles.html`** (Tipo: *HTML*): Copie e cole o conteúdo de `src/Styles.html`.
11. **`App.html`** (Tipo: *HTML*): Copie e cole o conteúdo de `src/App.html`.

*(Pode apagar o arquivo original `Código.gs` se quiser).*

### Passo 4: Configurar a Planilha Automaticamente
1. No editor do Apps Script, selecione a função **`configurarPlanilha`** no seletor de funções no topo.
2. Clique no botão **Executar**.
3. Na primeira execução, o Google pedirá autorização:
   - Clique em **Revisar permissões**.
   - Escolha sua conta Gmail.
   - Na tela "O Google não verificou este app", clique em **Avançado** (canto inferior) e depois em **Acessar Controle de Uniformes (não seguro)**.
   - Clique em **Permitir**.
4. O script criará instantaneamente todas as abas necessárias (`Colaboradores`, `Itens`, `Cargos`, `Pedidos`, etc.) e cadastrará o seu e-mail como **GESTOR**.

### Passo 5: Publicar o Web App (Acesso Web e Celular)
1. No canto superior direito do Apps Script, clique em **Implantar > Nova implantação**.
2. Clique no ícone de engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
3. Preencha os campos:
   - **Descrição:** `Versão 1.0`
   - **Executar como:** `Usuário que está acessando o app da Web`
   - **Quem tem acesso:** `Qualquer pessoa com uma Conta do Google`
4. Clique em **Implantar**.
5. Copie a **URL do app da Web** gerada (algo como `https://script.google.com/macros/s/.../exec`).
6. **Pronto!** Salve este link nos seus favoritos e acesse também pelo navegador do seu celular.

---

## Opção B: Via Terminal com Clasp (Oficial do Google)

Se você tem familiaridade com o terminal:

1. Instale o clasp globalmente:
   ```bash
   npm install -g @google/clasp
   ```
2. Faça login na sua conta Google:
   ```bash
   clasp login
   ```
3. Crie um projeto vinculado a uma planilha:
   ```bash
   clasp create --title "Controle de Uniformes" --type sheets
   ```
   *(Ou vincule a uma planilha existente colocando o Script ID no `.clasp.json`).*
4. Envie os arquivos do projeto:
   ```bash
   clasp push
   ```
5. Abra a planilha vinculada, vá ao menu **Uniformes > Configurar planilha** e publique a implantação via Apps Script.

---

## Compartilhando o Acesso com a Equipe

1. No aplicativo Web, acesse o menu **Cadastros > Usuários**.
2. Adicione o e-mail Google de cada colaborador que irá operar o sistema e defina o perfil:
   - **GESTOR:** Acesso completo a todas as funções e cadastros.
   - **COMPRADOR:** Acesso ao Painel, Sugestão de Compra, Pedidos e Fornecedores.
   - **ALMOXARIFE:** Acesso ao Painel, Estoque, Recebimento de Mercadorias, Cadastro de Colaboradores e Registro de Entregas.
3. Como usamos contas Gmail comuns, cada operador precisa ter permissão de **Editor** na planilha Google (o próprio sistema tenta compartilhar automaticamente ao salvar o usuário, ou você pode clicar em **Compartilhar** na planilha e adicionar os e-mails).
4. Envie a **URL do Web App** para a equipe.
