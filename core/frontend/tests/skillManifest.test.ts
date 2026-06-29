import { describe, it, expect } from 'vitest';
import { builtinSkillManifest } from '../data/skills/skills-manifest';

describe('builtinSkillManifest.list()', () => {
    it('returns at least 5 skills', () => {
        const skills = builtinSkillManifest.list();
        expect(skills.length).toBeGreaterThanOrEqual(5);
    });

    it('all skills have name, title, and commands array', () => {
        for (const skill of builtinSkillManifest.list()) {
            expect(typeof skill.name).toBe('string');
            expect(skill.name.length).toBeGreaterThan(0);
            expect(typeof skill.title).toBe('string');
            expect(skill.title.length).toBeGreaterThan(0);
            expect(Array.isArray(skill.commands)).toBe(true);
        }
    });

    it('expected skill names are present', () => {
        const names = builtinSkillManifest.list().map(s => s.name);
        expect(names).toContain('gc-analysis');
        expect(names).toContain('heap-allocation');
        expect(names).toContain('jvm-threads');
        expect(names).toContain('exceptions');
        expect(names).toContain('flamegraph');
    });

    it('skills have tags arrays', () => {
        for (const skill of builtinSkillManifest.list()) {
            expect(Array.isArray(skill.tags)).toBe(true);
        }
    });
});

describe('builtinSkillManifest.load()', () => {
    it('loads gc-analysis with non-empty systemPrompt', () => {
        const skill = builtinSkillManifest.load('gc-analysis');
        expect(skill).not.toBeNull();
        expect(skill!.systemPrompt.length).toBeGreaterThan(50);
    });

    it('gc-analysis systemPrompt mentions GarbageCollection', () => {
        const skill = builtinSkillManifest.load('gc-analysis')!;
        expect(skill.systemPrompt).toContain('GarbageCollection');
    });

    it('returns null for unknown skill name', () => {
        expect(builtinSkillManifest.load('nonexistent-skill-xyz')).toBeNull();
    });

    it('all command.cells references exist in loaded skill.cells map', () => {
        for (const meta of builtinSkillManifest.list()) {
            const skill = builtinSkillManifest.load(meta.name)!;
            expect(skill).not.toBeNull();
            for (const cmd of skill.meta.commands) {
                for (const cellName of cmd.cells) {
                    expect(
                        skill.cells.has(cellName),
                        `skill "${meta.name}" command "${cmd.name}" references cell "${cellName}" which is missing`
                    ).toBe(true);
                }
            }
        }
    });

    it('all loaded skills have non-empty systemPrompt', () => {
        for (const meta of builtinSkillManifest.list()) {
            const skill = builtinSkillManifest.load(meta.name)!;
            expect(skill.systemPrompt.trim().length, `skill "${meta.name}" has empty systemPrompt`).toBeGreaterThan(0);
        }
    });

    it('loads heap-allocation with alloc-top-classes cell', () => {
        const skill = builtinSkillManifest.load('heap-allocation')!;
        expect(skill.cells.has('alloc-top-classes')).toBe(true);
    });

    it('loaded skill cells contain SQL', () => {
        for (const meta of builtinSkillManifest.list()) {
            const skill = builtinSkillManifest.load(meta.name)!;
            for (const [cellName, content] of skill.cells) {
                expect(content, `cell "${cellName}" in skill "${meta.name}" has no SQL`).toContain('SELECT');
            }
        }
    });
});
