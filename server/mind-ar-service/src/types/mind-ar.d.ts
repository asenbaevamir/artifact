// Type shims for packages that ship without TypeScript declarations.
// This file is picked up automatically by tsc (it's in src/ which is included).

declare module 'mind-ar/src/image-target/offline-compiler.js' {
  import type { Image } from 'canvas';

  export class OfflineCompiler {
    compileImageTargets(
      images: Image[],
      progressCallback: (progress: number) => void
    ): Promise<unknown>;
    exportData(): Uint8Array;
  }
}

declare module 'mind-ar/src/image-target/compiler-base.js' {
  export class CompilerBase {
    data: unknown;
    compileImageTargets(images: unknown[], progressCallback: (progress: number) => void): Promise<unknown>;
    exportData(): Uint8Array;
    importData(buffer: ArrayBuffer): unknown[];
  }
}
