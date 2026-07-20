<p align="center">
  <img src="Electron/assets/turbowhats-icon.png" width="150" alt="Ícone do TurboWhats">
</p>

<h1 align="center">TurboWhats</h1>

<p align="center">
  <strong>Atendimento inteligente, automação e campanhas para WhatsApp em um aplicativo desktop.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.2.9-3568cf" alt="Versão 1.2.9">
  <img src="https://img.shields.io/badge/plataforma-Windows%20x64-0078D4" alt="Windows x64">
  <img src="https://img.shields.io/badge/Electron-43-47848F" alt="Electron 43">
  <img src="https://img.shields.io/badge/IA-Google%20Gemini-8E75B2" alt="Google Gemini">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licença-MIT-10b981" alt="Licença MIT"></a>
</p>

<p align="center">
  <a href="https://github.com/louro2023/ChatbotcomIA/releases"><strong>Ver versões portáteis</strong></a>
  ·
  <a href="https://github.com/louro2023/ChatbotcomIA/issues">Reportar problema</a>
</p>

---

## Visão geral

O **TurboWhats** é uma aplicação desktop para Windows criada para centralizar automação de atendimento, inteligência artificial, respostas por voz e campanhas personalizadas por WhatsApp e e-mail em uma interface simples.

O sistema conecta uma conta por QR Code, acompanha conversas privadas com notificações não lidas, envia a primeira resposta configurada e continua o atendimento de duas formas: por regras determinísticas ou com respostas contextuais geradas pelo Google Gemini.

O projeto foi desenvolvido como uma solução completa de produto: possui identidade visual própria, onboarding orientado, persistência segura, diagnóstico de mensagens, build portátil e documentação para usuário e desenvolvedor.

> [!IMPORTANT]
> O TurboWhats utiliza automação do WhatsApp Web por meio de `whatsapp-web.js`. Não é uma integração oficial da API WhatsApp Business. Mudanças no WhatsApp Web podem afetar o funcionamento. Use o sistema somente em atendimentos e campanhas autorizados pelos destinatários.

## O problema

Pequenos negócios frequentemente precisam responder perguntas repetidas, manter um atendimento inicial consistente e organizar contatos sem adotar plataformas complexas ou fragmentar o trabalho entre várias ferramentas.

Os principais desafios tratados pelo projeto foram:

- evitar que mensagens realmente não lidas fiquem sem retorno;
- permitir automação mesmo sem contratar uma IA;
- oferecer IA opcional sem esconder do usuário quando ela está ativa;
- manter configurações e sessão após reiniciar o aplicativo;
- simplificar o cadastro internacional de telefones;
- explicar claramente o que acontece depois da leitura do QR Code;
- distribuir tudo em um único executável para Windows.

## A solução

O TurboWhats combina oito módulos em uma experiência única:

| Módulo | O que entrega |
| --- | --- |
| **Conexão** | QR Code, autenticação, sincronização orientada, reconexão e sessão persistente |
| **Respostas** | Primeira mensagem, regras exatas e fallback quando a IA está desligada |
| **IA & Voz** | Gemini, contexto personalizado, histórico opcional e áudio com ElevenLabs |
| **Disparos** | Cadastro, importação direta do WhatsApp ou CSV/XLSX, tags, imagem, intervalo e progresso por contato |
| **Disparo de Email** | Gmail com Senha de app, destinatários, editor com imagens, anexos, tags e progresso individual |
| **Bot Instagram** | Sessão persistente, palavras-chave sem distinção de acentos, resposta pública, Direct e prevenção de duplicidade |
| **Métricas** | Envios do dia, pausas, intervalos, falhas, respostas da IA e atividade por hora e minuto |
| **Ajuda** | Orientações integradas sobre fluxos, chaves de API, limites e boas práticas |

## Destaques do produto

### Atendimento híbrido

O usuário escolhe entre um fluxo previsível baseado em regras e um atendimento contextual com IA. A primeira mensagem pode introduzir o atendimento nos dois modos.

### Rastreamento de não lidas

Além de ouvir novas mensagens em tempo real, o sistema revisa periodicamente conversas privadas com notificação ativa ou marcadas como não lidas. O rastreador usa controles contra duplicidade e registra decisões técnicas para diagnóstico.

### IA controlada pelo usuário

