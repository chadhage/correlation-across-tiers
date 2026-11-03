export function packageDeployment(): Promise<{ artifactRoot: string }>;
export function validatePortalBuild(root: string): Promise<{ files: number; entries: ReadonlyMap<string, Uint8Array> }>;
