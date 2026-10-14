/**
 * Ícone do HUB SNK na bandeja (Windows), na área de indicadores (Linux) ou na barra de
 * menus (Mac).
 *
 * Com ele, fechar a janela só a esconde: o app continua no ar para o atalho global da
 * busca rápida e para os avisos de mensagem nova do painel de comunicação. Sair de
 * verdade é pelo menu da bandeja ou por Hub › Sair.
 *
 * No Windows o menu é montado a cada clique com o botão direito, e não fixado com
 * `setContextMenu`, porque as caixas mostram estado que muda por fora dele: o início
 * automático pode ser desligado no Gerenciador de Tarefas, e o atalho global, recusado pelo
 * Windows. No Linux não há escolha: ver `fixarMenuNoLinux`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Menu, Notification, Tray, app, type MenuItemConstructorOptions } from 'electron';
import type { SituacaoDoAtalhoGlobal } from './atalhoGlobal';
import { ATALHO_GLOBAL_DA_BUSCA } from './buscaRapida';
import { ICONE, ICONE_DA_BANDEJA } from '../config';
import { logEvento } from '../log';
import { atalhoLegivel } from './menuFlutuante';

/** Marca, na pasta do app, que o aviso da bandeja já foi mostrado uma vez. */
const ARQUIVO_DO_AVISO_DA_BANDEJA = 'aviso-da-bandeja-exibido';

export interface AcoesDaBandeja {
  mostrarJanela(): void;
  abrirBusca(): void;
  situacaoDoAtalhoGlobal(): SituacaoDoAtalhoGlobal;
  definirAtalhoGlobalLigado(ligado: boolean): void;
  inicioAutomaticoLigado(): boolean;
  definirInicioAutomatico(ligado: boolean): void;
  sair(): void;
}

/**
 * Por que o sistema não entregou a tecla. No Windows é outro programa com a mesma
 * combinação; no Linux, quase sempre o Wayland, que só a entrega pelo portal de atalhos
 * (GNOME 48 em diante, KDE).
 */
const MOTIVO_DO_ATALHO_RECUSADO =
  process.platform === 'win32' ? 'em uso por outro programa' : 'o sistema não liberou a tecla';

/** Caixa marcada é a escolha de ligar; o sufixo diz quando o sistema não entregou a tecla. */
function itemDoAtalhoGlobal(acoes: AcoesDaBandeja): MenuItemConstructorOptions {
  const situacao = acoes.situacaoDoAtalhoGlobal();
  const aviso = situacao === 'recusado' ? ` — ${MOTIVO_DO_ATALHO_RECUSADO}` : '';
  return {
    label: `Atalho global (${atalhoLegivel(ATALHO_GLOBAL_DA_BUSCA)})${aviso}`,
    type: 'checkbox',
    checked: situacao !== 'desligado',
    click: (item) => acoes.definirAtalhoGlobalLigado(item.checked),
  };
}

function itemDoInicioAutomatico(acoes: AcoesDaBandeja): MenuItemConstructorOptions {
  return {
    label: 'Iniciar HUB SNK automaticamente',
    type: 'checkbox',
    checked: acoes.inicioAutomaticoLigado(),
    click: (item) => acoes.definirInicioAutomatico(item.checked),
  };
}

function montarMenuDaBandeja(acoes: AcoesDaBandeja): Menu {
  const atalhoAtivo = acoes.situacaoDoAtalhoGlobal() === 'ativo';
  return Menu.buildFromTemplate([
    { label: 'Abrir o HUB SNK', click: () => acoes.mostrarJanela() },
    {
      label: 'Busca rápida',
      // Só exibe a combinação, e só quando ela vale: quem a registra é o `globalShortcut`.
      accelerator: atalhoAtivo ? ATALHO_GLOBAL_DA_BUSCA : undefined,
      registerAccelerator: false,
      click: () => acoes.abrirBusca(),
    },
    { type: 'separator' },
    itemDoAtalhoGlobal(acoes),
    itemDoInicioAutomatico(acoes),
    { type: 'separator' },
    { label: 'Sair', click: () => acoes.sair() },
  ]);
}

/**
 * No Linux a bandeja é um AppIndicator: o painel do GNOME abre o menu sozinho e não repassa
 * o clique direito ao app, então o menu precisa estar fixado. É refeito a cada caixa
 * clicada, para a marcação acompanhar o estado.
 */
function fixarMenuNoLinux(bandeja: Tray, acoes: AcoesDaBandeja): void {
  const refazer = () => bandeja.setContextMenu(montarMenuDaBandeja(acoesQueRefazem));
  const acoesQueRefazem: AcoesDaBandeja = {
    ...acoes,
    definirAtalhoGlobalLigado: (ligado) => {
      acoes.definirAtalhoGlobalLigado(ligado);
      refazer();
    },
    definirInicioAutomatico: (ligado) => {
      acoes.definirInicioAutomatico(ligado);
      refazer();
    },
  };
  refazer();
}

export function criarBandeja(acoes: AcoesDaBandeja): Tray {
  const bandeja = new Tray(ICONE_DA_BANDEJA);
  bandeja.setToolTip(app.getName());
  // No Mac o clique esquerdo no ícone abre o menu, como no Linux: é a convenção da barra.
  if (process.platform !== 'win32') {
    fixarMenuNoLinux(bandeja, acoes);
    return bandeja;
  }
  bandeja.on('click', () => acoes.mostrarJanela());
  bandeja.on('right-click', () => {
    bandeja.popUpContextMenu(montarMenuDaBandeja(acoes));
  });
  return bandeja;
}

/**
 * Na primeira vez que o X esconde a janela, avisa onde o app foi parar — sem isso, o
 * HUB SNK parece ter fechado, mas continua rodando.
 */
export function avisarQueContinuaNaBandeja(): void {
  const marcador = join(app.getPath('userData'), ARQUIVO_DO_AVISO_DA_BANDEJA);
  if (existsSync(marcador)) return;

  new Notification({
    title: 'O HUB SNK continua aberto',
    body:
      process.platform === 'win32'
        ? 'Ele fica na bandeja, perto do relógio. Para encerrar, clique com o botão direito no ícone e escolha Sair.'
        : 'Ele fica no ícone do canto superior direito da tela. Para encerrar, clique no ícone e escolha Sair.',
    icon: ICONE,
  }).show();

  try {
    writeFileSync(marcador, new Date().toISOString());
  } catch (erro) {
    logEvento('aviso-da-bandeja-nao-gravado', { erro: (erro as Error).message });
  }
}
