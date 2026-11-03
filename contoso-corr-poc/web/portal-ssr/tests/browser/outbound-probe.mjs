import { request } from "node:http";
import { trace } from "@opentelemetry/api";

export async function probeOutgoingBoundary(targets) {
  await trace.getTracer("contoso-frontend-loopback").startActiveSpan("Contoso fixture outbound boundary", async span => {
    try {
      for (const target of targets) {
        await new Promise((resolve, reject) => {
          const outgoing = request(target, response => { response.resume(); response.on("end", resolve); });
          outgoing.on("error", reject);
          outgoing.end();
        });
      }
    } finally { span.end(); }
  });
}
