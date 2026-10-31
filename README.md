# MathClash ⚔️➕✖️

Jogo de matemática **para dois jogadores no mesmo ecrã** — ideal para passar o tempo enquanto esperam (no restaurante, no consultório, no carro…).

Pousem o telemóvel na mesa entre os dois: cada jogador fica numa ponta, com o seu avatar e a sua cor. Vão aparecendo contas cada vez mais difíceis, com 4 hipóteses de resposta. **Acertar faz a tua cor expandir pelo tabuleiro** (e roubar casas ao adversário!); **errar faz a tua cor encolher** um bocadinho. Ganha quem conquistar o tabuleiro todo — ou quem tiver mais território quando o tempo acabar.

Corre na **web** (também instalável como app e funciona offline) e em **Android** (APK nativo via Capacitor).

## Como se joga

1. No menu, cada jogador escolhe o **avatar** (toca nele para mudar), a **cor** e o **nível** — dá para jogar miúdos contra graúdos. O nível decide que contas aparecem:

   | Nível | Contas |
   |---|---|
   | 🐣 Pequeno | só somar e subtrair |
   | 🙂 Fácil | somar, subtrair e multiplicar |
   | 😎 Médio | as 4 operações |
   | 🔥 Difícil | tudo: contas mistas, número em falta, quadrados, raízes, percentagens, negativos… |
   | 🧠 Génio | tudo, a começar já com números grandes |

2. Escolham a duração (1, 2, 3 min ou sem limite) e carreguem os dois em **PRONTO!**
3. Depois do 3, 2, 1… respondam o mais depressa possível. Cada jogador tem as suas próprias contas, viradas para si.

| | |
|---|---|
| ✅ Resposta certa | A tua cor expande (casas neutras primeiro, depois as do adversário) |
| ❌ Resposta errada | Perdes algumas casas e ficas bloqueado ~1 segundo (a resposta certa é mostrada) |
| 🔥 Série de acertos | 3, 5 e 8 seguidas dão cada vez mais casas |
| ⚡ Resposta rápida | Menos de 2,5 s dá bónus |
| ⭐ Conta dourada | Vale o dobro |
| 📈 Dificuldade | A cada 4 acertos os números ficam maiores (as operações não mudam); com o passar do tempo cada acerto vale mais |
| 🏠 Casa do avatar | Só pode ser roubada quando é a última — é o golpe final! |

Com teclado (versão web em computador): Jogador 1 usa `1 2 3 4` ou `A S D F`, Jogador 2 usa `7 8 9 0` ou `H J K L`. `Esc` ou `P` pausa.

## Desenvolvimento

Requisitos: Node.js 22+.

```bash
npm install
npm run dev        # servidor local (abre também no telemóvel pela rede local)
npm test           # testes (gerador de contas, tabuleiro, regras)
npm run build      # versão web final em dist/
```

Truque para testar: abre `?bots=1,2` no URL e o computador joga sozinho dos dois lados.

### Estrutura

```
src/
  questions.ts   gerador de contas (operações por nível, números a crescer por etapa) e respostas erradas plausíveis
  board.ts       lógica do tabuleiro: expandir, encolher, roubar, inundação final
  rules.ts       equilíbrio do jogo: recompensas, penalizações, subida de nível
  renderer.ts    desenho do tabuleiro em canvas, com animação de "tinta a espalhar"
  avatar.ts      avatares SVG com expressões (feliz, triste, espantado, coroa…)
  fx.ts          partículas, estrelas e confetis
  audio.ts       efeitos sonoros sintetizados (sem ficheiros de áudio)
  ui/menu.ts     ecrã inicial (configuração de cada jogador)
  ui/game.ts     ecrã de jogo, pausa e resultados
android/         projeto nativo Android (Capacitor)
```

## Android

O projeto Android está em `android/` (Capacitor 8). A app fica sempre em modo retrato, em ecrã inteiro e sem o ecrã se desligar durante o jogo.

**Descarregar o APK já feito:** cada push gera o APK no GitHub Actions (workflow *CI* → artefacto `MathClash-apk`). Ao criar uma tag `v*` (ex.: `v1.0.0`) o APK é anexado automaticamente à *Release*.

**Compilar localmente** (requer Android SDK e Java 21):

```bash
npm run android:apk          # gera android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open         # ou abrir no Android Studio
```

Para instalar o APK no telemóvel é preciso permitir a instalação de "apps de origem desconhecida".

Os ícones e o ecrã de arranque são gerados a partir de `assets/icon-mark.svg` com `npm run icons`.

## Web

`npm run build` gera um site estático em `dist/` que funciona em qualquer servidor (caminhos relativos) e offline depois da primeira visita (service worker). No Android, o Chrome permite "Adicionar ao ecrã principal" para jogar como uma app.

O workflow *Publicar versão web* publica automaticamente no **GitHub Pages** a cada push para `main`. Para isso ficar ativo, é preciso ir uma vez a **Settings → Pages → Source** e escolher **GitHub Actions**.
