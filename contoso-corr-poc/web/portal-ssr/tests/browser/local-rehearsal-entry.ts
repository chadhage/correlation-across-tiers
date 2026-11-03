import "../../../storefront-spa/src/style.css";
import { createStorefront } from "../../../storefront-spa/src/app.js";
import { parsePublicConfig } from "../../src/shared/contracts.js";

declare global {
  interface Window {
    contosoLocalRehearsalToken?: () => Promise<string>;
    contosoLocalRehearsalClickReceipt?: () => { control: "contoso-run-demo"; trustedClicks: number };
  }
}

const element = document.getElementById("contoso-runtime-config");
if (!element?.textContent) throw new Error("LOCAL_REHEARSAL_CONFIG_MISSING");
const config = parsePublicConfig(JSON.parse(element.textContent) as unknown);
if (config.executionMode !== "local" || !["127.0.0.1", "[::1]"].includes(location.hostname)
  || !window.contosoLocalRehearsalToken) throw new Error("LOCAL_REHEARSAL_ONLY");

const runDemo = document.querySelector('[data-testid="contoso-run-demo"]');
if (!(runDemo instanceof HTMLButtonElement)) throw new Error("LOCAL_REHEARSAL_DEMO_CONTROL_MISSING");
let trustedClicks = 0;
runDemo.addEventListener("click", event => { if (event.isTrusted) trustedClicks++; });
Object.defineProperty(window, "contosoLocalRehearsalClickReceipt", {
  value: () => ({ control: "contoso-run-demo", trustedClicks }), writable: false, configurable: false
});

window.contosoDemos = createStorefront(config, {
  async initialize() {}, async signIn() {}, async signOut() {},
  signedIn() { return true; },
  async token() {
    if (!window.contosoLocalRehearsalToken) throw new Error("LOCAL_REHEARSAL_TOKEN_UNAVAILABLE");
    return window.contosoLocalRehearsalToken();
  }
}, true);
