/**
 * Atalho global da busca rápida, que a bandeja liga e desliga.
 *
 * Global quer dizer que o Windows entrega a tecla ao HUB SNK com qualquer programa em foco
 * — e a tira do outro programa que também a usa. Por isso dá para desligar, e a escolha
 * fica gravada para valer nas próximas aberturas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, globalShortcut } from 'electron';
import { ATALHO_GLOBAL_DA_BUSCA } from './buscaRapida';
import { logEvento } from './log';

/** `recusado`: ligado, mas o Windows não o entregou — outro programa já tem a combinação. */
export type SituacaoDoAtalhoGlobal = 'ativo' | 'desligado' | 'recusado';

function arquivoDoAtalhoGlobal(): string {
  return join(app.getPath('userData'), 'atalho-global.json');
}

function lerLigado(): boolean {
  try {
    const dados = JSON.parse(readFileSync(arquivoDoAtalhoGlobal(), 'utf8')) as { ligado?: unknown };
    return dados.ligado !== false;
  } catch {
    // Primeira execução, ou arquivo corrompido: ligado, que é como o app vem.
    return true;
  }
}

function gravarLigado(ligado: boolean): void {
  try {
    writeFileSync(arquivoDoAtalhoGlobal(), JSON.stringify({ ligado }, null, 2), 'utf8');
  } catch (erro) {
    // A sessão atual respeita a escolha; a próxima abre com o atalho ligado.
    logEvento('atalho-global-nao-gravado', { erro: (erro as Error).message });
  }
}

export class AtalhoGlobalDaBusca {
  readonly #aoAcionar: () => void;
  #ligado = true;
  #registrado = false;

  constructor(aoAcionar: () => void) {
    this.#aoAcionar = aoAcionar;
  }

  get situacao(): SituacaoDoAtalhoGlobal {
    if (!this.#ligado) return 'desligado';
    return this.#registrado ? 'ativo' : 'recusado';
  }

  /** Aplica a escolha gravada. Chamado uma vez, com o app pronto. */
  aplicarEscolhaGravada(): void {
    this.#ligado = lerLigado();
    if (this.#ligado) this.#registrar();
  }

  /** Ligar de novo também tenta de novo: o programa que tinha a combinação pode ter saído. */
  definirLigado(ligado: boolean): void {
    this.#ligado = ligado;
    gravarLigado(ligado);
    if (ligado) {
      this.#registrar();
    } else {
      this.#liberar();
    }
    logEvento('atalho-global-alterado', { situacao: this.situacao });
  }

  #registrar(): void {
    if (this.#registrado) return;
    this.#registrado = globalShortcut.register(ATALHO_GLOBAL_DA_BUSCA, this.#aoAcionar);
    if (!this.#registrado) logEvento('atalho-global-recusado', { atalho: ATALHO_GLOBAL_DA_BUSCA });
  }

  #liberar(): void {
    if (!this.#registrado) return;
    globalShortcut.unregister(ATALHO_GLOBAL_DA_BUSCA);
    this.#registrado = false;
  }
}
