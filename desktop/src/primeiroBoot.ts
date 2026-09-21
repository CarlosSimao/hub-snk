/**
 * O que precisa existir na pasta do usuário antes de o backend subir — Fase 4 da
 * migração "sem Docker".
 *
 * Só há um item, e ele é a pendência conhecida do §4.1 do plano: o `services.yaml`. Ele
 * viaja dentro do pacote, e a pasta do pacote é substituída inteira a cada atualização.
 * Se o backend lesse o arquivo de lá, a primeira atualização apagaria os alvos que o
 * usuário cadastrou. A cópia acontece uma vez; depois dela o arquivo é do usuário, e o
 * do pacote passa a ser só o valor de fábrica.
 *
 * Idempotente de propósito: arquivo existente nunca é sobrescrito, nem quando o de
 * fábrica muda. Uma versão nova do produto pode trazer alvos novos no `services.yaml`,
 * e ainda assim quem decide adotá-los é quem editou o arquivo.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { app } from 'electron';
import { SERVICES_YAML, SERVICES_YAML_EMBUTIDO } from './config';
import { logEvento } from './log';

export function prepararArquivosDoUsuario(): void {
  // Em desenvolvimento os dois caminhos são o mesmo arquivo do repo — copiar seria
  // copiar por cima de si mesmo.
  if (!app.isPackaged || SERVICES_YAML === SERVICES_YAML_EMBUTIDO) return;

  if (existsSync(SERVICES_YAML)) return;

  if (!existsSync(SERVICES_YAML_EMBUTIDO)) {
    // Não é fatal: o backend trata config ausente e sobe sem alvos, que é melhor do que
    // não abrir. O log é o que explica um painel vazio na primeira execução.
    logEvento('services-yaml-embutido-ausente', { origem: SERVICES_YAML_EMBUTIDO });
    return;
  }

  try {
    mkdirSync(dirname(SERVICES_YAML), { recursive: true });
    copyFileSync(SERVICES_YAML_EMBUTIDO, SERVICES_YAML);
    logEvento('services-yaml-semeado', { origem: SERVICES_YAML_EMBUTIDO, destino: SERVICES_YAML });
  } catch (err) {
    logEvento('services-yaml-falhou', { erro: (err as Error).message, destino: SERVICES_YAML });
  }
}
