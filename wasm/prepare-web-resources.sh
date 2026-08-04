#!/usr/bin/env bash
# Prepares web resources for the jfr-query-wasm build:
#   1. Generates reflect-config.json for GraalVM native-image (jafar parser uses reflection)
# Usage: prepare-web-resources.sh <output-dir>
set -euo pipefail

OUT_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
M2="${HOME}/.m2/repository"

mkdir -p "$OUT_DIR"

# Helper: emit reflect-config entries for every class in a JAR.
# $1 = path to jar, $2 = "include_inner" to also register $-classes.
emit_jar_entries() {
  local jar="$1"
  local include_inner="${2:-}"
  if [ ! -f "$jar" ]; then
    echo "warning: jar not found: $jar" >&2
    return
  fi
  local filter_cmd
  if [ "$include_inner" = "include_inner" ]; then
    filter_cmd="cat"
  else
    filter_cmd="grep -v '\\\$'"
  fi
  jar tf "$jar" \
    | grep '\.class$' \
    | grep -v 'package-info' \
    | eval "$filter_cmd" \
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
}

# Helper: emit a single manual class entry (no trailing comma — caller must handle).
emit_class_entry() {
  echo "  {"
  echo "    \"name\": \"$1\","
  echo "    \"allDeclaredConstructors\": true,"
  echo "    \"allDeclaredMethods\": true,"
  echo "    \"allDeclaredFields\": true"
  echo "  },"
}

echo '[' > "$OUT_DIR/reflect-config.json"

{
  # jafar parser uses dynamic reflection on MetadataClass/MetadataField/MetadataAnnotation.
  emit_jar_entries "$M2/io/btrace/jafar-parser/0.24.0/jafar-parser-0.24.0.jar"

  # lz4-java (used by condensed-data / CJFR decompression):
  # LZ4Factory and XXHashFactory load implementation classes by name via Class.forName(),
  # including inner-class $Factory variants. Include ALL classes (with inner classes)
  # so GraalVM keeps them reachable.
  emit_jar_entries "$M2/at/yawk/lz4/lz4-java/1.11.0/lz4-java-1.11.0.jar" include_inner

  # me.bechberger.jfr.Configuration is a record whose withFieldValue() calls
  # getRecordComponents() at runtime. GraalVM native-image requires the record class
  # to be registered for reflection so accessor methods are preserved.
  emit_class_entry "me.bechberger.jfr.Configuration"

  # me.bechberger.jfr.Universe is instantiated via ReadStructUtil.createInstanceFromReadStruct()
  # (calls getDeclaredConstructors()) and its fields are accessed via StructReflectionUtil
  # (calls getDeclaredFields() + Field.get()). Both require full reflection registration.
  emit_class_entry "me.bechberger.jfr.Universe"
  emit_class_entry "me.bechberger.condensed.Universe"

} | sed '$ s/,$//' >> "$OUT_DIR/reflect-config.json"

echo ']' >> "$OUT_DIR/reflect-config.json"

echo "Generated reflect-config.json with $(grep -c '"name"' "$OUT_DIR/reflect-config.json") entries"
