export type EngineModeName = 'device' | 'mock';
export declare const ENGINE_MODES: readonly EngineModeName[];
export declare function resolveEngineMode(
  env: Record<string, string | undefined>,
  opts: { production: boolean },
): EngineModeName;
