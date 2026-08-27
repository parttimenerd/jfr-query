package me.bechberger.jfr.duckdb.jvmlog;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PatternTokeniser {

    public enum TokenType { NUMBER, BYTES, ADDRESS, STRING }

    public record TokenisedLine(String pattern, List<TokenType> tokenTypes) {}

    // Order matters: BYTES before NUMBER (longer match first)
    // Lookbehind (?<![a-zA-Z_]) prevents matching digits inside identifiers like "G1", "ZGC"
    private static final Pattern TOKEN_PATTERN = Pattern.compile(
            "(0x[0-9a-fA-F]+)"                        +   // ADDRESS
            "|(?<![a-zA-Z_])(\\d+[KMGB])"             +   // BYTES (e.g. 256M, 4G, 1024K, 268435456B)
            "|(?<![a-zA-Z_])(\\d+(?:\\.\\d+)?)"       +   // NUMBER (int or float)
            "|\"([^\"]+)\""                                // quoted STRING
    );

    // Characters that are special in regex and must be escaped in literal parts
    private static final Pattern SPECIAL_CHARS = Pattern.compile("[\\[\\](){}.*+?^$|\\\\]");

    public static TokenisedLine tokenise(String lineBody) {
        Matcher m = TOKEN_PATTERN.matcher(lineBody);
        StringBuilder sb = new StringBuilder();
        List<TokenType> types = new ArrayList<>();
        int last = 0;

        while (m.find()) {
            if (m.start() > last) {
                sb.append(escapeLiteral(lineBody.substring(last, m.start())));
            }
            if (m.group(1) != null) {
                sb.append("(0x[0-9a-fA-F]+)");
                types.add(TokenType.ADDRESS);
            } else if (m.group(2) != null) {
                sb.append("(\\d+[KMGB])");
                types.add(TokenType.BYTES);
            } else if (m.group(3) != null) {
                sb.append("(\\d+(?:\\.\\d+)?)");
                types.add(TokenType.NUMBER);
            } else {
                sb.append("\"([^\"]+)\"");
                types.add(TokenType.STRING);
            }
            last = m.end();
        }
        if (last < lineBody.length()) {
            sb.append(escapeLiteral(lineBody.substring(last)));
        }
        return new TokenisedLine(sb.toString(), List.copyOf(types));
    }

    private static String escapeLiteral(String s) {
        return SPECIAL_CHARS.matcher(s).replaceAll("\\\\$0");
    }

    private PatternTokeniser() {}
}
