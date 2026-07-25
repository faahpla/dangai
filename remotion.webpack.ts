import type { WebpackOverrideFn } from '@remotion/bundler'

/**
 * O webpack do Remotion e independente do Vite, entao ele nao herda os aliases
 * do electron.vite.config.ts. A composicao importa tipos e constantes de
 * @shared/contract, logo o alias precisa existir dos dois lados.
 *
 * Recebe o caminho por parametro porque quem chama sabe onde `shared/` esta: a
 * CLI resolve pela raiz do projeto, o processo main pela app path.
 */
export function makeWebpackOverride(sharedDir: string): WebpackOverrideFn {
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        '@shared': sharedDir,
      },
    },
  })
}
