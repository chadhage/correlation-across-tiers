#!/usr/bin/env sh
set -eu
cd /home/site/wwwroot
case "${CONTOSO_OPERATOR_MODE-}" in
  inventory-fixture)
    exec sh fixture-startup.sh
    ;;
  operator|watchdog)
    for option in "${JAVA_TOOL_OPTIONS-}" "${JAVA_OPTS-}" "${JDK_JAVA_OPTIONS-}" "${_JAVA_OPTIONS-}"; do
      [ -z "$option" ] || { echo "OPERATOR_UNAPPROVED_LAUNCHER_OPTIONS" >&2; exit 2; }
    done
    exec java -Xms32m -Xmx256m -jar app.jar
    ;;
  *)
    echo "OPERATOR_MODE_REQUIRED" >&2
    exit 2
    ;;
esac