A chave do Gemini é testada antes de ser salva. A IA possui ativação independente, contexto editável, histórico opcional e painel local de uso de tokens. O teste de conexão usa timeout ampliado e novas tentativas para lidar melhor com redes lentas.

### Digitação simulada

Quando ativada, a conversa exibe **digitando...** antes de cada resposta automática. O tempo é calculado pelo tamanho do texto, com limites mínimos e máximos para manter o atendimento natural sem atrasos excessivos. A opção vale para primeira mensagem, IA, regras e fallback, mas não interfere em campanhas de disparo.

### Campanhas com menos erros de telefone

No cadastro manual, o telefone é dividido em **País**, **DDD** e **Número**. Uma prévia mostra o formato final antes de salvar.

### Campanhas de e-mail pelo Gmail

O remetente conecta uma conta Gmail ou Google Workspace usando uma **Senha de app**, testada antes de ser salva e protegida pelo armazenamento seguro do sistema operacional. Cada destinatário recebe uma mensagem individual, com nome, assunto, texto, imagens coladas, documentos e tags personalizados.

### Automação de comentários do Instagram

O usuário entra no Instagram em uma janela exibida somente durante o login, escolhe uma publicação ou Reel e cadastra várias palavras-chave. Ao iniciar o bot, a janela é fechada e o monitor passa a funcionar oculto em segundo plano. Novos comentários podem receber uma resposta pública, uma mensagem por Direct ou as duas ações. A comparação ignora maiúsculas e acentos, enquanto um estado persistente por publicação impede repetir a mesma ação para o mesmo perfil. Um comando de recuperação permite reprocessar comentários visíveis que já estavam na tela ou ficaram sem resposta.

```text
País: Brasil (+55)
DDD: 21
Número: 981682922
Prévia: +55 (21) 98168-2922
```

### Experiência portátil

O executável inclui Electron e um Chrome compatível com a automação. O usuário final não precisa instalar VS Code, Node.js, npm ou navegador adicional. Uma instalação nova começa sem contatos, chaves ou sessão herdada do ambiente de desenvolvimento.

## Jornada principal do usuário

```mermaid
flowchart LR
    A[Abrir TurboWhats] --> B[Escanear QR Code]
    B --> C[Autorizar dispositivo]
    C --> D[Sincronizar conversas]
    D --> E[Configurar Respostas]
    E --> F{Usar IA?}
    F -->|Não| G[Regras e fallback]
    F -->|Sim| H[Salvar chave Gemini]
    H --> I[Contexto e histórico]
    G --> J[Atendimento ativo]
    I --> J
```

A tela de conexão comunica cada estado real recebido do WhatsApp:

1. **QR Code:** aguarda a leitura pelo celular.
2. **Autenticação:** confirma que o dispositivo foi autorizado.
3. **Sincronização:** organiza conversas e mensagens não lidas.
4. **Concluído:** informa que o atendimento está disponível.

## Fluxo das respostas automáticas

```mermaid
flowchart TD
    A[Mensagem privada não lida] --> B{O bot já respondeu ao contato?}
    B -->|Não e primeira mensagem ativa| C[Enviar Primeira Mensagem]
    B -->|Sim ou primeira mensagem inativa| D{IA ativada?}
    D -->|Sim| E[Agrupar mensagens por 2 segundos]
    E --> F[Montar contexto e histórico]
    F --> G[Consultar Gemini]
    G --> H[Enviar resposta em texto]
    H --> I{Áudio ativado?}
    I -->|Sim| J[Gerar áudio com ElevenLabs]
    D -->|Não| K{Regra exata encontrada?}
    K -->|Sim| L[Enviar resposta da regra]
    K -->|Não| M[Enviar fallback]
```

### IA ativada

1. Na primeira resposta automática para o contato, o sistema envia a mensagem inicial configurada.
2. Nas mensagens seguintes, conteúdos recebidos em um intervalo curto são agrupados.
3. O Gemini responde seguindo as instruções salvas e, opcionalmente, o histórico recente.
4. Se voz estiver ativa e configurada, a mesma resposta também é enviada em áudio.

### IA desativada

1. O contato recebe a primeira mensagem, caso ainda não tenha recebido uma resposta do bot.
2. O texto seguinte é comparado às palavras-chave cadastradas.
3. Uma correspondência exata envia a resposta da regra.
4. Se nenhuma regra corresponder, o fallback orienta o contato.

