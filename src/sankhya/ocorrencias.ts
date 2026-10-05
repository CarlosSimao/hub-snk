/**
 * Ocorrência de agenda do ERP corporativo (`AD_OCOAGE`): ausência do consultor que a
 * Agenda de Recursos mostra (férias, folga, atestado...). A gravação vai pelo shell
 * desktop, dentro da janela oculta logada — ver `desktop/src/ocorrencias.ts` e
 * docs/specs/ocorrencia-agenda-erp.md.
 *
 * Aqui só o que não depende do ERP: a lista de motivos e a conversão das datas da tela
 * (`YYYY-MM-DDTHH:mm`, do `<input type="datetime-local">`) para o formato do Sankhya.
 */

/** Opções do campo `AD_OCOAGE.MOTIVO` (TDDOPC), lidas do dicionário em 2026-10-01. */
export const MOTIVOS_OCORRENCIA: { valor: string; rotulo: string }[] = [
  { valor: '0', rotulo: 'Férias' },
  { valor: '1', rotulo: 'Treinamento' },
  { valor: '2', rotulo: 'Workshop' },
  { valor: '3', rotulo: 'Atestado Médico' },
  { valor: '4', rotulo: 'Exame Médico' },
  { valor: '5', rotulo: 'Atrasos' },
  { valor: '6', rotulo: 'Finalização Antecipada Agenda' },
  { valor: '7', rotulo: 'Saída Antecipada' },
  { valor: '8', rotulo: 'Folga' },
  { valor: '9', rotulo: 'Folga Eleitoral' },
  { valor: '10', rotulo: 'Day Off' },
  { valor: '11', rotulo: 'Compensação Bco Horas' },
  { valor: '12', rotulo: 'Licença Paternidade' },
  { valor: '13', rotulo: 'Licença Maternidade' },
  { valor: '14', rotulo: 'Traslado' },
  { valor: '15', rotulo: 'Serviços Gerais' },
  { valor: '16', rotulo: 'Licença Luto' },
  { valor: '17', rotulo: 'Licença Casamento' },
  { valor: '18', rotulo: 'Feriado' },
];

/** O que o botão "Criar ocorrência" do ERP recebe — sem usuário: vale o da sessão. */
export interface NovaOcorrencia {
  /** `dd/MM/yyyy HH:mm:ss`. */
  dtInicial: string;
  dtFinal: string;
  motivo: string;
}

/** `YYYY-MM-DDTHH:mm[:ss]` -> `dd/MM/yyyy HH:mm:ss`; vazio se não casar. */
export function paraDataHoraSankhya(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] ?? '00'}` : '';
}

/** Valida o corpo da tela e converte para o que o botão do ERP espera. */
export function validarNovaOcorrencia(
  corpo: { inicio?: unknown; fim?: unknown; motivo?: unknown } | undefined,
): { ok: true; ocorrencia: NovaOcorrencia } | { ok: false; erro: string } {
  const inicio = String(corpo?.inicio ?? '');
  const fim = String(corpo?.fim ?? '');
  const dtInicial = paraDataHoraSankhya(inicio);
  const dtFinal = paraDataHoraSankhya(fim);
  if (!dtInicial || !dtFinal) {
    return { ok: false, erro: 'Informe a data e hora inicial e a final.' };
  }
  // Texto ISO compara na ordem cronológica.
  if (fim <= inicio) return { ok: false, erro: 'A data final tem que ser depois da inicial.' };
  const motivo = String(corpo?.motivo ?? '');
  if (!MOTIVOS_OCORRENCIA.some((m) => m.valor === motivo)) {
    return { ok: false, erro: 'Escolha um motivo da lista.' };
  }
  return { ok: true, ocorrencia: { dtInicial, dtFinal, motivo } };
}
