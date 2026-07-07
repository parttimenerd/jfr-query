import type { CustomView, CustomMacro, NotebookMetadata as NotebookMetadataType } from '../types';

export interface MarkdownSection {
    title: string;
    content: string;
}

export interface ParsedContent {
    title: string | null;
    introduction: MarkdownSection | null;
    variables: Record<string, string>;
    variableWarnings: string[];
    sqlBlocks: string[];
    queryAliases: (string | null)[];
    /** Per SQL block: was the `-- alias <name> materialized` flag set? */
    queryAliasMaterialized: boolean[];
    plotBlocks: string[];
    plotAliases: (string | null)[];
    /** All plot blocks in document order with their associated SQL block index. */
    plotBlocksWithSqlIndex: Array<{ config: string; sqlIndex: number }>;
    conclusion: MarkdownSection | null;
    /** Plot blocks with no preceding SQL block, collected in document order. */
    standalonePlots: string[];
}

export type NotebookMetadata = NotebookMetadataType;

export interface ParsedNotebook {
  metadata: NotebookMetadata;
  content: string;
}

const FRONT_MATTER_DELIMITER = '---';
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

const parseFrontMatter = (fmString: string): NotebookMetadata => {
    // B-120: This is a hand-rolled line-by-line YAML parser, not a full YAML parser.
    // It handles the specific subset of YAML used in notebook front matter (scalar
    // values, simple lists with "- key: value" entries, indented block scalars with
    // the "|" indicator, and inline arrays). However, it does NOT support general
    // structured YAML values such as:
    //   - Nested mappings beyond the supported sections (views, macros, variables, cellConditions)
    //   - Multi-line values for sections other than customSystemPrompt / cellConditions
    //   - Quoted scalars containing colons (e.g. `key: "value: with colon"`)
    //   - Anchors, aliases, merge keys, or other advanced YAML features
    // Structured values for unsupported keys are stored as raw strings via the
    // `(result as any)[keyTrimmed] = value` fallback at indent==0 (line 72).
    const lines = fmString.split('\n');
    const result: NotebookMetadata = { views: [], macros: [] };
    let currentSection: 'views' | 'macros' | 'variables' | 'cellConditions' | null = null;
    let currentObject: any = null;
    let multilineKey: string | null = null;
    /** When parsing a `cellConditions:` block-scalar value (`key: |`), this is the key being built. */
    let cellConditionMultilineKey: string | null = null;

    for (const line of lines) {
        if (line.trim() === '' && !multilineKey && !cellConditionMultilineKey) continue;
        const indent = line.length - line.trimStart().length;
        const trimmedLine = line.trim();

        if (indent === 0) {
            currentSection = null;
            multilineKey = null;
            cellConditionMultilineKey = null;
            currentObject = null;
            const [key, ...valParts] = trimmedLine.split(':');
            const keyTrimmed = key.trim();
            const value = valParts.join(':').trim();

            if (keyTrimmed === 'views' || keyTrimmed === 'macros') {
                currentSection = keyTrimmed as 'views' | 'macros';
            } else if (keyTrimmed === 'variables') {
                currentSection = 'variables';
                if (!result.variables) result.variables = {};
            } else if (keyTrimmed === 'cellConditions') {
                currentSection = 'cellConditions';
                if (!result.cellConditions) result.cellConditions = {};
            } else if (keyTrimmed === 'decimalPlaces') {
                const num = parseInt(value, 10);
                if (!isNaN(num)) result.decimalPlaces = num;
            } else if (keyTrimmed === 'customSystemPrompt' && value === '|') {
                 multilineKey = keyTrimmed;
                 result.customSystemPrompt = '';
            } else if (keyTrimmed) {
                // Single-quoted YAML scalar: strip outer quotes and unescape '' → '
                const unquoted = value.replace(/^['"]|['"]$/g, '');
                (result as any)[keyTrimmed] = value.startsWith("'") ? unquoted.replace(/''/g, "'") : unquoted;
            }
        } else if (multilineKey && !currentSection) { // Top-level multiline (customSystemPrompt)
             result.customSystemPrompt += (result.customSystemPrompt ? '\n' : '') + line.substring(indent);
        } else if (currentSection === 'cellConditions') {
            // `key: <single-line SQL>` or `key: |` followed by indented lines.
            if (cellConditionMultilineKey && indent > 2) {
                const existing = result.cellConditions![cellConditionMultilineKey];
                result.cellConditions![cellConditionMultilineKey] = existing
                    ? existing + '\n' + line.substring(indent)
                    : line.substring(indent);
            } else {
                cellConditionMultilineKey = null;
                const colonIdx = trimmedLine.indexOf(':');
                if (colonIdx > 0) {
                    const k = trimmedLine.substring(0, colonIdx).trim();
                    const v = trimmedLine.substring(colonIdx + 1).trim();
                    if (v === '|') {
                        cellConditionMultilineKey = k;
                        result.cellConditions![k] = '';
                    } else if (k) {
                        const unquotedV = v.replace(/^['"]|['"]$/g, '');
                        result.cellConditions![k] = v.startsWith("'") ? unquotedV.replace(/''/g, "'") : unquotedV;
                    }
                }
            }
        } else if (currentSection === 'variables') {
            // Map of name -> value. Accepts `$name: value`, `$$name: value`, or bare `name: value`.
            // Bare names are stored with a $ prefix so they're accessible as $name in SQL.
            const [k, ...vParts] = trimmedLine.split(':');
            const kTrim = k.trim();
            if (kTrim) {
                const rawV = vParts.join(':').trim();
                const unquotedV = rawV.replace(/^['"]|['"]$/g, '');
                const key = (kTrim.startsWith('$') || kTrim.startsWith('$$')) ? kTrim : `$${kTrim}`;
                result.variables![key] = rawV.startsWith("'") ? unquotedV.replace(/''/g, "'") : unquotedV;
            }
        } else if (currentSection) {
            if (multilineKey && indent > 2) {
                currentObject[multilineKey] += '\n' + line.substring(indent);
            } else if (trimmedLine.startsWith('- ')) {
                multilineKey = null;
                currentObject = {};
                (result[currentSection] as any[]).push(currentObject);
                const [key, ...valParts] = trimmedLine.substring(2).split(':');
                currentObject[key.trim()] = valParts.join(':').trim().replace(/^['"]|['"]$/g, '');
                currentObject.id = `fm-${currentSection}-${(result[currentSection] as any[]).length - 1}`;
            } else if (currentObject) {
                multilineKey = null;
                const [key, ...valParts] = trimmedLine.split(':');
                const value = valParts.join(':').trim();
                const keyName = key.trim();
                if (value === '|') {
                    multilineKey = keyName;
                    currentObject[multilineKey] = '';
                } else if (value.startsWith('[')) {
                    // Inline YAML-style array: [a, b, c] or [{name: x, type: y}]
                    try {
                        // Convert YAML-style {k: v} to JSON {"k": "v"} by quoting bare keys and
                        // bare values. All values are treated as strings (matching YAML scalar
                        // string semantics for the front-matter use-case).
                        // B-120: uses a replacement function rather than a regex back-reference so
                        // values with spaces (e.g. `{name: hello world}`) are captured whole before
                        // being quoted, and already-quoted values and nested structures are skipped.
                        const jsonLike = value
                            // Quote bare object keys.
                            .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
                            // Quote bare values: capture everything after `: ` up to the next `,`, `]`, or `}`.
                            .replace(/:\s*([^"{\[,\]\}][^,\]\}]*)/g, (_, v) => `:"${v.trimEnd()}"`);
                        currentObject[keyName] = JSON.parse(jsonLike);
                    } catch {
                        currentObject[keyName] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
                    }
                } else {
                    currentObject[keyName] = value.replace(/^['"]|['"]$/g, '');
                }
            }
        }
    }
    (result.views || []).forEach(v => { if (v.sql?.startsWith('\n')) v.sql = v.sql.substring(1); });
    (result.macros || []).forEach(m => { if (m.sql?.startsWith('\n')) m.sql = m.sql.substring(1); });
    if(result.customSystemPrompt?.startsWith('\n')) result.customSystemPrompt = result.customSystemPrompt.substring(1);

    return result;
}

const stringifyFrontMatter = (metadata: NotebookMetadata): string => {
    let parts: string[] = [];
    
    if (metadata.customSystemPrompt) {
        if (metadata.customSystemPrompt.includes('\n')) {
            parts.push(`customSystemPrompt: |\n${metadata.customSystemPrompt.split('\n').map(line => `  ${line}`).join('\n')}`);
        } else {
            parts.push(`customSystemPrompt: '${metadata.customSystemPrompt.replace(/'/g, "''")}'`);
        }
    }
    if (metadata.timeFormat) {
        parts.push(`timeFormat: '${metadata.timeFormat}'`);
    }
    if (metadata.decimalPlaces !== undefined && metadata.decimalPlaces !== null) {
        parts.push(`decimalPlaces: ${metadata.decimalPlaces}`);
    }

    if (metadata.views && metadata.views.length > 0) {
        if (parts.length > 0) parts.push(''); // Add separator
        parts.push('views:');
        for (const view of metadata.views) {
            parts.push(`  - name: '${view.name.replace(/'/g, "''")}'`);
            if (view.includes && view.includes.length > 0) {
                parts.push(`    includes: [${view.includes.join(', ')}]`);
            }
            if (view.params && view.params.length > 0) {
                const ps = view.params.map(p => `{name: ${p.name}, type: ${p.type}${p.default !== undefined ? `, default: ${p.default}` : ''}}`).join(', ');
                parts.push(`    params: [${ps}]`);
            }
            parts.push(`    sql: |\n${view.sql.split('\n').map(line => `      ${line}`).join('\n')}`);
        }
    }
    if (metadata.macros && metadata.macros.length > 0) {
        if (parts.length > 0) parts.push(''); // Add separator
        parts.push('macros:');
        for (const macro of metadata.macros) {
            parts.push(`  - name: '${macro.name.replace(/'/g, "''")}'`);
            if (macro.includes && macro.includes.length > 0) {
                parts.push(`    includes: [${macro.includes.join(', ')}]`);
            }
            if (macro.params && macro.params.length > 0) {
                const ps = macro.params.map(p => `{name: ${p.name}, type: ${p.type}${p.default !== undefined ? `, default: ${p.default}` : ''}}`).join(', ');
                parts.push(`    params: [${ps}]`);
            }
            parts.push(`    sql: |\n${macro.sql.split('\n').map(line => `      ${line}`).join('\n')}`);
        }
    }

    if (metadata.variables && Object.keys(metadata.variables).length > 0) {
        if (parts.length > 0) parts.push(''); // Add separator
        parts.push('variables:');
        for (const [k, v] of Object.entries(metadata.variables)) {
            // Skip placeholder variables that were never named/filled in.
            if (!k || /^newVar\d*$/.test(k) && v === '') continue;
            parts.push(`  ${k}: '${String(v).replace(/'/g, "''")}'`);
        }
    }

    if (metadata.cellConditions && Object.keys(metadata.cellConditions).length > 0) {
        if (parts.length > 0) parts.push(''); // Add separator
        parts.push('cellConditions:');
        for (const [k, v] of Object.entries(metadata.cellConditions)) {
            const sql = String(v);
            if (sql.includes('\n')) {
                parts.push(`  ${k}: |`);
                parts.push(sql.split('\n').map(line => `    ${line}`).join('\n'));
            } else {
                parts.push(`  ${k}: '${sql.replace(/'/g, "''")}'`);
            }
        }
    }

    // Serialize unknown string/number fields
    const knownKeys = new Set(['customSystemPrompt', 'timeFormat', 'decimalPlaces', 'views', 'macros', 'variables', 'cellConditions']);
    for (const [key, val] of Object.entries(metadata)) {
        if (!knownKeys.has(key) && val !== undefined && val !== null && typeof val !== 'object') {
            parts.push(`${key}: ${val}`);
        }
    }

    return parts.join('\n');
}

export const parseNotebook = (markdown: string): ParsedNotebook => {
    if (typeof markdown !== 'string') return { metadata: { views: [], macros: [] }, content: '' };
    const defaultResult: ParsedNotebook = { metadata: { views: [], macros: [] }, content: markdown };
    if (!markdown.startsWith(FRONT_MATTER_DELIMITER)) return defaultResult;

    const m = markdown.match(FM_RE);
    if (!m) return defaultResult;
    const fmString = m[1];
    const content = m[2];
    const parsedFm = parseFrontMatter(fmString);

    return { metadata: parsedFm, content };
};

export const reconstructNotebook = (data: ParsedNotebook): string => {
    const fmString = stringifyFrontMatter(data.metadata);
    if (!fmString) return data.content;
    return `${FRONT_MATTER_DELIMITER}\n${fmString}\n${FRONT_MATTER_DELIMITER}\n${data.content}`;
};


// --- Lossless Cell Parsing ---

export type CellSegment =
  | { type: 'markdown'; content: string }
  | { type: 'variables'; content: string }
  | { type: 'sql'; content: string }
  | { type: 'plot'; content: string }
  | { type: 'if'; condition: string; body: string };

const SQL_FENCE_START = '```sql';
const PLOT_FENCE_START = '```plot';
const VARIABLES_FENCE_START = '```variables';
const END_FENCE = '```';

/**
 * Lossless tokenizer: Breaks content into code blocks and the markdown (including all whitespace) between them.
 */
export const tokenizeCellContent = (content: string): CellSegment[] => {
    const segments: CellSegment[] = [];
    // Match either a typed fence (```sql / ```plot / ```variables) or a
    // conditional fence (```{if <SQL>}). The conditional regex is anchored
    // separately so the SQL can contain anything except the closing brace.
    const blockRegex = /(```(?:sql|plot|variables)|```\{if\s+([^}]*)\})([\s\S]*?)(```)/g;
    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
        // Capture markdown between the last block (or start) and this one
        if (match.index > lastIndex) {
            segments.push({ type: 'markdown', content: content.substring(lastIndex, match.index) });
        }

        const fence = match[1];
        const ifCondition = match[2];     // only set for ```{if ...} fences
        const blockContent = match[3];

        if (fence === SQL_FENCE_START) {
            segments.push({ type: 'sql', content: blockContent });
        } else if (fence === PLOT_FENCE_START) {
            segments.push({ type: 'plot', content: blockContent });
        } else if (fence === VARIABLES_FENCE_START) {
            segments.push({ type: 'variables', content: blockContent });
        } else if (ifCondition !== undefined) {
            segments.push({ type: 'if', condition: ifCondition.trim(), body: blockContent });
        }

        lastIndex = blockRegex.lastIndex;
    }

    // Capture any final markdown after the last block
    if (lastIndex < content.length) {
        segments.push({ type: 'markdown', content: content.substring(lastIndex) });
    }

    return segments;
};

/**
 * Lossless reconstructor: Joins segments back into a string identical to the original.
 */
export const reconstructCellContent = (segments: CellSegment[]): string => {
    return segments.map(seg => {
        switch (seg.type) {
            case 'markdown': return seg.content;
            case 'variables': return `${VARIABLES_FENCE_START}${seg.content}${END_FENCE}`;
            case 'sql':
                const sqlLines = seg.content.split('\n');
                if (sqlLines.length > 0 && sqlLines[0].trim() === '') sqlLines.shift();
                if (sqlLines.length > 0 && sqlLines[sqlLines.length - 1].trim() === '') sqlLines.pop();
                const trimmedSql = sqlLines.join('\n');
                if (trimmedSql === '') return `${SQL_FENCE_START}${seg.content}${END_FENCE}`;
                return `${SQL_FENCE_START}\n${trimmedSql}\n${END_FENCE}`;
            case 'plot':
                const plotLines = seg.content.split('\n');
                if (plotLines.length > 0 && plotLines[0].trim() === '') plotLines.shift();
                if (plotLines.length > 0 && plotLines[plotLines.length - 1].trim() === '') plotLines.pop();
                const trimmedPlot = plotLines.join('\n');
                if (trimmedPlot === '') return `${PLOT_FENCE_START}${seg.content}${END_FENCE}`;
                return `${PLOT_FENCE_START}\n${trimmedPlot}\n${END_FENCE}`;
            case 'if':
                return `\`\`\`{if ${seg.condition}}${seg.body}${END_FENCE}`;
        }
    }).join('');
};

/**
 * Creates a structured "view model" (ParsedContent) from the lossless segments for rendering the UI.
 * This is intentionally lossy regarding inter-block whitespace, which is fine for rendering.
 */
export const parseCellContent = (segments: CellSegment[]): ParsedContent => {
    const result: ParsedContent = {
        title: null,
        introduction: null,
        variables: {},
        variableWarnings: [],
        sqlBlocks: [],
        queryAliases: [],
        queryAliasMaterialized: [],
        plotBlocks: [],
        plotAliases: [],
        plotBlocksWithSqlIndex: [],
        conclusion: null,
        standalonePlots: [],
    };
    
    let firstCodeBlockIndex = segments.findIndex(s => s.type !== 'markdown');
    if (firstCodeBlockIndex === -1) firstCodeBlockIndex = segments.length;

    const introSegments = segments.slice(0, firstCodeBlockIndex);
    let introContent = introSegments.map(s => reconstructCellContent([s])).join('');

    // Strip the cell directive (`<!-- @cell ... -->`) from the rendered intro;
    // the directive controls cell identity but should never be visible to the
    // reader.
    introContent = stripCellDirective(introContent).body;

    const titleRegex = /^\s*##\s+(.*)(\r?\n|\r)?/m;
    const titleMatch = introContent.match(titleRegex);

    if (titleMatch) {
        result.title = titleMatch[1].trim();
        // Remove the title line and any immediate following whitespace from the intro content
        introContent = introContent.replace(titleRegex, '').trimStart();
    }

    if (introContent.trim()) {
        result.introduction = {
            title: 'Introduction', // Dummy title, not rendered
            content: introContent,
        };
    }

    const conclusionSegments = segments.slice(firstCodeBlockIndex).filter(s => s.type === 'markdown');
    const conclusionContent = conclusionSegments.map(s => s.content).join('');

    if (conclusionContent.trim()) {
        result.conclusion = {
            title: 'Conclusion',
            content: conclusionContent,
        };
    }

    let currentSqlIndex = -1;
    for (const seg of segments) {
        if (seg.type === 'variables') {
            seg.content.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed === '' || trimmed.startsWith('#')) return;
                // Accept both `$name = value` and bare `name = value` (auto-prepend $).
                const match = trimmed.match(/^(\$(?!\$)\w+|\w+)\s*=\s*(.*)$/);
                if (match) {
                    const key = match[1].startsWith('$') ? match[1] : `$${match[1]}`;
                    result.variables[key] = match[2].trim();
                } else {
                    result.variableWarnings.push(`Unrecognized line: ${trimmed}`);
                }
            });
        } else if (seg.type === 'sql') {
            let content = seg.content;
            let alias: string | null = null;
            let materialized = false;

            // Accept both `-- alias <name>[ materialized]` (preferred) and
            // legacy `-- <name>` as the first SQL line.
            const aliasMatchExplicit = content.match(/^\s*--\s*alias\s+([a-zA-Z_][\w\s-]*?)\s*(materialized)?\s*\n/i);
            if (aliasMatchExplicit) {
                alias = aliasMatchExplicit[1].trim();
                materialized = !!aliasMatchExplicit[2];
                content = content.substring(aliasMatchExplicit[0].length);
            } else {
                // Legacy: `-- <name>` where name is a single identifier (no spaces).
                // Restricted to `[\w-]+` to avoid stripping intentional SQL comments
                // like `-- This query finds all GC pauses` (B-180).
                const aliasMatch = content.match(/^\s*--\s*([\w-]+)\s*\n/);
                if (aliasMatch) {
                    alias = aliasMatch[1].trim();
                    content = content.substring(aliasMatch[0].length);
                }
            }

            const sqlLines = content.split('\n');
            if (sqlLines.length > 0 && sqlLines[0].trim() === '') sqlLines.shift();
            if (sqlLines.length > 0 && sqlLines[sqlLines.length - 1].trim() === '') sqlLines.pop();
            result.sqlBlocks.push(sqlLines.join('\n'));
            result.queryAliases.push(alias);
            result.queryAliasMaterialized.push(materialized);
            currentSqlIndex++;
        } else if (seg.type === 'plot') {
            let plotContent = seg.content;
            let plotAlias: string | null = null;

            const plotAliasMatch = plotContent.match(/^\s*--\s*([a-zA-Z_][\w\s-]*?)\s*\n/);
            if (plotAliasMatch) {
                plotAlias = plotAliasMatch[1].trim();
                plotContent = plotContent.substring(plotAliasMatch[0].length);
            }

            const plotLines = plotContent.split('\n');
            if (plotLines.length > 0 && plotLines[0].trim() === '') plotLines.shift();
            if (plotLines.length > 0 && plotLines[plotLines.length - 1].trim() === '') plotLines.pop();
            const plotConfig = plotLines.join('\n');

            if (currentSqlIndex < 0 || (result.plotBlocks[currentSqlIndex] !== undefined && result.plotBlocks[currentSqlIndex] !== '')) {
                // No preceding SQL block, or the preceding SQL's plot slot is already filled:
                // this is a standalone plot.
                result.standalonePlots.push(plotConfig);
            } else {
                while (result.plotBlocks.length <= currentSqlIndex) {
                    result.plotBlocks.push('');
                }
                result.plotBlocks[currentSqlIndex] = plotConfig;
                result.plotAliases.push(plotAlias);
                result.plotBlocksWithSqlIndex.push({ config: plotConfig, sqlIndex: currentSqlIndex });
            }
        }
    }

    while (result.plotBlocks.length < result.sqlBlocks.length) {
        result.plotBlocks.push('');
    }

    return result;
};

/**
 * Parses a `<!-- @cell key=value (key="quoted value")* -->` directive line.
 * Returns null if `content` does not begin with such a directive (allowing
 * leading whitespace / blank lines).
 *
 * Accepted keys for v1: `name` (string), `collapsed` (true|false).
 * Unknown keys are preserved in `rest`.
 */
export interface ParsedCellDirective {
    name?: string;
    collapsed?: boolean;
    rest: Record<string, string>;
    /** Length of the matched directive line including the trailing newline. */
    matchLength: number;
    /** Original raw directive text (no trailing newline). */
    raw: string;
}

const CELL_DIRECTIVE_RE = /^[\s\r\n]*(<!--\s*@cell\s+([^>]*?)\s*-->)\s*(\r?\n)?/;

export const parseCellDirective = (content: string): ParsedCellDirective | null => {
    const m = content.match(CELL_DIRECTIVE_RE);
    if (!m) return null;
    const raw = m[1];
    const attrString = m[2];
    const rest: Record<string, string> = {};
    let name: string | undefined;
    let collapsed: boolean | undefined;

    // Tokenize key=value pairs. Values may be quoted ("..." or '...') or bare.
    const attrRe = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrString)) !== null) {
        const key = am[1];
        const value = am[2] ?? am[3] ?? am[4] ?? '';
        if (key === 'name') name = value;
        else if (key === 'collapsed') collapsed = value === 'true';
        else rest[key] = value;
    }

    return { name, collapsed, rest, matchLength: m[0].length, raw };
};

/**
 * Convenience: strip a leading cell directive from `content` and return both
 * the parsed directive (if any) and the remaining body. The body is byte-
 * identical to the original minus the matched directive line.
 */
export const stripCellDirective = (content: string): { directive: ParsedCellDirective | null; body: string } => {
    const directive = parseCellDirective(content);
    if (!directive) return { directive: null, body: content };
    return { directive, body: content.substring(directive.matchLength) };
};
