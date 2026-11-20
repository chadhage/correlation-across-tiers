if (process.env.CONTOSO_NODE_TELEMETRY_PROFILE && process.env.CONTOSO_NODE_TELEMETRY_PROFILE !== "spa-only")
  throw new Error("CONFIG_INVALID");
process.env.CONTOSO_NODE_TELEMETRY_PROFILE = "spa-only";
await import("./bootstrap.js");
