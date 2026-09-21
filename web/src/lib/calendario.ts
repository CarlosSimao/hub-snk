/**
 * A regra de atraso mora em `src/calendario.ts`, fora de `web/`, porque o resumo diario
 * por e-mail precisa exatamente dela — e o comentario original ja avisava: uma segunda
 * implementacao do outro lado sairia do ar com a primeira na proxima vez que um valor
 * de `accepted_os_status` nos surpreendesse.
 *
 * Reexportado daqui para os componentes nao carregarem o caminho para fora de `web/`,
 * mesmo motivo de `web/src/types.ts`.
 */
export * from '../../../src/calendario.ts';
