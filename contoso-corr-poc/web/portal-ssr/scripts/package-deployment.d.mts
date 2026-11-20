export function packageDeployment(options?: {
  profile?: "microsoft-distro" | "spa-only";
  outputRoot?: string;
  buildRoot?: string;
}): Promise<{ artifactRoot: string }>;
export function validatePortalBuild(root: string): Promise<{ files: number; entries: ReadonlyMap<string, Uint8Array> }>;
export function validateSpaRuntimeLock(
  source: { name: string; dependencies: Record<string, string> },
  lock: { lockfileVersion: number; packages: Record<string, {
    name?: string; version?: string; resolved?: string; integrity?: string;
    dependencies?: Record<string, string>; dev?: boolean; link?: boolean;
  }> }
): void;
export function validateBrowserDependency(
  manifest: { version: string },
  lock: { packages: Record<string, { version?: string; integrity?: string }> },
  location: string
): void;
