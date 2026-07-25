import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'

// Ponto de entrada do bundle do Remotion. O @remotion/bundler parte daqui; o
// app Electron nunca importa este arquivo.
registerRoot(RemotionRoot)
