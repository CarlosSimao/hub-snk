import { z } from 'zod';
import { SEGURANCAS_SMTP } from '../tipos.ts';

/**
 * Validação do SMTP e do alerta da agenda.
 *
 * Fica fora dos arquivos de rota porque o SMTP chega por dois caminhos: gravado com o
 * resto da configuração e mandado sem gravar, para o e-mail de teste.
 */
const TAMANHO_MAXIMO_DO_HOST = 200;
const TAMANHO_MAXIMO_DO_USUARIO = 200;
const TAMANHO_MAXIMO_DA_SENHA = 200;
const TAMANHO_MAXIMO_DO_ENDERECO = 320;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;
const TOLERANCIA_MINIMA_MIN = 0;
const TOLERANCIA_MAXIMA_MIN = 720;

/* Vazio é aceito: SMTP sem host é o e-mail desligado, e não um erro de cadastro. */
const esquemaDeEnderecoOpcional = z
  .string()
  .trim()
  .max(TAMANHO_MAXIMO_DO_ENDERECO, 'O e-mail está longo demais.')
  .refine((valor) => valor === '' || z.email().safeParse(valor).success, 'E-mail inválido.');

export const esquemaDeSmtp = z.object({
  host: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DO_HOST, `O host deve ter no máximo ${TAMANHO_MAXIMO_DO_HOST} caracteres.`),
  porta: z.coerce
    .number({ error: 'A porta do SMTP deve ser um número.' })
    .int('A porta do SMTP deve ser um número inteiro.')
    .min(PORTA_MINIMA, `A porta do SMTP deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`)
    .max(PORTA_MAXIMA, `A porta do SMTP deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`),
  seguranca: z.enum(SEGURANCAS_SMTP, { error: 'Escolha a segurança do SMTP.' }),
  usuario: z.string().trim().max(TAMANHO_MAXIMO_DO_USUARIO, 'O usuário do SMTP está longo demais.'),
  senha: z.string().max(TAMANHO_MAXIMO_DA_SENHA, 'A senha do SMTP está longa demais.'),
  remetente: esquemaDeEnderecoOpcional,
  destinatario: esquemaDeEnderecoOpcional,
});

export const esquemaDeAlertaDaAgenda = z.object({
  ativo: z.boolean({ error: 'Informe se o alerta da agenda está ligado.' }),
  toleranciaMinutos: z.coerce
    .number({ error: 'A tolerância deve ser um número.' })
    .int('A tolerância deve ser um número inteiro de minutos.')
    .min(TOLERANCIA_MINIMA_MIN, 'A tolerância não pode ser negativa.')
    .max(
      TOLERANCIA_MAXIMA_MIN,
      `A tolerância deve ser de no máximo ${TOLERANCIA_MAXIMA_MIN} minutos.`,
    ),
  enviarEmail: z.boolean({ error: 'Informe se o alerta da agenda envia e-mail.' }),
});
