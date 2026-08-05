// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { VariableInputWidget } from '../components/VariableInputWidgets';

describe('VariableInputWidget — slider', () => {
    it('renders a range input for input=slider', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="slider"
                varName="$n"
                currentValue="50"
                attrs={{ min: '0', max: '100', step: '1' }}
                onChange={onChange}
            />
        );
        expect(container.querySelector('input[type="range"]')).toBeTruthy();
    });

    it('calls onChange with new value when slider moves', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="slider"
                varName="$n"
                currentValue="50"
                attrs={{ min: '0', max: '100', step: '1' }}
                onChange={onChange}
            />
        );
        const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
        fireEvent.change(slider, { target: { value: '75' } });
        expect(onChange).toHaveBeenCalledWith('$n', '75');
    });
});

describe('VariableInputWidget — dropdown', () => {
    it('renders a select element for input=dropdown', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="dropdown"
                varName="$col"
                currentValue="name"
                attrs={{ options: 'name,value,date' }}
                onChange={onChange}
            />
        );
        expect(container.querySelector('select')).toBeTruthy();
    });

    it('calls onChange when a new option is selected', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="dropdown"
                varName="$col"
                currentValue="name"
                attrs={{ options: 'name,value,date' }}
                onChange={onChange}
            />
        );
        const select = container.querySelector('select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'date' } });
        expect(onChange).toHaveBeenCalledWith('$col', 'date');
    });
});

describe('VariableInputWidget — datetime', () => {
    it('renders a datetime-local input for input=datetime', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="datetime"
                varName="$ts"
                currentValue=""
                attrs={{}}
                onChange={onChange}
            />
        );
        expect(container.querySelector('input[type="datetime-local"]')).toBeTruthy();
    });
});
