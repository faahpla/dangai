import type { ModuloDoMain } from '../../../electron/modulos'
import { CONFIG_DA_THUMB_PADRAO, configDaThumbSchema, presetDaThumbSchema, type ConfigDaThumb } from '../shared/pedidos'
import { guardarContexto } from './contexto'
import { registrarCanais } from './ipc'
import { motorDeRostos } from './motor'

/**
 * [thumb] O MODULO THUMBNAIL no main (pedido do Levi, 30/10): o editor da
 * capa 1080x1920 que ja existia na tela "Video pronto" do recap, como modulo
 * proprio, para quem usa o Dangai sem o recap. O editor e o mesmo
 * (editor.ts, shared/thumb.ts); aqui so os canais `thumb:` (ipc.ts), a config
 * (o ultimo preset do editor solto) e o motor de rostos que o recap empresta
 * (motor.ts).
 *
 * Desligado por padrao (Configuracoes > Modulos). O `configurar` so guarda o
 * contexto; nada sobe sozinho -- o motor de rostos so roda a pedido da tela.
 */

function encerrarMotor(): void {
  try {
    motorDeRostos()?.encerrar()
  } catch (e) {
    console.error('[thumb] encerrar o motor de rostos:', e)
  }
}

export const thumb: ModuloDoMain = {
  id: 'thumb',
  nome: 'Thumbnail',
  descricao: 'A capa 1080x1920 do short (o editor do recap), com imagens do PC ou os quadros limpos de um projeto.',
  beta: true,
  config: {
    padrao: CONFIG_DA_THUMB_PADRAO,
    coerce: (raw) => configDaThumbSchema.parse(raw),
    paraRenderer: (c) => c,
    validarPatch: (patch, atual) => {
      const p = patch as { preset?: unknown }
      return configDaThumbSchema.parse({ ...(atual as ConfigDaThumb), preset: presetDaThumbSchema.nullable().parse(p.preset ?? null) })
    },
  },

  configurar(ctx) {
    guardarContexto(ctx)
  },

  registrarIpc(ctx) {
    registrarCanais(ctx)
  },

  // A saida do app com o recap desligado: o lote de rostos que a thumb pediu nao
  // fica orfao (desligar a thumb nao mata nada: o mesmo motor pode estar com o recap).
  async antesDeSair() {
    encerrarMotor()
  },
}
