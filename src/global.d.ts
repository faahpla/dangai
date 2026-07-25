import type { DangaiBridge } from '@shared/channels'

declare global {
  interface Window {
    readonly dangai: DangaiBridge
  }
}

/** Vite e o webpack do Remotion resolvem fontes para uma URL. */
declare module '*.ttf' {
  const url: string
  export default url
}
