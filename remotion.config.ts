import { resolve } from 'node:path'
import { Config } from '@remotion/cli/config'
import { makeWebpackOverride } from './remotion.webpack'

// Lido pela CLI do Remotion (`npm run remotion:bundle`). O processo main aplica
// o mesmo override ao chamar bundle() -- ver electron/services/render.ts.
//
// process.cwd() e nao __dirname: a CLI avalia este arquivo com __dirname
// apontando para o proprio pacote dela, nao para a raiz do projeto.
Config.overrideWebpackConfig(makeWebpackOverride(resolve(process.cwd(), 'shared')))
