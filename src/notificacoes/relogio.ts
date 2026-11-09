/**
 * Datas no fuso da máquina. A agenda do Sankhya e os lembretes falam do horário local
 * do usuário, e o backend roda na mesma máquina que ele — não há fuso a converter.
 */

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** `YYYY-MM-DD` do dia local. */
export function dataIsoLocal(data: Date): string {
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

/** `HH:mm` local. */
export function horaLocal(data: Date): string {
  return `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
}

/** `DD/MM/YYYY HH:mm` local, para mensagens. */
export function dataHoraLocal(data: Date): string {
  const dia = `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}`;
  return `${dia} ${horaLocal(data)}`;
}

/** `YYYY-MM-DD HH:mm:ss` da agenda, lido como horário local. */
export function lerDataHoraDaAgenda(texto: string): Date {
  return new Date(texto.replace(' ', 'T'));
}

const DOMINGO = 0;
const SABADO = 6;

/**
 * Dia útil seguinte a `dia` (`YYYY-MM-DD`): pula só sábado e domingo — o HUB SNK não tem
 * calendário de feriados. Meio-dia local evita que a troca do horário de verão mude a data.
 */
export function proximoDiaUtil(dia: string): string {
  return diaUtilVizinho(dia, 1);
}

/** Dia útil anterior a `dia`, com a mesma regra do `proximoDiaUtil`. */
export function diaUtilAnterior(dia: string): string {
  return diaUtilVizinho(dia, -1);
}

function diaUtilVizinho(dia: string, passo: 1 | -1): string {
  const data = new Date(`${dia}T12:00:00`);
  do {
    data.setDate(data.getDate() + passo);
  } while (data.getDay() === DOMINGO || data.getDay() === SABADO);
  return dataIsoLocal(data);
}

/** Dia de calendário seguinte a `dia`, fim de semana incluído. */
export function diaSeguinte(dia: string): string {
  const data = new Date(`${dia}T12:00:00`);
  data.setDate(data.getDate() + 1);
  return dataIsoLocal(data);
}

/** Quantos dias úteis vão de `de` (exclusive) a `ate` (inclusive): sexta → segunda é 1. */
export function diasUteisEntre(de: string, ate: string): number {
  let quantidade = 0;
  for (let dia = proximoDiaUtil(de); dia <= ate; dia = proximoDiaUtil(dia)) {
    quantidade += 1;
  }
  return quantidade;
}

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60_000;

/** Dias corridos de `de` a `ate`: sexta → segunda são 3. Em UTC, sem horário de verão. */
export function diasEntre(de: string, ate: string): number {
  const emUtc = (dia: string) => Date.parse(`${dia}T00:00:00Z`);
  return Math.round((emUtc(ate) - emUtc(de)) / MILISSEGUNDOS_POR_DIA);
}
