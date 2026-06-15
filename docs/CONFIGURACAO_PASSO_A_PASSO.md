# Guia de Configuração — Tudo que depende de você

Este guia lista **tudo que precisa de uma ação humana** para o PolitiMonitor
funcionar 100%. Cada item diz: o que é, se é grátis, e o passo a passo.

> Regra de ouro: TODAS as chaves abaixo vão **somente** no arquivo `.env` na VM.
> Nunca commite o `.env` (ele já está no `.gitignore`).

---

## Resumo rápido (checklist)

| # | Item | Grátis? | Obrigatório? | Tempo |
|---|------|---------|--------------|-------|
| 1 | Senhas do sistema (`AUTH_SECRET`, `ADMIN_PASSWORD`) | ✅ | **Sim** | 2 min |
| 2 | Gemini API (IA principal) | ✅ | **Sim** | 5 min |
| 3 | OpenRouter (Hermes 405B) | ✅ | Recomendado | 5 min |
| 4 | Conectar WhatsApp (QR) | ✅ | Recomendado | 3 min |
| 5 | Meta / Facebook + Instagram | ✅ | Para redes | 30-60 min |
| 6 | Twitter/X API | ✅ (limitado) | Opcional | 15 min |
| 7 | Telegram Bot | ✅ | Opcional | 5 min |

Sem os itens 5-7 o sistema **funciona** — você só não terá os dados daquela
rede. O núcleo (apoiadores, IA, WhatsApp, métricas) roda só com 1, 2 e 4.

---

## 1. Senhas do sistema (OBRIGATÓRIO)

No `.env` da VM, troque os valores padrão:

```
AUTH_SECRET="<cole aqui um texto aleatório longo>"
ADMIN_PASSWORD="<a senha que VOCÊ vai usar pra entrar no painel>"
```

Para gerar um `AUTH_SECRET` forte, rode na VM:
```bash
openssl rand -base64 32
```
Copie o resultado e cole no `AUTH_SECRET`. O `ADMIN_PASSWORD` é a senha que você
digita na tela de login do sistema.

---

## 2. Gemini API — IA principal (OBRIGATÓRIO, GRÁTIS)

É a IA que analisa comentários, gera respostas e relatórios. Grátis: 1.500
requisições por dia, **sem cartão de crédito**.

1. Acesse https://aistudio.google.com/app/apikey
2. Faça login com uma conta Google
3. Clique em **"Create API key"** → **"Create API key in new project"**
4. Copie a chave (começa com `AIza...`)
5. No `.env`:
   ```
   GEMINI_API_KEY="AIza...sua-chave"
   ```

---

## 3. OpenRouter — Hermes 405B (RECOMENDADO, GRÁTIS)

É o "cérebro" do agente autônomo Hermes (modelo da Nous Research). Se não
configurar, o sistema usa o Gemini como reserva automaticamente.

1. Acesse https://openrouter.ai
2. Crie conta (pode logar com Google)
3. Vá em https://openrouter.ai/keys → **"Create Key"**
4. Copie a chave (começa com `sk-or-...`)
5. No `.env`:
   ```
   OPENROUTER_API_KEY="sk-or-...sua-chave"
   ```

---

## 4. Conectar o WhatsApp (RECOMENDADO, GRÁTIS — sem API)

Usa Baileys (WhatsApp Web). **Não precisa de chave nem cartão.** A conexão é
por QR Code, exatamente como o WhatsApp Web do computador.

> ⚠️ Use de preferência um **número dedicado à campanha** (chip separado), não o
> seu pessoal. O WhatsApp pode bloquear números que disparam muitas mensagens.

1. Na VM, confirme que o worker está rodando:
   ```bash
   pm2 status          # deve listar "whatsapp-worker" como online
   pm2 logs whatsapp-worker
   ```
2. Abra o sistema no navegador → menu lateral **WhatsApp**
3. Vai aparecer um **QR Code** na tela
4. No celular da campanha: **WhatsApp → Configurações → Aparelhos conectados →
   Conectar um aparelho**
5. Aponte a câmera para o QR Code da tela
6. Pronto. O status muda para **"Conectado"** (verde). A sessão fica salva — não
   precisa repetir, a menos que você desconecte pelo celular.

---

## 5. Meta (Facebook + Instagram) — Graph API (GRÁTIS, mas trabalhoso)

Isso libera: sincronizar seus posts, ver quem curtiu/comentou, vincular
apoiadores, monitorar adversários no Instagram. **O Instagram usa o MESMO token
do Facebook.**

