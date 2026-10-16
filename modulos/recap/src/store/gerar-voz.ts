import { create } from 'zustand'

/**
 * [recap] O PASSO 3 (Voz) chega na parte 2. Ate la, so o que as telas dos
 * passos 1 e 2 perguntam a ele: nenhuma voz sendo gerada. Na parte 2 este
 * arquivo vira o gerar-voz.ts do Studio.
 */
export const useVoz = create<{ pedido: null; erro: string | null }>(() => ({ pedido: null, erro: null }))
