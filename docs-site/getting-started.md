# Getting Started

## Requirements

- Java 21+
- (Optional) [jbang](https://www.jbang.dev/) for zero-install usage

## Install via jbang

```shell
jbang jfr-query@parttimenerd/jfr-query
```

## Download pre-built JAR

Download the [latest snapshot](https://github.com/parttimenerd/jfr-query/releases/download/snapshot/query.jar):

```shell
curl -L -o query.jar https://github.com/parttimenerd/jfr-query/releases/download/snapshot/query.jar
java -jar query.jar --help
```

## Build from source

```shell
git clone https://github.com/parttimenerd/jfr-query.git
cd jfr-query
mvn clean package
java -jar target/query.jar --help
```

Requires Java 21 and Maven 3.8+. The frontend is built automatically during `mvn package`.

## Start the web UI

```shell
java -jar query.jar serve path/to/recording.jfr
# Open http://localhost:4244 in your browser
```

Both `.jfr` (standard Java Flight Recorder) and `.cjfr` ([condensed JFR](https://github.com/parttimenerd/condensed-data)) files are accepted.

Pass `--port` to change the port. Pass `--templates-dir` to load custom notebook templates.
