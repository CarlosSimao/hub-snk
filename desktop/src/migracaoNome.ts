/**
 * Leva a pasta de dados junto quando o aplicativo muda de nome.
 *
 * O Electron deriva `userData` do nome do produto: renomeando "Sankhya Hub" para
 * "Development Hub", a pasta passou a ser outra, e o histórico, o cofre de credenciais e
 * o `services.yaml` do usuário ficariam para trás sem nenhum aviso — o app abriria
 * "vazio" e pareceria perda de dados.
 *
 * Renomear a pasta (e não copiar) é de propósito: instantâneo, sem duplicar segredo no
 * disco e sem deixar uma cópia velha para alguém achar depois.
 *
 * Roda uma vez. Se a pasta nova já existe, não há o que migrar — inclusive porque uma
 * segunda migração sobrescreveria dados novos com dados antigos.
 */
import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { logEvento } from './log';

/** Nomes que o aplicativo já teve, do mais recente para o mais antigo. */
const NOMES_ANTERIORES = ['Development Hub', 'Sankhya Hub', 'sankhya-hub-desktop'];

export function migrarPastaDeDados(): void {
  const atual = app.getPath('userData');
  if (existsSync(atual)) return;

  const raiz = dirname(atual);
  for (const nome of NOMES_ANTERIORES) {
    const anterior = join(raiz, nome);
    if (anterior === atual || !existsSync(anterior)) continue;

    try {
      renameSync(anterior, atual);
      logEvento('userdata-migrado', { de: nome, para: atual });
      return;
    } catch (err) {
      // Pasta em uso por outra instância, ou permissão: o app segue com pasta nova e
      // vazia, que é ruim, mas não é motivo para não abrir.
      logEvento('userdata-migracao-falhou', { de: nome, erro: (err as Error).message });
      return;
    }
  }
}
