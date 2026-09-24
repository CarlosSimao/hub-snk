/**
 * Em desenvolvimento (`npm run app`) o shell ganha outro nome, e com ele outro perfil
 * (`userData`) e outra trava de instância única. Sem isto, ele dividiria o cofre, os
 * cookies e as guias com o HUB SNK instalado, e fecharia na hora se o instalado
 * estivesse aberto.
 *
 * Precisa ser o primeiro import do `main.ts`: o cofre e o log resolvem o caminho do
 * `userData` quando são carregados.
 */
import { app } from 'electron';

const NOME_EM_DESENVOLVIMENTO = 'HUB SNK (desenvolvimento)';

if (!app.isPackaged) {
  app.setName(NOME_EM_DESENVOLVIMENTO);
}
