import {
  BrowserCacheLocation, InteractionRequiredAuthError, LogLevel, PublicClientApplication
} from "@azure/msal-browser";
import { ContosoError, type ContosoPublicRuntimeConfigV1 } from "../../portal-ssr/src/shared/contracts.js";

export interface ContosoAuth {
  initialize(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  token(): Promise<string>;
  signedIn(): boolean;
}
export function createContosoAuth(config: ContosoPublicRuntimeConfigV1): ContosoAuth {
  const client = new PublicClientApplication({
    auth: {
      clientId: config.identity.spaClientId,
      authority: `https://login.microsoftonline.com/${config.identity.tenantId}`,
      redirectUri: config.identity.spaRedirectUri,
      postLogoutRedirectUri: config.identity.postLogoutRedirectUri
    },
    cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
    system: {
      loggerOptions: { logLevel: LogLevel.Error, piiLoggingEnabled: false, loggerCallback: () => undefined }
    }
  });
  const scopes = [...config.identity.scopes];
  return {
    async initialize() {
      try {
        await client.initialize();
        const result = await client.handleRedirectPromise();
        const account = result?.account ?? client.getAllAccounts()[0] ?? null;
        if (account) client.setActiveAccount(account);
      } catch { throw new ContosoError("AUTH_FAILED", 401); }
    },
    async signIn() {
      try { await client.loginRedirect({ scopes, redirectUri: config.identity.spaRedirectUri }); }
      catch { throw new ContosoError("AUTH_FAILED", 401); }
    },
    async signOut() {
      try { await client.logoutRedirect({ postLogoutRedirectUri: config.identity.postLogoutRedirectUri }); }
      catch { throw new ContosoError("AUTH_FAILED", 401); }
    },
    async token() {
      const account = client.getActiveAccount();
      if (!account) throw new ContosoError("AUTH_REQUIRED", 401);
      try {
        const response = await client.acquireTokenSilent({ account, scopes });
        return response.accessToken;
      } catch (error: unknown) {
        if (error instanceof InteractionRequiredAuthError) throw new ContosoError("AUTH_INTERACTION_REQUIRED", 401);
        throw new ContosoError("AUTH_FAILED", 401);
      }
    },
    signedIn() { return client.getActiveAccount() !== null; }
  };
}
