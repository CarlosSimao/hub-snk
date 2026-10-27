/**
 * Janela de escolha do que compartilhar no Meet, no desenho do seletor do Chrome: abas
 * "Tela inteira" e "Janela", cada fonte com a miniatura de como ela está agora.
 *
 * Só há telas e janelas do sistema: o Electron não enxerga as guias de outro navegador, e o
 * Meet do HUB roda na janela própria dele, não numa guia.
 */
import { join } from 'node:path';
import { BrowserWindow, desktopCapturer, ipcMain, type DesktopCapturerSource } from 'electron';
import { ICONE } from '../config';

export interface EscolhaDeTela {
  fonte: DesktopCapturerSource;
  /** Marcou "compartilhar áudio do sistema". */
  comAudio: boolean;
}

interface FonteParaATela {
  id: string;
  nome: string;
  tipo: 'tela' | 'janela';
  miniatura: string;
  icone: string;
}

const COR_DE_FUNDO = '#1b1f27';
const LARGURA = 760;
const ALTURA = 560;
const TAMANHO_DA_MINIATURA = { width: 320, height: 180 };

function paraATela(fonte: DesktopCapturerSource): FonteParaATela {
  return {
    id: fonte.id,
    nome: fonte.name,
    tipo: fonte.id.startsWith('screen:') ? 'tela' : 'janela',
    miniatura: fonte.thumbnail.toDataURL(),
    icone: fonte.appIcon && !fonte.appIcon.isEmpty() ? fonte.appIcon.toDataURL() : '',
  };
}

/** Resolve com a escolha, ou `null` se a janela foi cancelada ou fechada. */
export async function escolherFonteDeTela(
  pai: BrowserWindow | null,
  oferecerAudio: boolean,
): Promise<EscolhaDeTela | null> {
  const fontes = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: TAMANHO_DA_MINIATURA,
    fetchWindowIcons: true,
  });

  return new Promise((resolver) => {
    const janela = new BrowserWindow({
      parent: pai ?? undefined,
      // Sem `modal`: no Windows, fechar uma janela modal minimizava a janela da reunião.
      width: LARGURA,
      height: ALTURA,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Escolha o que compartilhar',
      icon: ICONE,
      backgroundColor: COR_DE_FUNDO,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: join(__dirname, '..', 'preloads', 'preloadSeletorDeTela.js'),
      },
    });
    janela.setMenu(null);
    janela.webContents.on('will-navigate', (evento) => evento.preventDefault());
    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let concluido = false;
    const concluir = (escolha: EscolhaDeTela | null) => {
      if (concluido) return;
      concluido = true;
      ipcMain.removeListener('seletorDeTela:escolher', aoEscolher);
      ipcMain.removeListener('seletorDeTela:cancelar', aoCancelar);
      resolver(escolha);
      if (pai && !pai.isDestroyed()) pai.focus();
      if (!janela.isDestroyed()) janela.close();
    };
    const doProprioSeletor = (remetente: Electron.WebContents) => remetente === janela.webContents;
    const aoEscolher = (evento: Electron.IpcMainEvent, id: string, comAudio: boolean) => {
      if (!doProprioSeletor(evento.sender)) return;
      const fonte = fontes.find((candidata) => candidata.id === id);
      concluir(fonte ? { fonte, comAudio: oferecerAudio && comAudio } : null);
    };
    const aoCancelar = (evento: Electron.IpcMainEvent) => {
      if (doProprioSeletor(evento.sender)) concluir(null);
    };
    ipcMain.on('seletorDeTela:escolher', aoEscolher);
    ipcMain.on('seletorDeTela:cancelar', aoCancelar);

    janela.on('closed', () => concluir(null));
    janela.webContents.once('did-finish-load', () => {
      janela.webContents.send('seletorDeTela:mostrar', {
        fontes: fontes.map(paraATela),
        oferecerAudio,
      });
      janela.show();
    });
    void janela.loadFile(join(__dirname, '..', '..', 'telas', 'seletorDeTela.html'));
  });
}
