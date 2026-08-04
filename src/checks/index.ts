/**
 * Ponto unico de despacho por tipo de check.
 *
 * Para criar um tipo novo: adicione a variante em `config.ts`, escreva o modulo que
 * devolve `CheckOutcome` e registre no switch abaixo. Nada mais no hub precisa mudar.
 */
import type { CheckConfig } from '../config.ts';
import type { DockerClient } from '../docker.ts';
import type { CheckOutcome } from '../types.ts';
import { runHttpCheck } from './http.ts';
import { runTcpCheck } from './tcp.ts';
import { runOracleCheck } from './oracle.ts';
import { runDockerCheck } from './dockerContainer.ts';

export interface CheckContext {
  docker: DockerClient;
}

export async function runCheck(cfg: CheckConfig, ctx: CheckContext): Promise<CheckOutcome> {
  switch (cfg.type) {
    case 'http':
      return runHttpCheck(cfg);
    case 'tcp':
      return runTcpCheck(cfg);
    case 'oracle':
      return runOracleCheck(cfg);
    case 'docker':
      return runDockerCheck(cfg, ctx.docker);
  }
}