Uma regra para `horário` não corresponde automaticamente a `horário?`. Essa decisão mantém o comportamento previsível; variações podem ser cadastradas separadamente.

## Arquitetura

O projeto usa a separação de processos recomendada pelo Electron. A interface não acessa diretamente Node.js, arquivos ou credenciais.

```mermaid
flowchart LR
    UI[Renderer<br>HTML, CSS e JavaScript] <-->|API limitada| PRE[Preload<br>contextBridge]
    PRE <-->|IPC| MAIN[Processo principal<br>Electron e regras de negócio]
    MAIN --> WA[whatsapp-web.js]
    MAIN --> GEMINI[Google Gemini API]
    MAIN --> VOICE[ElevenLabs API]
    MAIN --> GMAIL[Gmail SMTP com TLS]
    MAIN --> IG[Instagram Web via Puppeteer]
    MAIN --> DATA[(Dados locais protegidos)]
    WA --> CHROME[Chrome incorporado]
```

### Responsabilidades

| Camada | Responsabilidade |
| --- | --- |
| `Electron/index.html` | Estrutura semântica das telas e formulários |
| `Electron/style.css` | Design system, responsividade, estados e identidade TurboWhats |
| `Electron/renderer.js` | Interações da interface, validação e renderização de dados |
| `Electron/preload.js` | Contrato seguro de comunicação entre interface e processo principal |
| `Electron/main.js` | WhatsApp, Instagram, Gmail SMTP, Gemini, voz, persistência, rastreamento e campanhas |
| `Electron/instagram-utils.js` | Normalização, validação de URLs, palavras-chave e identificadores do Instagram |
| `scripts/` | Inicialização, preparação da marca e navegador do build |

## Decisões técnicas relevantes

- **Electron com `contextIsolation`:** mantém a interface separada das APIs do sistema.
- **`LocalAuth`:** preserva a sessão do WhatsApp entre inicializações.
- **Scanner a cada 8 segundos:** recupera mensagens com notificação que não chegaram pelo evento em tempo real.
- **Fila de 2 segundos:** agrupa mensagens consecutivas antes de consultar a IA.
- **Digitação proporcional:** calcula entre 0,9 e 6 segundos conforme o tamanho da resposta.
- **Gemini com timeout de 90 segundos:** reduz falsos erros em conexões lentas.
- **Até três tentativas de IA:** repete falhas temporárias com espera progressiva.
- **Configuração local protegida:** usa `safeStorage` para chaves e Senhas de app quando a criptografia do Windows está disponível.
- **SMTP Gmail com TLS:** testa a autenticação antes de salvar e envia uma mensagem individual por destinatário.
- **Perfil persistente do Instagram:** mantém a autenticação em uma pasta separada e nunca solicita a senha dentro do TurboWhats.
- **Monitoramento restrito à URL:** acessa somente a publicação ou Reel configurado, sem percorrer o feed.
- **Deduplicação por ação:** comentário e Direct possuem registros independentes por usuário e publicação.
- **HTML higienizado:** remove scripts, eventos e URLs JavaScript antes de montar cada e-mail.
- **ASAR e Chrome incorporado:** entrega um único executável portátil e reproduzível.
- **Dados de produção isolados:** o portátil usa uma pasta diferente do ambiente executado pelo código-fonte.

## Tecnologias

| Tecnologia | Uso no projeto |
| --- | --- |
| **Electron 43** | Aplicação desktop e APIs do Windows |
| **JavaScript** | Regras de negócio e interface |
| **HTML5 e CSS3** | Estrutura e identidade visual |
| **whatsapp-web.js** | Sessão e troca de mensagens pelo WhatsApp Web |
| **Puppeteer 24** | Sessão e automação do Instagram Web usando o Chrome incorporado |
| **Nodemailer** | Autenticação SMTP, HTML, imagens incorporadas e anexos de e-mail |
| **Google Gemini 3.5 Flash** | Respostas contextuais e conteúdo multimodal |
| **ElevenLabs** | Conversão opcional de texto em voz |
| **ExcelJS** | Importação de contatos CSV/XLSX |
| **QRCode** | Renderização do código de conexão |
| **electron-builder** | Empacotamento portátil para Windows x64 |

## Segurança e privacidade

O projeto aplica controles em várias camadas:

