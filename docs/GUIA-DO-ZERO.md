# 🧒 GUIA DO ZERO — testar a captura de curtidores num computador novo

> Feito pra quem **nunca programou**. É só seguir na ordem, igual receita de bolo.
> Tudo numa **CONTA FAKE de teste** primeiro (NUNCA a sua conta de verdade).

## O que a gente vai fazer (em 1 frase)
O computador vai abrir o Instagram numa janela, **olhar quem curtiu tirando fotos da tela** (prints),
e depois um programa lê os prints e monta a lista. Sem robô digitando coisas — só "olhando".

## ⚠️ 3 regras que não podem quebrar
1. Use uma **conta FAKE** (criada só pra teste, sem foto, sem post). Não a sua.
2. Faça num **computador com internet de casa** (não em servidor/nuvem).
3. Se a janela travar ou o Instagram reclamar, **PARE** e espere o dia seguinte.

---

# PARTE 1 — Instalar os programas (faz uma vez só)

### Como abrir o "Prompt de Comando" (a janela preta onde se digita)
Aperte a tecla **Windows**, digite **cmd**, aperte **Enter**. Abriu uma janela preta? É essa.
(Quando o guia disser "no Prompt", é aqui que você digita.)

### 1.1 — Google Chrome
Provavelmente já tem. Se não: vá em **google.com/chrome** → **Baixar Chrome** → abrir o arquivo → **Instalar**.

### 1.2 — Node.js  (precisa pro teste "cdp")
1. Vá em **https://nodejs.org**
2. Clique no botão verde que diz **LTS** (baixa um arquivo `.msi`).
3. Abra o arquivo → **Next → Next → Install → Finish** (pode deixar tudo no padrão).
4. **Conferir:** no Prompt, digite `node -v` e Enter. Tem que aparecer algo tipo `v20.20.2`.

### 1.3 — Python  (precisa pro teste "nodriver" E pra ler os prints)
1. Vá em **https://python.org/downloads**
2. Clique em **Download Python 3.x** (o botão amarelo).
3. Abra o arquivo. **⚠️ MUITO IMPORTANTE:** na primeira tela, **MARQUE a caixinha embaixo**
   que diz **"Add python.exe to PATH"**. Depois clique **Install Now**.
4. **Conferir:** no Prompt, digite `python --version`. Tem que aparecer `Python 3.x`.

---

# PARTE 2 — Baixar o código (sem precisar de programa nenhum)

1. No navegador, abra: **https://github.com/jfelippebethlem-tech/Bond**
2. Tem um botãozinho cinza que mostra **`main`** (perto do canto esquerdo, em cima da lista de arquivos).
   Clique nele e escolha **`teste/nodriver`** (recomendado) ou **`teste/cdp`**.
3. Clique no botão verde **`< > Code`** → **Download ZIP**.
4. Achou o arquivo baixado? Clique com o **botão direito** → **Extrair tudo**.
5. Na janela que abrir, troque o lugar para uma pasta fácil: digite **`C:\bond-teste`** e extraia.
6. Agora você tem a pasta **`C:\bond-teste`** com as pastas `captura` e `parse` dentro.

---

# PARTE 3 — Pegar uma "chave" do Gemini (de graça — pra ler os prints)

1. Vá em **https://aistudio.google.com/apikey**
2. Faça login com uma conta Google qualquer.
3. Clique **Create API key** (Criar chave). Vai aparecer um monte de letras numa linha.
4. Clique em **copiar**. Guarda isso — é a "chave" (uma senha) pro próximo passo.

---

# PARTE 4 — Colar a chave num arquivinho de configuração

1. Abra o **Bloco de Notas** (Windows → digite "Bloco de Notas").
2. Escreva **uma linha** só, colando sua chave depois do `=`:
   ```
   GEMINI_API_KEY=cole_aqui_a_sua_chave
   ```
3. Clique **Arquivo → Salvar como**.
4. Em "Nome", escreva exatamente: **`.env`** (com o ponto na frente).
5. Em "Tipo", escolha **Todos os arquivos** (pra não virar `.env.txt`).
6. Salve **dentro da pasta `C:\bond-teste`** (a pasta principal, não dentro de captura).

---

# PARTE 5 — Instalar a "peça" do teste que você escolheu

No Prompt de Comando, primeiro **entre na pasta** (digite e Enter):
```
cd C:\bond-teste
```

**Se você baixou o `teste/nodriver`:**
```
pip install nodriver
```
**Se você baixou o `teste/cdp`:**
```
npm install ws
```
Espera terminar (aparece o cursor de novo). Pronto.

