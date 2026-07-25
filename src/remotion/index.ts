import { registerRoot } from 'remotion'
// A fonte das legendas precisa estar DENTRO do bundle do Remotion: o webpack
// dele e separado do Vite do app, entao nao herda nada do renderer. Empacotada
// aqui, o render funciona offline e sem depender de fonte instalada no sistema.
import '@fontsource-variable/inter'
import { RemotionRoot } from './Root'

// Ponto de entrada do bundle do Remotion. O @remotion/bundler parte daqui; o
// app Electron nunca importa este arquivo.
registerRoot(RemotionRoot)
