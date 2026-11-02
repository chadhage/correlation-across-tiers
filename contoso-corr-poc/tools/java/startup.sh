#!/usr/bin/env sh
set -eu
: "${CONTOSO_SERVICE_NAME:?service name required}"
: "${APPLICATIONINSIGHTS_CONNECTION_STRING:?Key Vault reference must resolve}"
if [ -n "${JDK_JAVA_OPTIONS-}" ] || [ -n "${_JAVA_OPTIONS-}" ]; then
  echo "GATE_02_UNAPPROVED_LAUNCHER_OPTIONS" >&2
  exit 2
fi
unset JDK_JAVA_OPTIONS _JAVA_OPTIONS
case "${JAVA_OPTS-} ${JAVA_TOOL_OPTIONS-}" in *javaagent*) echo "GATE_02_DUPLICATE_AGENT" >&2; exit 2;; esac
cd /home/site/wwwroot
expected=93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec
actual=$(sha256sum agent/applicationinsights-agent-3.7.10.jar | cut -d ' ' -f 1)
[ "$actual" = "$expected" ] || { echo "GATE_02_AGENT_CHECKSUM" >&2; exit 2; }
extension=agent/extensions/contoso-parent-safe-sampler-1.1.0.jar
extension_hash=bb829be676bdc86e9a0657391764a419c7665c47542c2e53f64c37761f45193f
[ "$(sha256sum "$extension" | cut -d ' ' -f 1)" = "$extension_hash" ] || { echo "GATE_02_EXTENSION_CHECKSUM" >&2; exit 2; }
export APPLICATIONINSIGHTS_ROLE_NAME="$CONTOSO_SERVICE_NAME"
export OTEL_SERVICE_NAME="$CONTOSO_SERVICE_NAME"
export APPLICATIONINSIGHTS_CONFIGURATION_FILE=/home/site/wwwroot/agent/applicationinsights.json
export APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED=false
export APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL=WARN
export APPLICATIONINSIGHTS_ENABLE_AGENT=false
export JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY=false
export INITIALIZED_FROM_PLACEHOLDER=false
native_suppression="-Dotel.instrumentation.jdbc.enabled=false -Dotel.instrumentation.jdbc-datasource.enabled=false -Dotel.instrumentation.lettuce.enabled=false -Dotel.instrumentation.jedis.enabled=false -Dotel.instrumentation.redisson.enabled=false -Dotel.instrumentation.azure-core.enabled=false -Dotel.instrumentation.ai-azure-functions.enabled=false"
export JAVA_TOOL_OPTIONS="-javaagent:/home/site/wwwroot/agent/applicationinsights-agent-3.7.10.jar -Dotel.javaagent.extensions=/home/site/wwwroot/agent/extensions/contoso-parent-safe-sampler-1.1.0.jar $native_suppression"
exec java -Xms64m -Xmx"${CONTOSO_HEAP_MB:-384}"m -jar app.jar
