#!/usr/bin/env bash
# Prepares web resources for the jfr-query-wasm build:
#   1. Generates reflect-config.json for GraalVM native-image (jafar parser uses reflection)
# Usage: prepare-web-resources.sh <output-dir>
set -euo pipefail

OUT_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
M2="${HOME}/.m2/repository"

mkdir -p "$OUT_DIR"

echo '[' > "$OUT_DIR/reflect-config.json"

# Reflect on jafar parser internals + our own importer classes.
# jafar uses dynamic reflection on MetadataClass/MetadataField/MetadataAnnotation.
JARS=(
  "$M2/io/btrace/jafar-parser/0.24.0/jafar-parser-0.24.0.jar"
)

# Also include our core jar so MetadataClass-driven dispatch can hit our classes.
CORE_JAR="$(ls "$SCRIPT_DIR/../core/target/jfr-query-"*.jar 2>/dev/null | grep -v jar-with-dependencies | grep -v sources | head -1 || true)"
if [ -n "$CORE_JAR" ]; then
  JARS+=("$CORE_JAR")
fi

{
  for JAR in "${JARS[@]}"; do
    if [ ! -f "$JAR" ]; then
      echo "warning: jar not found: $JAR" >&2
      continue
    fi
    jar tf "$JAR" \
      | grep '\.class$' \
      | grep -v 'package-info' \
      | grep -v '\$' \
      | sed 's|/|.|g; s|\.class$||' \
      | sort \
      | while IFS= read -r cls; do
          echo "  {"
          echo "    \"name\": \"$cls\","
          echo "    \"allDeclaredConstructors\": true,"
          echo "    \"allDeclaredMethods\": true,"
          echo "    \"allDeclaredFields\": true"
          echo "  },"
        done
  done
} | sed '$ s/,$//' >> "$OUT_DIR/reflect-config.json"

echo ']' >> "$OUT_DIR/reflect-config.json"

echo "Generated reflect-config.json with $(grep -c '"name"' "$OUT_DIR/reflect-config.json") entries"