### Pré-requisitos
- Uma **Página** do Facebook (não perfil pessoal) do mandato/candidato
- Uma conta **Instagram Profissional** (Business ou Creator) **vinculada a essa
  Página** (no app do Instagram: Configurações → Conta → Mudar para conta
  profissional, e vincular à Página do Facebook)

### Passo a passo
1. Acesse https://developers.facebook.com e faça login
2. **"Meus Apps"** → ⚠️ **REUSE um app que já existe — NÃO crie um novo.**
   Só clique **"Criar app"** (tipo **"Empresa/Business"**, nome único) se você **não tiver NENHUM** app.
   > 🛑 **NUNCA clique "Criar app" a cada tentativa.** Isso gera apps duplicados (ex.: vários "JFN Monitor e Ideia").
   > Escolha **UM** app e faça TUDO sempre nele. Se já criou duplicados, apague os extras depois
   > (cada um → *Configurações → Avançado → Excluir app*).
3. **Nesse mesmo app**, adicione os produtos **"Instagram Graph API"** e **"Facebook Login"**
4. Vá em **Ferramentas → Explorador da Graph API**
   (https://developers.facebook.com/tools/explorer/)
5. No seletor, escolha seu app; clique em **"Gerar token de acesso"**
6. **Add Permissions / Marque estas permissões (scopes) ANTES de gerar** (o botão "Gerar" sozinho sai só com
   `public_profile` — aí o Bond não vê nada):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_read_user_content`
   - `pages_manage_metadata`
   - `instagram_basic`
   - `instagram_manage_comments`
   - `instagram_manage_insights`
   - `read_insights`
7. Gere o token e **autorize** com a conta que administra a Página
8. Esse token inicial dura ~1-2h. Para transformá-lo em **token de longa
   duração (~60 dias)**:
   - Pegue o **App ID** e **App Secret** em **Configurações → Básico**
   - Rode (troque os valores):
     ```bash
     curl -s "https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=SEU_APP_ID&client_secret=SEU_APP_SECRET&fb_exchange_token=TOKEN_CURTO"
     ```
   - A resposta traz um `access_token` novo (longo)
9. (Opcional, melhor) Para um **token de Página que praticamente não expira**:
   chame `GET /me/accounts` com o token longo e use o `access_token` da sua
   Página no resultado.
10. No `.env`:
    ```
    FACEBOOK_PAGE_TOKEN="EAA...seu-token-de-pagina"
    ```

> O Instagram é detectado automaticamente a partir desse token (a conta
> Business vinculada à Página). Não precisa de chave separada.

> **Importante sobre o "App Mode":** enquanto o app estiver em
> **Desenvolvimento**, o token só lê dados das contas que são administradoras do
> app. Para a sua própria Página/Instagram isso já basta. Se um dia precisar de
> mais, peça **App Review** à Meta.

---

## 6. Twitter / X API (OPCIONAL, grátis limitado)

O plano gratuito do X é bem restrito (poucas leituras por mês). Configure só se
o Twitter for relevante pra você.

1. Acesse https://developer.twitter.com → **"Sign up for Free Account"**
2. Crie um **Project** e um **App**
3. Em **Keys and tokens**, gere o **Bearer Token**
4. No `.env`:
   ```
   TWITTER_BEARER_TOKEN="seu-bearer-token"
   TWITTER_USERNAME="seu_usuario_sem_arroba"
   ```

---

## 7. Telegram Bot (OPCIONAL, grátis)

Para monitorar mensagens de cidadãos via Telegram.

1. No Telegram, fale com **@BotFather**
2. Envie `/newbot`, escolha nome e usuário do bot
3. O BotFather devolve um **token** (formato `123456:ABC-...`)
4. No `.env`:
   ```
   TELEGRAM_BOT_TOKEN="123456:ABC-...seu-token"
   ```

---

## Depois de editar o `.env`

Sempre que mudar o `.env`, recarregue os processos para aplicar:

```bash
cd ~/JFN
pm2 reload ecosystem.config.js --update-env
pm2 status
```

Para ver se está tudo no ar:
```bash
pm2 logs          # logs de todos os processos (Ctrl+C para sair)
```

---

## Ordem recomendada (do mínimo ao completo)

1. **Hoje:** itens 1 + 2 + 4 → já tem painel, IA e WhatsApp funcionando
2. **Esta semana:** item 5 (Meta) → sincroniza redes e ativa o checklist de apoiadores
3. **Quando quiser:** itens 3, 6, 7 → Hermes turbinado, Twitter e Telegram
