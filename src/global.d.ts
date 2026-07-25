import type { DangaiBridge } from '@shared/channels'

declare global {
  interface Window {
    readonly dangai: DangaiBridge
  }
}
