import type { CustomView, CustomMacro, NotebookMetadata as NotebookMetadataType } from '../types';

export interface MarkdownSection {
    title: string;
    content: string;
}

export interface ParsedContent {
    title: string | null;
    introduction: MarkdownSection | null;
    variables: Record<string, string>;
    sqlBlocks: string[];
    queryAliases: (string | null)[];
    plotBlocks: string[];
    conclusion: MarkdownSection | null;
}

export type NotebookMetadata = NotebookMetadataType;

export interface ParsedNotebook {
  metadata: NotebookMetadata;
  content: string;
}

const FRONT_MATTER_DELIMITER = '---';
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

const parseFrontMatter = (fmString: string): NotebookMetadata => {
    const lines = fmString.split('\n');
    const result: NotebookMetadata = { views: [], macros: [] };
    let currentSection: 'views' | 'macros' | null = null;
    let currentObject: any = null;
    let multilineKey: string | null = null;

    for (const line of lines) {
        if (line.trim() === '' && !multilineKey) continue;
        const indent = line.length - line.trimStart().length;
        const trimmedLine = line.trim();

        if (indent === 0) {
            currentSection = null;
            multilineKey = null;
            currentObject = null;
            const [key, ...valParts] = trimmedLine.split(':');
            const keyTrimmed = key.trim();
            const value = valParts.join(':').trim();

            if (keyTrimmed === 'views' || keyTrimmed === 'macros') {
                currentSection = keyTrimmed as 'views' | 'macros';
            } else if (keyTrimmed === 'decimalPlaces') {
                const num = parseInt(value, 10);
                if (!isNaN(num)) result.decimalPlaces = num;
            } else if (keyTrimmed === 'customSystemPrompt' && value === '|') {
                 multilineKey = keyTrimmed;
                 result.customSystemPrompt = '';
            } else if (keyTrimmed) {
                 (result as any)[keyTrimmed] = value.replace(/^['"]|['"]$/g, '');
            }
        } else if (multilineKey && !currentSection) { // Top-level multiline (customSystemPrompt)
             result.customSystemPrompt += (result.customSystemPrompt ? '\n' : '') + line.substring(indent);
        } else if (currentSection) {
            if (multilineKey && indent > 2) {
                currentObject[multilineKey] += '\n' + line.substring(indent);
            } else if (trimmedLine.startsWith('- ')) {
                multilineKey = null;
                currentObject = {};
                (result[currentSection] as any[]).push(currentObject);
                const [key, ...valParts] = trimmedLine.substring(2).split(':');
                currentObject[key.trim()] = valParts.join(':').trim().replace(/^['"]|['"]$/g, '');
                currentObject.id = `fm-${Date.now()}-${Math.random()}`;
            } else if (currentObject) {
                multilineKey = null;
                const [key, ...valParts] = trimmedLine.split(':');
                const value = valParts.join(':').trim();
                if (value === '|') {
                    multilineKey = key.trim();
                    currentObject[multilineKey] = '';
                } else {
                    currentObject[key.trim()] = value.replace(/^['"]|['"]$/g, '');
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
            parts.push(`    sql: |\n${view.sql.split('\n').map(line => `      ${line}`).join('\n')}`);
        }
    }
    if (metadata.macros && metadata.macros.length > 0) {
        if (parts.length > 0) parts.push(''); // Add separator
        parts.push('macros:');
        for (const macro of metadata.macros) {
            parts.push(`  - name: '${macro.name.replace(/'/g, "''")}'`);
            parts.push(`    sql: |\n${macro.sql.split('\n').map(line => `      ${line}`).join('\n')}`);
        }
    }

    // Serialize unknown string/number fields
    const knownKeys = new Set(['customSystemPrompt', 'timeFormat', 'decimalPlaces', 'views', 'macros']);
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
  | { type: 'plot'; content: string };

const SQL_FENCE_START = '```sql';
const PLOT_FENCE_START = '```plot';
const VARIABLES_FENCE_START = '```variables';
const END_FENCE = '```';

/**
 * Lossless tokenizer: Breaks content into code blocks and the markdown (including all whitespace) between them.
 */
export const tokenizeCellContent = (content: string): CellSegment[] => {
    const segments: CellSegment[] = [];
    const blockRegex = /(```(?:sql|plot|variables))([\s\S]*?)(```)/g;
    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
        // Capture markdown between the last block (or start) and this one
        if (match.index > lastIndex) {
            segments.push({ type: 'markdown', content: content.substring(lastIndex, match.index) });
        }
        
        const fence = match[1];
        const blockContent = match[2];

        if (fence === SQL_FENCE_START) {
            segments.push({ type: 'sql', content: blockContent });
        } else if (fence === PLOT_FENCE_START) {
            segments.push({ type: 'plot', content: blockContent });
        } else if (fence === VARIABLES_FENCE_START) {
            segments.push({ type: 'variables', content: blockContent });
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
        sqlBlocks: [],
        queryAliases: [],
        plotBlocks: [],
        conclusion: null,
    };
    
    let firstCodeBlockIndex = segments.findIndex(s => s.type !== 'markdown');
    if (firstCodeBlockIndex === -1) firstCodeBlockIndex = segments.length;

    const introSegments = segments.slice(0, firstCodeBlockIndex);
    let introContent = introSegments.map(s => reconstructCellContent([s])).join('');
    
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
                const match = line.trim().match(/^(\$(?!\$)\w+)\s*=\s*(.*)$/);
                if (match) {
                    result.variables[match[1]] = match[2].trim();
                }
            });
        } else if (seg.type === 'sql') {
            let content = seg.content;
            let alias: string | null = null;

            const aliasMatch = content.match(/^\s*--\s*([a-zA-Z_][\w]*)\s*\n/);
            if (aliasMatch) {
                alias = aliasMatch[1];
                content = content.substring(aliasMatch[0].length);
            }

            const sqlLines = content.split('\n');
            if (sqlLines.length > 0 && sqlLines[0].trim() === '') sqlLines.shift();
            if (sqlLines.length > 0 && sqlLines[sqlLines.length - 1].trim() === '') sqlLines.pop();
            result.sqlBlocks.push(sqlLines.join('\n'));
            result.queryAliases.push(alias);
            currentSqlIndex++;
        } else if (seg.type === 'plot') {
            if (currentSqlIndex < 0) {
                // No preceding SQL block - skip this orphaned plot block
                continue;
            }
            while (result.plotBlocks.length <= currentSqlIndex) {
                result.plotBlocks.push('');
            }
            const plotLines = seg.content.split('\n');
            if (plotLines.length > 0 && plotLines[0].trim() === '') plotLines.shift();
            if (plotLines.length > 0 && plotLines[plotLines.length - 1].trim() === '') plotLines.pop();
            result.plotBlocks[currentSqlIndex] = plotLines.join('\n');
        }
    }

    while (result.plotBlocks.length < result.sqlBlocks.length) {
        result.plotBlocks.push('');
    }

    return result;
};