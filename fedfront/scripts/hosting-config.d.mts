export declare const SECURITY_HEADERS: Record<string, string>;
export declare function inlineScriptHashes(htmlPages: string[]): string[];
export declare function syncOrigin(syncUrl: string | undefined): string | null;
export declare const FIRESTORE_ORIGIN: string;
export declare function isCloudMode(env?: Record<string, string | undefined>): boolean;
export declare function assertPublicBuild(env?: Record<string, string | undefined>): void;
export declare function contentSecurityPolicy(hashes: string[], extraConnect?: string[]): string;
export declare function routeOf(htmlFile: string): string | null;
export declare function buildHostingConfig(
  pages: { file: string; html: string }[],
  env?: Record<string, string | undefined>,
): {
  hosting: {
    public: string;
    cleanUrls: boolean;
    trailingSlash: boolean;
    ignore: string[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};
