// Orchestrates the four annotator passes over a parsed AST. Callers pass in
// schema + variable context; the annotators run in dependency order:
//   1. aliasAnnotator   → builds Scope chain, registers CTEs + tableRefs
//   2. schemaAnnotator  → resolves identifiers/qualifiedIdents to columns/tables
//   3. functionAnnotator → resolves functionCall nodes to SQL_FUNCTIONS sigs
//   4. variableAnnotator → resolves $var/$$var/$cell.var refs
//
// All annotators are idempotent — they skip nodes that already have a
// resolution. Safe to re-run after parsing.

import type { Node } from './ast';
import type { TableSchema, ViewSchema } from '../../../types';
import { annotateAliases, type ScopeMap } from './annotators/aliasAnnotator';
import { annotateSchema } from './annotators/schemaAnnotator';
import { annotateFunctions } from './annotators/functionAnnotator';
import {
    annotateVariables,
    type VariableAnnotatorInput,
} from './annotators/variableAnnotator';

export interface AnnotateInput {
    tables: ReadonlyArray<TableSchema>;
    views: ReadonlyArray<ViewSchema>;
    variables?: VariableAnnotatorInput;
}

export interface AnnotateResult {
    scopes: ScopeMap;
}

export function annotate(root: Node, input: AnnotateInput): AnnotateResult {
    const scopes = annotateAliases(root, { tables: input.tables, views: input.views });
    annotateSchema(root, {
        tables: input.tables,
        views: input.views,
        scopeById: scopes,
    });
    annotateFunctions(root);
    if (input.variables) {
        annotateVariables(root, input.variables);
    }
    return { scopes };
}
