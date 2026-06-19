// A simple but robust parser for the plot configuration language's outer syntax.

export interface ParsedPlotCall {
    mainConfig: string; // The function call part, e.g., "LINE_CHART(x: "time")"
    on?: string[]; // Array of query references, e.g., ["1", "my_view"]
    width?: string; // e.g., "100px", "50%"
    height?: string; // e.g., "300px"
    zoom?: number;
    title?: string;
    linkX?: [string, string];
    linkXMaster?: boolean;
    linkXClamp?: boolean;
}

/**
 * Parses a single plot configuration line to separate the main function call
 * from advanced clauses like ON, WIDTH, and HEIGHT. It is robust to the order
 * of these clauses.
 * @param configLine The raw string for a single plot call.
 * @returns A ParsedPlotCall object.
 */
export const parsePlotCall = (configLine: string): ParsedPlotCall => {
    let remainingConfig = configLine.trim();
    const result: ParsedPlotCall = { mainConfig: '' };

    // Regexes are anchored to the end of the string to be matched and stripped safely.
    const clauses = [
        { key: 'title', regex: /(?<!\w)TITLE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (match: RegExpMatchArray) => match[1] || match[2] },
        { key: 'zoom', regex: /(?<!\w)ZOOM\s+([\d\.]+)\s*$/i, processor: (match: RegExpMatchArray) => parseFloat(match[1]) },
        { key: 'height', regex: /(?<!\w)HEIGHT\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (match: RegExpMatchArray) => match[1] },
        { key: 'width', regex: /(?<!\w)WIDTH\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (match: RegExpMatchArray) => match[1] },
        { key: 'on', regex: /(?<!\w)ON\s+((?:\w+|\d+)(?:\s*,\s*(?:\w+|\d+))*)\s*$/i, processor: (match: RegExpMatchArray) => match[1].split(',').map(s => s.trim()) },
    ];

    let changedInLoop = true;
    // Repeatedly try to match and strip clauses from the end until no more can be found.
    while(changedInLoop) {
        changedInLoop = false;
        for (const clause of clauses) {
            // Only process a clause if it hasn't been found yet
            if ((result as any)[clause.key] !== undefined) {
                continue;
            }

            const match = remainingConfig.match(clause.regex);
            if (match) {
                (result as any)[clause.key] = clause.processor(match);
                remainingConfig = remainingConfig.substring(0, match.index).trim();
                changedInLoop = true;
                // Restart the loop to check all clauses again from the new end of the string
                break; 
            }
        }
    }
    
    // After stripping other clauses, parse the LINK_X clause specifically.
    const linkXMatch = remainingConfig.match(/(?<!\w)LINK_X\s*\(([^)]+)\)\s*$/i);
    if (linkXMatch) {
        const linkArgs = linkXMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const variables = linkArgs.filter(arg => arg.startsWith('$'));
        const options = linkArgs.filter(arg => !arg.startsWith('$'));
        // Always trim the LINK_X expression from remainingConfig when matched, even if args are invalid.
        remainingConfig = remainingConfig.substring(0, linkXMatch.index).trim();
        if (variables.length >= 2) {
            result.linkX = [variables[0], variables[1]];
            result.linkXMaster = options.includes('master');
            result.linkXClamp = options.includes('clamp');
        }
    }

    // Run the clause loop again so that WIDTH/HEIGHT (and others) that were
    // blocked by a trailing LINK_X get stripped now that LINK_X is gone.
    changedInLoop = true;
    while (changedInLoop) {
        changedInLoop = false;
        for (const clause of clauses) {
            if ((result as any)[clause.key] !== undefined) {
                continue;
            }
            const match = remainingConfig.match(clause.regex);
            if (match) {
                (result as any)[clause.key] = clause.processor(match);
                remainingConfig = remainingConfig.substring(0, match.index).trim();
                changedInLoop = true;
                break;
            }
        }
    }

    result.mainConfig = remainingConfig;
    return result;
};