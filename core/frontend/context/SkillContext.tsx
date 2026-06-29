import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { builtinSkillManifest } from '../data/skills/skills-manifest';
import type { SkillMeta, ParsedSkill } from '../utils/skillParser';

interface SkillContextType {
    activeSkills: ParsedSkill[];
    activateSkill: (name: string) => void;
    deactivateSkill: (name: string) => void;
    toggleSkill: (name: string) => void;
    isActive: (name: string) => boolean;
    /** All active skill system prompts joined with a separator. */
    mergedSystemPrompt: string;
    availableSkills: SkillMeta[];
}

export const SkillContext = createContext<SkillContextType>({
    activeSkills: [],
    activateSkill: () => {},
    deactivateSkill: () => {},
    toggleSkill: () => {},
    isActive: () => false,
    mergedSystemPrompt: '',
    availableSkills: [],
});

export const useSkills = () => useContext(SkillContext);

export const SkillContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeSkills, setActiveSkills] = useState<ParsedSkill[]>([]);

    const availableSkills = useMemo(() => builtinSkillManifest.list(), []);

    const activateSkill = useCallback((name: string) => {
        setActiveSkills(prev => {
            if (prev.some(s => s.meta.name === name)) return prev;
            const skill = builtinSkillManifest.load(name);
            return skill ? [...prev, skill] : prev;
        });
    }, []);

    const deactivateSkill = useCallback((name: string) => {
        setActiveSkills(prev => prev.filter(s => s.meta.name !== name));
    }, []);

    const toggleSkill = useCallback((name: string) => {
        setActiveSkills(prev => {
            if (prev.some(s => s.meta.name === name)) {
                return prev.filter(s => s.meta.name !== name);
            }
            const skill = builtinSkillManifest.load(name);
            return skill ? [...prev, skill] : prev;
        });
    }, []);

    const isActive = useCallback((name: string) => {
        return activeSkills.some(s => s.meta.name === name);
    }, [activeSkills]);

    const mergedSystemPrompt = useMemo(() => {
        return activeSkills.map(s => s.systemPrompt).filter(Boolean).join('\n\n---\n\n');
    }, [activeSkills]);

    return (
        <SkillContext.Provider value={{ activeSkills, activateSkill, deactivateSkill, toggleSkill, isActive, mergedSystemPrompt, availableSkills }}>
            {children}
        </SkillContext.Provider>
    );
};
