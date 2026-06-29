import { describe, it, expect } from 'vitest';
import {
    parseSkillFrontMatter,
    parseSkillBody,
    parseFullSkill,
    type SkillCommand,
} from '../utils/skillParser';

// ---- fixture ----------------------------------------------------------------

const GC_FIXTURE = `---
title: GC Analysis Expert
description: GC domain knowledge for JFR notebooks
tags: [gc, jvm, performance]
icon: "♻"
commands:
  - name: overview
    description: "Insert GC overview cells"
    cells: [gc-overview, gc-summary]
  - name: pauses
    description: "Show worst GC pauses"
    cells: [gc-pauses]
  - name: help
    description: "Show help"
    cells: []
license: MIT
templates: []
---

## System Prompt

You are a JVM GC expert. Focus on GarbageCollection and GCPhasePause tables.

## Cells

<!-- @skill-cell name=gc-overview -->

## GC Overview

\`\`\`sql
SELECT COUNT(*) FROM GarbageCollection
\`\`\`

<!-- @skill-cell name=gc-summary -->

## GC Summary

\`\`\`sql
SELECT cause, COUNT(*) FROM GarbageCollection GROUP BY cause
\`\`\`

<!-- @skill-cell name=gc-pauses -->

## Long Pauses

\`\`\`sql
SELECT longestPause FROM GarbageCollection ORDER BY longestPause DESC LIMIT 10
\`\`\`
`;

const NO_COMMANDS_FIXTURE = `---
title: Minimal Skill
description: Has no commands
tags: []
---

## System Prompt

Just a system prompt.
`;

const MALFORMED_FIXTURE = `---
title: Malformed
commands:
  not a real yaml list at all ###
---

## System Prompt
Still extractable.
`;

// ---- parseSkillFrontMatter --------------------------------------------------

describe('parseSkillFrontMatter', () => {
    it('extracts title', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.title).toBe('GC Analysis Expert');
    });

    it('extracts description', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.description).toBe('GC domain knowledge for JFR notebooks');
    });

    it('extracts tags', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.tags).toEqual(['gc', 'jvm', 'performance']);
    });

    it('extracts icon', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.icon).toBe('♻');
    });

    it('extracts license', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.license).toBe('MIT');
    });

    it('uses fallbackName as name', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.name).toBe('gc-analysis');
    });

    it('parses commands array with name, description, cells', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.commands).toHaveLength(3);

        const overview = meta.commands.find(c => c.name === 'overview')!;
        expect(overview).toBeDefined();
        expect(overview.description).toBe('Insert GC overview cells');
        expect(overview.cells).toEqual(['gc-overview', 'gc-summary']);

        const pauses = meta.commands.find(c => c.name === 'pauses')!;
        expect(pauses.cells).toEqual(['gc-pauses']);

        const help = meta.commands.find(c => c.name === 'help')!;
        expect(help.cells).toEqual([]);
    });

    it('returns empty commands array when no commands key', () => {
        const meta = parseSkillFrontMatter(NO_COMMANDS_FIXTURE, 'minimal');
        expect(meta.commands).toEqual([]);
    });

    it('returns empty commands array on malformed YAML in commands block', () => {
        const meta = parseSkillFrontMatter(MALFORMED_FIXTURE, 'malformed');
        // should not throw, just return empty or partial
        expect(Array.isArray(meta.commands)).toBe(true);
    });

    it('sets source to builtin', () => {
        const meta = parseSkillFrontMatter(GC_FIXTURE, 'gc-analysis');
        expect(meta.source).toBe('builtin');
    });
});

// ---- parseSkillBody ---------------------------------------------------------

describe('parseSkillBody', () => {
    it('extracts the system prompt section', () => {
        const { systemPrompt } = parseSkillBody(GC_FIXTURE);
        expect(systemPrompt).toContain('JVM GC expert');
        expect(systemPrompt).toContain('GarbageCollection');
    });

    it('returns empty string if no ## System Prompt heading', () => {
        const raw = '---\ntitle: x\n---\n\n## Cells\n<!-- @skill-cell name=a -->\ncontent';
        const { systemPrompt } = parseSkillBody(raw);
        expect(systemPrompt).toBe('');
    });

    it('extracts cells map keyed by skill-cell name', () => {
        const { cells } = parseSkillBody(GC_FIXTURE);
        expect(cells.size).toBe(3);
        expect(cells.has('gc-overview')).toBe(true);
        expect(cells.has('gc-summary')).toBe(true);
        expect(cells.has('gc-pauses')).toBe(true);
    });

    it('cell content contains the SQL', () => {
        const { cells } = parseSkillBody(GC_FIXTURE);
        expect(cells.get('gc-overview')).toContain('SELECT COUNT(*) FROM GarbageCollection');
    });

    it('trims whitespace from cell content', () => {
        const { cells } = parseSkillBody(GC_FIXTURE);
        const content = cells.get('gc-overview')!;
        expect(content.startsWith('## GC Overview')).toBe(true);
        expect(content).not.toMatch(/^\s+/);
    });

    it('returns empty cells map if no ## Cells heading', () => {
        const { cells } = parseSkillBody(NO_COMMANDS_FIXTURE);
        expect(cells.size).toBe(0);
    });
});

// ---- parseFullSkill ---------------------------------------------------------

describe('parseFullSkill', () => {
    it('returns combined meta + systemPrompt + cells', () => {
        const skill = parseFullSkill(GC_FIXTURE, 'gc-analysis');
        expect(skill.meta.name).toBe('gc-analysis');
        expect(skill.meta.title).toBe('GC Analysis Expert');
        expect(skill.systemPrompt).toContain('JVM GC expert');
        expect(skill.cells.size).toBe(3);
    });

    it('all command.cells references exist in skill.cells map', () => {
        const skill = parseFullSkill(GC_FIXTURE, 'gc-analysis');
        for (const cmd of skill.meta.commands) {
            for (const cellName of cmd.cells) {
                expect(skill.cells.has(cellName), `command "${cmd.name}" references cell "${cellName}" which is missing`).toBe(true);
            }
        }
    });

    it('stores the raw source', () => {
        const skill = parseFullSkill(GC_FIXTURE, 'gc-analysis');
        expect(skill.raw).toBe(GC_FIXTURE);
    });
});
