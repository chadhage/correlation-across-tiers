#!/usr/bin/env sh
set -eu
[ "$#" -eq 2 ] && [ "$1" = "--source" ] || { echo "INVALID_REPLAY_ARGUMENTS" >&2; exit 2; }
case "$2" in
  NOTIFY_DLQ) role=contoso-notify-worker ;;
  ORDERS_DLQ|FULFILLMENT_DLQ|LEGACY_POISON) role=contoso-fulfillment-worker ;;
  *) echo "INVALID_REPLAY_SOURCE" >&2; exit 2 ;;
esac
[ -z "${JDK_JAVA_OPTIONS-}" ] && [ -z "${_JAVA_OPTIONS-}" ] || { echo "GATE_02_UNAPPROVED_LAUNCHER_OPTIONS" >&2; exit 2; }
case "${JAVA_OPTS-} ${JAVA_TOOL_OPTIONS-}" in *javaagent*) echo "GATE_02_DUPLICATE_AGENT" >&2; exit 2;; esac
unset JDK_JAVA_OPTIONS _JAVA_OPTIONS
cd "$(dirname "$0")"
export APPLICATIONINSIGHTS_ROLE_NAME="$role"
export OTEL_SERVICE_NAME="$role"
export APPLICATIONINSIGHTS_CONFIGURATION_FILE="$(pwd)/agent/applicationinsights.json"
export APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED=false
export APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED=false
export APPLICATIONINSIGHTS_ENABLE_AGENT=false
export JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY=false
export INITIALIZED_FROM_PLACEHOLDER=false
export JAVA_TOOL_OPTIONS="-javaagent:$(pwd)/agent/applicationinsights-agent-3.7.10.jar -Dotel.javaagent.extensions=$(pwd)/agent/extensions/contoso-parent-safe-sampler-1.1.0.jar -Dotel.instrumentation.jdbc.enabled=false -Dotel.instrumentation.jdbc-datasource.enabled=false -Dotel.instrumentation.lettuce.enabled=false -Dotel.instrumentation.jedis.enabled=false -Dotel.instrumentation.redisson.enabled=false -Dotel.instrumentation.azure-core.enabled=false -Dotel.instrumentation.ai-azure-functions.enabled=false"
exec java -Xms32m -Xmx256m -jar app.jar "$@"
