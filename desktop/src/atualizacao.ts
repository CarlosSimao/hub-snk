/**
 * Atualização automática do aplicativo, pelas releases do GitHub (`electron-updater`).
 *
 * Consulta pouco depois de abrir e a cada 6 h, baixa em segundo plano e oferece
 * "Reiniciar para atualizar" (notificação e menu Ajuda). Quem sai sem reiniciar recebe
 * a versão nova na saída, em silêncio. Desligada no menu Ajuda, nada é consultado nem
 * baixado: fica só o aviso de versão nova do Painel, que vem do backend.
 *
 * Só no aplicativo empacotado: em desenvolvimento não há instalador para trocar.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Notification, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ICONE } from './config';
import { logEvento } from './log';

/** Sem disputar rede e processador com o Painel e o login automático. */
const ESPERA_PARA_A_PRIMEIRA_CONSULTA_MS = 30_000;
const INTERVALO_ENTRE_CONSULTAS_MS = 6 * 60 * 60 * 1000;

let ligada: boolean | null = null;
let versaoPronta: string | null = null;
let temporizadores: NodeJS.Timeout[] = [];
let aoMudar: () => void = () => {};
/** Referência forte: sem ela o coletor de lixo pode levar a notificação e o clique nela. */
let notificacao: Notification | null = null;

function arquivoDaPreferencia(): string {
  return join(app.getPath('userData'), 'atualizacao.json');
}

function lerPreferencia(): boolean {
  try {
    const dados = JSON.parse(readFileSync(arquivoDaPreferencia(), 'utf8')) as {
      automatica?: unknown;
    };
    return dados.automatica !== false;
  } catch {
    // Primeira execução, ou arquivo corrompido: ligada, que é o padrão.
    return true;
  }
}

function gravarPreferencia(valor: boolean): void {
  try {
    writeFileSync(arquivoDaPreferencia(), JSON.stringify({ automatica: valor }, null, 2), 'utf8');
  } catch (err) {
    // A sessão atual respeita a escolha; a próxima abre com o padrão.
    logEvento('atualizacao-preferencia-nao-gravada', { erro: (err as Error).message });
  }
}

export function atualizacaoAutomaticaLigada(): boolean {
  ligada ??= lerPreferencia();
  return ligada;
}

/** Versão já baixada e pronta para instalar, ou `null`. */
export function versaoProntaParaInstalar(): string | null {
  return atualizacaoAutomaticaLigada() ? versaoPronta : null;
}

function consultar(): void {
  autoUpdater.checkForUpdates().catch((err: Error) => {
    logEvento('atualizacao-consulta-falhou', { erro: err.message });
  });
}

function iniciarConsultas(): void {
  temporizadores = [
    setTimeout(consultar, ESPERA_PARA_A_PRIMEIRA_CONSULTA_MS),
    setInterval(consultar, INTERVALO_ENTRE_CONSULTAS_MS),
  ];
}

function pararConsultas(): void {
  for (const temporizador of temporizadores) clearTimeout(temporizador);
  temporizadores = [];
}

function avisarVersaoPronta(versao: string): void {
  if (!Notification.isSupported()) return;
  notificacao = new Notification({
    title: `Versão ${versao} pronta`,
    body: 'Clique para reiniciar o HUB SNK e atualizar.',
    icon: ICONE,
  });
  notificacao.on('click', () => reiniciarParaAtualizar());
  notificacao.on('close', () => (notificacao = null));
  notificacao.show();
}

/**
 * Silencioso e abrindo o programa de novo no fim. O fechamento normal (`before-quit` do
 * `main.ts`) para o backend antes, o que o instalador precisa para trocar os arquivos.
 */
export function reiniciarParaAtualizar(): void {
  if (!versaoProntaParaInstalar()) return;
  logEvento('atualizacao-reiniciar', { versao: versaoPronta });
  autoUpdater.quitAndInstall(true, true);
}

function registrarEventos(): void {
  autoUpdater.on('update-available', ({ version }) => {
    logEvento('atualizacao-disponivel', { versao: version });
  });
  autoUpdater.on('update-downloaded', ({ version }) => {
    logEvento('atualizacao-baixada', { versao: version });
    versaoPronta = version;
    aoMudar();
    avisarVersaoPronta(version);
  });
  autoUpdater.on('error', (err) => {
    logEvento('atualizacao-falhou', { erro: err.message });
  });
}

/** @param quandoMudar Chamado quando uma versão fica pronta: o menu passa a oferecê-la. */
export function iniciarAtualizacaoAutomatica(quandoMudar: () => void): void {
  if (!app.isPackaged) return;
  aoMudar = quandoMudar;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = atualizacaoAutomaticaLigada();
  registrarEventos();
  if (atualizacaoAutomaticaLigada()) iniciarConsultas();
}

/**
 * Desligar também cancela a instalação na saída de uma versão já baixada: quem
 * desligou não quer ser atualizado.
 */
export function alternarAtualizacaoAutomatica(): void {
  ligada = !atualizacaoAutomaticaLigada();
  gravarPreferencia(ligada);
  logEvento(ligada ? 'atualizacao-ligada' : 'atualizacao-desligada');
  if (!app.isPackaged) return;
  autoUpdater.autoInstallOnAppQuit = ligada;
  if (ligada) {
    iniciarConsultas();
  } else {
    pararConsultas();
  }
  aoMudar();
}
