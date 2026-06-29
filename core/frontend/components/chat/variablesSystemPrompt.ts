// Builds a one-line system-prompt fragment telling the AI which notebook
// variables exist. Variables are referenced in SQL as `$name`. Returns an
// empty string when no variables are set so callers can join unconditionally.

export function variablesSystemPromptLine(vars: Record<string, string> | undefined): string {
    if (!vars) return '';
    const names = Object.keys(vars);
    if (names.length === 0) return '';
    const pretty = names.map(n => `$${n}`).sort().join(', ');
    return `Available notebook variables (referenced in SQL as $name): ${pretty}. Use listVariables to read their values, setVariable to create/update, deleteVariable to remove.`;
}
