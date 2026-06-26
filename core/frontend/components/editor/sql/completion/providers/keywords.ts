// Keyword provider — surfaces clause-appropriate SQL keywords.

import type { Completion } from '@codemirror/autocomplete';
import type { CompletionProvider, ProviderContext } from '../types';
import type { SqlClause } from '../../ast';
import {
    SQL_KEYWORDS_AFTER_FROM,
    SQL_KEYWORDS_AFTER_GROUP_BY,
    SQL_KEYWORDS_AFTER_JOIN_ON,
    SQL_KEYWORDS_AFTER_ORDER_BY,
    SQL_KEYWORDS_AFTER_SELECT,
    SQL_KEYWORDS_AFTER_WHERE,
    SQL_KEYWORDS_AT_TOP,
} from '../../../sqlFunctions';
import { VALID_FOR_IDENT } from '../helpers';

function keywordsForClause(clause: SqlClause | null): string[] {
    switch (clause) {
        case 'select': return SQL_KEYWORDS_AFTER_SELECT;
        case 'from': return SQL_KEYWORDS_AFTER_FROM;
        case 'join': return SQL_KEYWORDS_AFTER_FROM;
        case 'where': return SQL_KEYWORDS_AFTER_WHERE;
        case 'having': return SQL_KEYWORDS_AFTER_WHERE;
        case 'on': return SQL_KEYWORDS_AFTER_JOIN_ON;
        case 'groupBy': return SQL_KEYWORDS_AFTER_GROUP_BY;
        case 'orderBy': return SQL_KEYWORDS_AFTER_ORDER_BY;
        case null: return SQL_KEYWORDS_AT_TOP;
        default: return [];
    }
}

export const keywordProvider: CompletionProvider = {
    name: 'keyword',
    priority: 50,

    matches(_node, ctx) {
        if (ctx.token.includes('.')) return false;
        return true;
    },

    provide(_node, ctx) {
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        const kws = keywordsForClause(ctx.enclosingClause);
        for (const kw of kws) {
            const tag = kw.split(/\s+/)[0].toLowerCase();
            if (lc && !tag.startsWith(lc) && !kw.toLowerCase().startsWith(lc)) continue;
            items.push({
                label: kw,
                detail: 'keyword',
                type: 'keyword',
                apply: kw + ' ',
                boost: 0,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};
