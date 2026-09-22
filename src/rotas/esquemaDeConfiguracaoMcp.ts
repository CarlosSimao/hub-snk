import { z } from 'zod';

/**
 * Validação do corpo enviado para gravar o `.sankhya-mcp.env`.
 *
 * Fica fora dos arquivos de rota porque o mesmo arquivo é gravado a partir de
 * dois cadastros diferentes — repositório de cliente e base local.
 */
const TAMANHO_MAXIMO_DO_HOST = 200;
const TAMANHO_MAXIMO_DO_SERVICO = 200;
const TAMANHO_MAXIMO_DO_USUARIO = 120;
const TAMANHO_MAXIMO_DA_SENHA = 200;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;

export const esquemaDeConfiguracaoMcp = z.object({
  SANKHYA_DB_HOST: z
    .string()
    .trim()
    .min(1, 'Informe o SANKHYA_DB_HOST.')
    .max(TAMANHO_MAXIMO_DO_HOST),
  SANKHYA_DB_PORT: z.coerce
    .number({ error: 'O SANKHYA_DB_PORT deve ser um número.' })
    .int('O SANKHYA_DB_PORT deve ser um número inteiro.')
    .min(PORTA_MINIMA, `O SANKHYA_DB_PORT deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`)
    .max(PORTA_MAXIMA, `O SANKHYA_DB_PORT deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`),
  SANKHYA_DB_SERVICE_NAME: z
    .string()
    .trim()
    .min(1, 'Informe o SANKHYA_DB_SERVICE_NAME.')
    .max(TAMANHO_MAXIMO_DO_SERVICO),
  SANKHYA_DB_USER: z
    .string()
    .trim()
    .min(1, 'Informe o SANKHYA_DB_USER.')
    .max(TAMANHO_MAXIMO_DO_USUARIO),
  SANKHYA_DB_PASSWORD: z
    .string()
    .min(1, 'Informe o SANKHYA_DB_PASSWORD.')
    .max(TAMANHO_MAXIMO_DA_SENHA),
});

export type DadosDeConfiguracaoMcp = z.infer<typeof esquemaDeConfiguracaoMcp>;
