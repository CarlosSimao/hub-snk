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
