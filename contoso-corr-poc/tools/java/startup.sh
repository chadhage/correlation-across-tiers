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
extension=agent/extensions/contoso-parent-safe-sampler-1.0.0.jar
extension_hash=08592fa4f8fea7b7d259efd2ea38753d9ddc0e9abed05c2e42b62d7bbf2218ce
[ "$(sha256sum "$extension" | cut -d ' ' -f 1)" = "$extension_hash" ] || { echo "GATE_02_EXTENSION_CHECKSUM" >&2; exit 2; }
export APPLICATIONINSIGHTS_ROLE_NAME="$CONTOSO_SERVICE_NAME"
export OTEL_SERVICE_NAME="$CONTOSO_SERVICE_NAME"
export APPLICATIONINSIGHTS_CONFIGURATION_FILE=/home/site/wwwroot/agent/applicationinsights.json
export APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED=false
export APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL=WARN
export JAVA_TOOL_OPTIONS="-javaagent:/home/site/wwwroot/agent/applicationinsights-agent-3.7.10.jar -Dotel.javaagent.extensions=/home/site/wwwroot/agent/extensions/contoso-parent-safe-sampler-1.0.0.jar"
exec java -Xms64m -Xmx"${CONTOSO_HEAP_MB:-384}"m -jar app.jar
