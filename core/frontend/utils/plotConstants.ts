// Plot-config language: cell-local constants.
//
// Lets users define reusable values via `LET @name = value` lines that are
// substituted into subsequent plot calls. The value is a raw string; whatever
// the user wrote on the right-hand side is spliced verbatim where `@name` appears.
//
// Example:
//   LET @y = ["cpu", "memory"]
//   LET @t = "Resource Usage"
//   LINE_CHART(x: "time", y: @y) TITLE @t
//
// References to undefined constants surface as a parse-time error rather than
// passing through to the underlying SQL/plot parser, which would otherwise
// produce confusing "column not found" messages.
//
// CONSTRAINT — Forward references are NOT supported (B-189): a constant may
// only reference constants that were declared on earlier lines. A reference to
// a constant defined *later* in the same config block is treated as undefined
// and produces an error.  Reorder your LET lines so every dependency appears
// before its first use.

export interface ExpansionResult {
    /** The config with all LET lines stripped and @-references substituted. */
    expanded: string;
    /** Any errors found during expansion (undefined refs, redefinition, malformed LET). */
    errors: string[];
    /** The constants that were defined, in declaration order. Useful for autocomplete. */
    constants: { name: string; value: string }[];
}

const LET_LINE_RE = /^\s*LET\s+@([a-zA-Z_][\w]*)\s*=\s*(.+?)\s*$/i;
const REF_RE = /@([a-zA-Z_][\w]*)/g;

export function expandPlotConstants(config: string): ExpansionResult {
    const errors: string[] = [];
    const constants: { name: string; value: string }[] = [];
    const env: Record<string, string> = {};
    const outLines: string[] = [];

    const lines = config.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(LET_LINE_RE);
        if (m) {
            const [, name, rawValue] = m;
            // Allow constants to reference earlier constants in their value
            const expandedValue = substituteRefs(rawValue, env, errors, i + 1);
            if (env[name] !== undefined) {
                errors.push(`Line ${i + 1}: redefinition of @${name} (already defined above).`);
                // First definition wins — silently ignore the second value.
            } else {
                env[name] = expandedValue;
                constants.push({ name, value: expandedValue });
            }
            // LET lines do not contribute to the output config.
            continue;
        }
        // Non-LET lines: substitute references and pass through.
        outLines.push(substituteRefs(line, env, errors, i + 1));
    }

    return {
        expanded: outLines.join('\n'),
        errors,
        constants,
    };
}

function substituteRefs(input: string, env: Record<string, string>, errors: string[], lineNo: number): string {
    return input.replace(REF_RE, (match, name) => {
        if (env[name] === undefined) {
            errors.push(`Line ${lineNo}: undefined constant @${name}.${suggestNearby(name, Object.keys(env))}`);
            return match; // leave as-is so downstream sees the @name and may report further context
        }
        return env[name];
    });
}

function suggestNearby(name: string, defined: string[]): string {
    if (defined.length === 0) return ' (no constants are defined; use `LET @name = value` to define one).';
    // Lightweight prefix/substring suggest — keep this file dependency-free.
    const lower = name.toLowerCase();
    const candidate = defined.find(d => d.toLowerCase().startsWith(lower) || d.toLowerCase().includes(lower));
    if (candidate) return ` Did you mean @${candidate}?`;
    return ` Defined constants: ${defined.map(d => '@' + d).join(', ')}.`;
}
