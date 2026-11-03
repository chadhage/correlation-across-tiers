import "./style.css";
import { ContosoError, parsePublicConfig, safeErrorCode } from "../../portal-ssr/src/shared/contracts.js";
import { createContosoAuth } from "./auth.js";
import { createStorefront } from "./app.js";

try {
  const node = document.getElementById("contoso-runtime-config");
  if (!node?.textContent || node.textContent.length > 65536) throw new ContosoError("CONFIG_UNAVAILABLE");
  const raw: unknown = JSON.parse(node.textContent);
  const config = parsePublicConfig(raw);
  if (config.executionMode === "fixture") throw new ContosoError("FIXTURE_CONFIG_REJECTED");
  window.contosoDemos = createStorefront(config, createContosoAuth(config));
} catch (error: unknown) {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.textContent = `Contoso startup unavailable: ${safeErrorCode(error, "CONFIG_INVALID")}. Ask the operator to configure the runtime environment; no raw configuration was logged.`;
    banner.hidden = false;
  }
}