---

# PARTE 6 — RODAR O TESTE (1 post só, vendo a janela)

Esse é o momento. Vai abrir uma janela do Chrome; você **loga na conta fake** e ele faz sozinho.

### Se for o `teste/nodriver`:
No Prompt (dentro de `C:\bond-teste`), digite — **trocando `contadeteste` pelo perfil público que quer espiar**:
```
powershell -ExecutionPolicy Bypass -File captura\validar.ps1 -Alvo "contadeteste"
```

### Se for o `teste/cdp`:
1. Primeiro **abra o Chrome em modo de teste**. No Prompt, cole isto (uma linha só):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\jfn\ig-profile"
   ```
2. Naquela janela do Chrome que abriu, **faça login na conta fake** do Instagram.
3. Aí sim, num **outro** Prompt (dentro de `C:\bond-teste`):
   ```
   powershell -ExecutionPolicy Bypass -File captura\validar.ps1 -Alvo "contadeteste"
   ```

### O que vai acontecer
- A janela abre. Se pedir login, **faça login na conta fake** (usuário, senha, e o código 2FA se tiver).
  Ele **espera você** (até 5 minutos) e continua sozinho.
- Ele entra num post, abre "curtidas", e **rola tirando fotos**, devagar (isso é de propósito).
- No fim, o Prompt mostra um resumo:
  - **modal abriu: SIM** ✅  e  **prints de curtidas: 5** (ou mais) → deu certo!
  - **modal abriu: NAO** ❌ → não rolou; veja a dica no fim do guia.

---

# PARTE 7 — Ler os prints e montar a lista

Ainda no Prompt, dentro de `C:\bond-teste`:
```
python parse\parse_likers.py
```
Ele lê as fotos com o Gemini e no fim diz quantos **curtidores** achou. Se achou mais que zero:
**🎉 funcionou de ponta a ponta** — e tudo na conta de teste, sem risco.

A lista fica salva em `C:\bond-teste\likers-sync\likers.json` (dá pra abrir no Bloco de Notas).

---

# PARTE 8 (opcional) — Acionar pelo Telegram do Bond

> Isso só vale se este desktop estiver **conectado à VM pelo Syncthing** (a pasta `C:\jfn\bond`).
> Se for um desktop solto só pra testar, pule — as Partes 6 e 7 já bastam.

1. Deixe o **poller** ligado (uma janela que fica escutando o Telegram). No Prompt:
   ```
   powershell -ExecutionPolicy Bypass -File captura\poller.ps1 -Alvo "seu_perfil" -Motor nodriver
   ```
   Deixe essa janela **aberta**.
2. No Telegram, no **@BondCampanhaBot**, mande **`/capturar`**.
   - O poller pega em ~12s, roda a captura + leitura dos prints, e te responde no Telegram.
3. Veja o resultado com **`/curtidores`** (top de quem mais curtiu) e a saúde com **`/status`**.

---

# 📖 Dicionário rápido
- **Prompt de Comando (cmd):** a janela preta. Abre com Windows → `cmd` → Enter.
- **PowerShell:** parecida (azul). Usamos pelos comandos `powershell -File ...` acima — não precisa abrir à mão.
- **Python / Node:** os "motores" que rodam os programas (instalados na Parte 1).
- **`.env`:** arquivinho com a chave secreta do Gemini.
- **Motor `nodriver` / `cdp`:** dois jeitos de fazer o navegador "olhar" — os dois funcionam; o `nodriver` é o mais seguro.
- **prints / screenshots:** as fotos da tela que o programa tira das curtidas.

# 🆘 Se der errado
- **"`python` não é reconhecido"** → você esqueceu de marcar **"Add python.exe to PATH"** na Parte 1.3.
  Reinstale o Python marcando a caixinha.
- **"`node` não é reconhecido"** → instale o Node (Parte 1.2) e feche/reabra o Prompt.
- **modal NÃO abriu** → abra a foto `post_1.png` (em `C:\bond-teste\captura\shots\...\<post>\`). Se o
  Instagram mostrou "ação bloqueada" ou tela estranha, **a conta está limitada** — pare e espere 24–48h
  (use OUTRA conta fake). Se o post abriu normal mas não achou o botão de curtidas, me avise: o Instagram
  mudou o layout e eu ajusto o seletor.
- **Sempre comece com 1 post na conta de teste.** Só aumente depois que esse teste der certo.