- `nodeIntegration` desativado no renderer;
- `contextIsolation` e sandbox ativados;
- funções IPC expostas por uma API mínima no preload;
- login do Instagram realizado diretamente no site, sem capturar usuário ou senha na interface do TurboWhats;
- navegação externa limitada aos domínios autorizados;
- chaves protegidas com `safeStorage` quando disponível;
- configurações, sessões, logs, caches e `.env` ignorados pelo Git;
- contatos e chaves ausentes do executável distribuído;
- identificadores anonimizados no controle da primeira mensagem.

Boas práticas para operação:

- revogue imediatamente qualquer chave publicada por engano;
- não compartilhe `config.json` ou `whatsapp-session/`, pois representam configurações e sessões desta instalação;
- evite enviar informações sigilosas à IA sem revisar os termos do provedor;
- envie campanhas somente para contatos que autorizaram o recebimento;
- respeite limites, políticas e termos do WhatsApp e das APIs utilizadas.

## Instalação

### Versão portátil

O build local mais recente gera:

```text
dist\TurboWhats-Portable-1.2.9.exe
```

As versões publicadas ficam na página de [Releases](https://github.com/louro2023/ChatbotcomIA/releases).

Requisitos do usuário final:

- Windows 10 ou Windows 11 x64;
- acesso à internet;
- conta do WhatsApp com suporte a aparelhos conectados;
- chave Gemini somente para usar IA;
- chave ElevenLabs somente para usar voz.

O executável possui aproximadamente 203 MB porque inclui o ambiente Electron e o Chrome usado pela automação.

> [!NOTE]
> O projeto ainda não possui certificado comercial de assinatura. O Windows SmartScreen pode exibir **Editor desconhecido** na primeira execução. Confira a origem e o hash antes de autorizar.

SHA-256 do build local da versão 1.2.9:

```text
EA58C2A3C4E568018EF47625611D0B3767C3F939BBC4A0C01D839B87F494CC8B
```

### Executar pelo código-fonte

```powershell
git clone https://github.com/louro2023/ChatbotcomIA.git
cd ChatbotcomIA
npm install
npm start
```

O inicializador do Windows libera o terminal e mantém somente a janela do TurboWhats aberta.

## Primeiros passos

### 1. Conectar o WhatsApp

1. Abra **Status**.
2. No celular, acesse **WhatsApp > Aparelhos conectados > Conectar aparelho**.
3. Leia o QR Code.
4. Mantenha o TurboWhats aberto durante a autenticação e sincronização.

Use **Reconectar** para recuperar a sessão atual. Use **Resetar conexão** para encerrar a sessão local e gerar um QR Code novo.

### 2. Configurar respostas sem IA

Na aba **Respostas**:

1. ative **Mensagens padrão**;
2. escreva a primeira resposta do bot;
3. cadastre palavras-chave e respostas;
4. configure o fallback;
5. mantenha a IA desativada durante o teste das regras.

### 3. Conseguir uma chave gratuita do Gemini

1. Acesse o [Google AI Studio — API Keys](https://aistudio.google.com/apikey).
2. Entre com uma conta Google e aceite os termos.
3. Crie ou selecione um projeto.
4. Clique em **Create API key** e copie a chave.
5. Em **IA & Voz**, cole a chave e selecione **Salvar e ativar API Key**.

O TurboWhats testa a API antes de salvar. O Free Tier e seus limites dependem da região, do projeto e das regras atuais do Google. Consulte a [documentação de preços do Gemini](https://ai.google.dev/gemini-api/docs/pricing).

### 4. Orientar a IA

Exemplo de contexto:

```text
Você é o assistente da Empresa Exemplo.
Responda em português, seja objetivo e cordial.
O atendimento funciona de segunda a sexta, das 8h às 18h.
Não invente preços, prazos ou políticas.
Quando não souber, encaminhe para um atendente humano.
```

Ative **Manter histórico** somente quando respostas anteriores forem relevantes para o atendimento.

### 5. Responder também em áudio

1. Obtenha uma chave no [ElevenLabs](https://elevenlabs.io/).
2. Informe a chave e escolha a voz.
3. Ative **Responder também em áudio**.

Sem ElevenLabs configurado, o atendimento em texto continua funcionando normalmente.

## Disparos personalizados

O módulo de campanhas permite:

- cadastrar contatos com país, DDD e número separados;
- importar diretamente os contatos salvos que aparecem em **Nova conversa** no WhatsApp conectado;
- importar planilhas CSV ou XLSX;
- selecionar destinatários individualmente ou em grupo;
- excluir de uma vez todos os contatos selecionados;
- usar texto, imagem ou ambos;
- personalizar mensagens com tags;
- definir um intervalo mínimo e máximo; uma nova espera é sorteada antes de cada próximo envio;
- acompanhar enviados e falhas;
- cancelar uma campanha em andamento.

Na importação direta, o TurboWhats considera somente contatos salvos e registrados no WhatsApp. O próprio usuário, grupos, contatos bloqueados, identificadores sem número disponível e telefones já cadastrados são ignorados. Os identificadores modernos `@lid` são convertidos para o número correspondente antes de salvar.

Colunas reconhecidas na importação:

- `Nome` ou `Contato`;
- `WhatsApp`, `Telefone`, `Celular`, `Número` ou `Phone`.

Números brasileiros importados com 10 ou 11 dígitos recebem `55` automaticamente. Para outros países, inclua o código internacional.

## Disparo de Email

O módulo de e-mail utiliza SMTP seguro do Gmail e permite:

- testar e salvar o e-mail, nome do remetente e Senha de app;
- cadastrar o nome do responsável por cada endereço;
- adicionar ou importar destinatários de arquivos CSV ou XLSX com colunas `Nome` e `Email`; quando o nome não for informado, o próprio e-mail será usado como nome do destinatário;
- selecionar ou excluir destinatários em grupo;
- personalizar o assunto e o conteúdo com `{Nome}`, `{PrimeiroNome}`, `{Email}`, `{Data}` e `{Hora}`;
- formatar o texto e colar imagens diretamente no editor com `Ctrl+V`;
- anexar até 10 documentos, respeitando o limite total de 18 MB;
- definir intervalos aleatórios entre 3 e 600 segundos;
- acompanhar sucessos e falhas e cancelar a campanha.

Para criar uma Senha de app, ative a verificação em duas etapas da Conta Google e abra [Senhas de app](https://myaccount.google.com/apppasswords). A senha normal do Gmail não deve ser informada ao TurboWhats. O Google pode indisponibilizar Senhas de app em contas organizacionais, contas protegidas pelo Advanced Protection ou contas configuradas somente com chaves de segurança.

O Gmail pessoal limita o envio a até 500 mensagens por dia e pode suspender novos envios por algumas horas quando a conta ultrapassa a cota ou gera muitos retornos. Consulte os [limites oficiais do Gmail](https://support.google.com/mail/answer/22839) e envie somente para destinatários que autorizaram o contato.

## Bot do Instagram

O módulo utiliza o mesmo Chrome incorporado no portátil, controlado pelo Puppeteer. A conta possui um perfil de navegador separado do WhatsApp e continua autenticada enquanto a sessão do Instagram permanecer válida.

Fluxo de configuração:

1. Clique em **Abrir Instagram para login** e faça o acesso diretamente no Instagram Web.
2. Volte ao TurboWhats e clique em **Verificar sessão**.
3. Cole uma URL no formato `https://www.instagram.com/p/CODIGO/` ou `https://www.instagram.com/reel/CODIGO/`.
4. Cadastre até 100 palavras-chave separadas por vírgula, ponto e vírgula ou linha.
5. Ative a resposta no comentário, o envio por Direct ou ambos.
6. Escreva a mensagem, confirme o uso autorizado e inicie o bot.

Após o login, a janela visual é necessária somente para autenticar ou renovar uma sessão expirada. Ao iniciar o monitor, o TurboWhats fecha essa janela e reinicia o mesmo perfil do Instagram em modo oculto. Comentários e Directs continuam sendo processados em segundo plano enquanto o TurboWhats estiver aberto.

O primeiro ciclo cria uma linha de base e não responde aos comentários antigos. Nos ciclos seguintes, o sistema:

- considera somente comentários novos encontrados na publicação configurada;
- normaliza letras e acentos, fazendo `currículo`, `CURRICULO` e `Currículo` corresponderem à mesma palavra;
- ativa o fluxo quando qualquer uma das palavras estiver presente no comentário;
- personaliza a mensagem com `{Nome}`, `{PrimeiroNome}`, `{Link}`, `{Data}` e `{Hora}`;
- registra separadamente respostas públicas e Directs concluídos;
- não repete a mesma ação para o mesmo usuário naquela publicação;
- retorna à publicação após enviar um Direct e continua monitorando;
- mantém logs, contadores e a opção de interrupção imediata.

Se um comentário já visível tiver sido registrado sem envio — por exemplo, após atualizar os seletores do Instagram — use **Reprocessar comentários visíveis** com o bot ativo. O sistema reconsidera os comentários atuais e tenta apenas a resposta pública ou o Direct que ainda não constar como concluído para aquele perfil.

O monitor usa a interface do Instagram Web, não a API oficial. Alterações de elementos, textos ou fluxos feitas pelo Instagram podem exigir atualização dos seletores do TurboWhats. Use a automação somente em interações esperadas e autorizadas pelos usuários.

## Painel de métricas

A aba **Métricas** atualiza automaticamente e mantém os dados no próprio computador. Ela apresenta:

- mensagens enviadas e tentativas realizadas hoje;
- tempo médio entre envios concluídos;
- tempo total efetivamente aguardado nas pausas dos disparos;
- taxa de respostas geradas pela IA em relação às tentativas ao Gemini;
- taxa de falha dos envios do dia;
- horário do último envio concluído;
- quantidade enviada na hora e no minuto atuais;
- gráficos de distribuição por hora e dos últimos 15 minutos.

Envios automáticos, respostas da IA, áudio, campanhas de WhatsApp, disparos de e-mail, respostas do Instagram e Directs são contabilizados. Os indicadores diários mudam à meia-noite no horário local, enquanto o histórico técnico dos últimos 31 dias permanece salvo em `metrics.json`.

| Tag | Resultado |
| --- | --- |
| `{Nome}` | Nome completo do contato |
| `{PrimeiroNome}` | Primeiro nome |
| `{Telefone}` | Telefone formatado |
| `{Email}` | Endereço cadastrado no módulo de e-mail |
| `{Link}` | Link da publicação monitorada no Instagram |
| `{Data}` | Data do envio em formato brasileiro |
| `{Hora}` | Horário do envio |

## Tokens e limites da IA

O painel acumula localmente os metadados retornados pelo Gemini:

- solicitações;
- tokens de entrada;
- tokens de resposta;
- tokens de raciocínio;
- total processado.

Esse painel representa apenas o uso registrado nesta instalação. A API de geração não informa o saldo restante do Free Tier; a cota oficial deve ser consultada no Google AI Studio.

## Persistência de dados

Dados do portátil:

```text
%APPDATA%\TurboWhats-Portable\app-data
```

Dados do ambiente de desenvolvimento:

```text
%APPDATA%\cchatbot\app-data
```

| Item | Finalidade |
| --- | --- |
| `config.json` | Mensagens, regras, contatos, opções e chaves protegidas |
| `whatsapp-session/` | Sessão local do WhatsApp |
| `instagram-session/` | Perfil local autenticado do Instagram Web |
| `instagram-monitor-state.json` | Comentários analisados e ações concluídas por usuário/publicação |
| `gemini-usage.json` | Contador local de solicitações e tokens |
| `first-message-state.json` | Controle anonimizado da primeira resposta |
| `runtime-errors.log` | Erros de execução para diagnóstico |
| `message-tracker.log` | Decisões do rastreador de mensagens |

## Estrutura do projeto

```text
ChatbotcomIA/
├── Electron/
│   ├── assets/
│   │   └── turbowhats-icon.png
│   ├── index.html
│   ├── instagram-utils.js
│   ├── main.js
│   ├── preload.js
│   ├── renderer.js
│   └── style.css
├── scripts/
│   ├── prepare-brand-assets.mjs
│   ├── prepare-browser.js
│   ├── test-instagram-browser.js
│   ├── test-instagram-ui.js
│   ├── test-instagram-utils.js
│   └── run-electron.js
├── icone.png
├── LICENSE
├── package.json
├── package-lock.json
└── README.md
```

## Desenvolvimento e build

| Comando | Finalidade |
| --- | --- |
| `npm start` | Inicia o aplicativo |
| `npm run check` | Verifica a sintaxe dos arquivos JavaScript |
| `npm run smoke` | Executa uma inicialização rápida de diagnóstico |
| `npm run prepare:brand` | Prepara PNG e ICO da identidade TurboWhats |
| `npm run prepare:browser` | Copia o Chrome compatível para o cache do build |
| `npm run pack:win` | Gera a pasta Windows descompactada para testes |
| `npm run build:win` | Gera o portátil único para Windows x64 |

Validação recomendada:

```powershell
npm run check
npm run smoke
```

Build final:

```powershell
npm install
npm run build:win
```

O `electron-builder` gera `dist\TurboWhats-Portable-<versão>.exe`. A compilação incorpora aproximadamente 408 MB de recursos do navegador antes da compactação e pode exigir cerca de 1 GB de espaço temporário.

Durante a extração inicial do portátil, o empacotador exibe uma tela de abertura com a identidade TurboWhats. Assim, o usuário recebe retorno visual imediatamente após executar o arquivo, antes mesmo de o Electron estar disponível para criar a janela principal.

## Testes realizados na versão 1.2.9

- verificação de sintaxe dos processos principal, preload, renderer e scripts;
- smoke test do Electron;
- validação de IDs únicos na interface;
- teste de montagem e formatação internacional de telefones;
- teste do contato brasileiro `+55 (21) 98168-2922`;
- validação do sorteio de intervalos, incluindo os limites mínimo e máximo;
- validação dos cálculos, séries horárias e indicadores do painel de métricas;
- inspeção visual dos créditos na tela de abertura e validação do contato externo;
- validação da conexão SMTP, configuração criptografada e mensagens de erro do Gmail;
- testes de tags de e-mail, higienização de HTML e imagens incorporadas por `data:` URI;
- inspeção visual da aba Disparo de Email em resolução desktop;
- testes de URLs permitidas e rejeitadas no monitor do Instagram;
- testes de palavras-chave sem distinção de maiúsculas ou acentos e remoção de duplicadas;
- validação do formato atual do Instagram baseado em `div` e permalink `/p/.../c/.../`, além do formato legado baseado em listas;
- teste real somente de leitura na publicação configurada: comentário, autor, texto, permalink, botão Responder e editor encontrados sem publicar mensagem;
- validação dos comandos atuais de envio: `Postar` para respostas públicas e `Send`/`Enviar` para mensagens no Direct;
- validação dos cliques reais de mouse nos controles `Responder`, `Postar` e `Send`/`Enviar`, sem manter a chamada JavaScript da página bloqueada;
- validação da composição correta da resposta pública após a menção automática, preservando `@usuario Mensagem` sem inserir texto no meio do nome;
- limite do protocolo do navegador e recuperação da publicação após uma falha de resposta pública;
- teste controlado na sessão real: abertura, foco, digitação e limpeza dos editores de comentário e Direct, sem publicar nem enviar a mensagem de diagnóstico;
- teste controlado da mesma sessão em modo headless: comentário e Direct localizados, digitados e limpos sem abrir janela nem realizar envio;
- confirmação do envio somente depois que o Instagram retirar o texto do editor;
- teste automatizado da aba Instagram: persistência, tags, início, contadores, logs e digitação durante o monitoramento;
- validação geométrica da barra de tags abaixo do editor e do diálogo de confirmação centralizado na janela;
- validação do controle persistente por comentário, usuário, publicação e tipo de ação;
- recuperação manual de comentários visíveis anteriormente registrados, sem duplicar correspondências nem ações concluídas;
- processamento de comentários inéditos revelados com atraso pelo Instagram, usando o início do monitoramento como limite sem liberar comentários históricos;
- inicialização do aplicativo empacotado;
- inspeção do conteúdo ASAR;
- confirmação de ausência de configurações pessoais no pacote;
- verificação do executável pelo Microsoft Defender;
- validação do SHA-256 publicado na Release.

## Solução de problemas

### O QR Code não aparece

- verifique a conexão com a internet;
- aguarde a preparação inicial;
- use **Resetar conexão** para remover a sessão anterior;
- confirme que o Chrome incorporado está presente no pacote.

### Uma mensagem não lida não recebeu resposta

- confirme que a conversa possui notificação ativa ou foi marcada como não lida;
- grupos e status são ignorados pelo atendimento automático;
- verifique se **Mensagens padrão** ou **IA** estão ativas;
- consulte `runtime-errors.log` e `message-tracker.log`.

### A IA não responde

- salve a chave novamente para repetir o teste;
- confirme que **IA ativada** está ligada;
- verifique cota, região e permissões no Google AI Studio;
- revise os contextos e filtros de segurança do projeto.

### Uma regra não corresponde

- desative a IA durante o teste;
- use exatamente o texto cadastrado;
- crie variações separadas para acentos, frases e pontuação;
- lembre que a primeira interação envia primeiro a mensagem inicial.

### O áudio não é enviado

- confirme a chave e a voz do ElevenLabs;
- ative **Responder também em áudio**;
- verifique a cota do provedor;
- confirme que o texto foi enviado normalmente.

### O Gmail não conecta

- não utilize a senha normal da Conta Google;
- ative a verificação em duas etapas e gere uma nova [Senha de app](https://myaccount.google.com/apppasswords);
- informe o mesmo endereço usado para gerar a senha;
- se a opção Senhas de app não aparecer, verifique se a conta é organizacional, usa Advanced Protection ou está configurada somente com chaves de segurança;
- depois de alterar a senha principal da Conta Google, gere uma nova Senha de app.

### O disparo de e-mail parou

- confira o erro exibido ao lado do destinatário;
- remova endereços inválidos e reduza o volume ou a frequência;
- contas pessoais do Gmail podem interromper novos envios após atingir a cota diária;
- confirme se os anexos e imagens juntos permanecem abaixo de 18 MB;
- aguarde a liberação indicada pelo Gmail antes de tentar novamente.

### O Bot Instagram não inicia

- clique em **Abrir Instagram para login**, conclua o acesso na janela externa e depois use **Verificar sessão**;
- confira se o link pertence a `instagram.com` e aponta diretamente para uma publicação ou Reel;
- ative pelo menos uma ação: comentário ou Direct;
- confirme que o TurboWhats continua aberto e que a publicação está acessível para essa conta; o navegador do Instagram permanece oculto durante o monitoramento.

### Um comentário novo não foi respondido

- mantenha o bot ativo antes de publicar o comentário de teste; a primeira leitura ignora intencionalmente comentários antigos;
- confira se qualquer palavra cadastrada aparece no comentário;
- consulte o painel **Atividade** para saber se o comentário foi identificado e se o envio falhou;
- se o comentário já estava visível ou foi registrado por uma versão anterior, mantenha o bot ativo e clique em **Reprocessar comentários visíveis**;
- lembre que o mesmo usuário recebe cada ação somente uma vez por publicação;
- se o Instagram tiver alterado a interface Web, atualize o TurboWhats antes de continuar.

## Evolução do projeto

Possíveis próximos passos:

- assinatura digital do executável Windows;
- testes automatizados de interface e integração;
- exportação de relatórios de campanhas;
- regras com correspondência parcial ou expressões configuráveis;
- suporte a múltiplos perfis de atendimento;
- atualização automática do aplicativo;
- opção de integração oficial com a WhatsApp Business Platform.

## Uso em portfólio

Este projeto demonstra competências em:

- descoberta e refinamento de requisitos a partir de problemas reais;
- desenvolvimento de aplicações desktop com Electron;
- automação resiliente de interfaces Web com Puppeteer e sessão persistente;
- integração com WhatsApp Web e APIs generativas;
- desenho de fluxos híbridos entre automação determinística e IA;
- segurança de IPC, credenciais e dados persistentes;
- modelagem de estados assíncronos e recuperação de falhas;
- UX writing para onboarding e carregamentos longos;
- importação e normalização de dados;
- criação de build portátil e processo de distribuição;
- documentação técnica e apresentação de produto.

## Contribuição

1. Faça um fork do repositório.
2. Crie uma branch para a alteração.
3. Execute `npm run check` e `npm run smoke`.
4. Abra um Pull Request explicando motivação, impacto e validação.

Relate problemas pelas [Issues](https://github.com/louro2023/ChatbotcomIA/issues). Nunca inclua chaves, números, sessões ou conversas nos relatórios.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).

## Autor

Sistema desenvolvido por **[Henrique Louro](https://github.com/louro2023)**.

- Contato: **21981682922**;
- WhatsApp: [iniciar conversa](https://wa.me/5521981682922);
- © 2026 Henrique Louro. Todos os direitos reservados a Henrique Louro.

---

<p align="center">
  <strong>TurboWhats</strong><br>
  Atendimento inteligente para WhatsApp.<br>
  Desenvolvido por Henrique Louro · Contato: 21981682922<br>
  © 2026 Henrique Louro · Todos os direitos reservados.
</p>
