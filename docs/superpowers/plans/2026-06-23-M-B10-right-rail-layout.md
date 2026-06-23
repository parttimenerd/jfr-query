# M-B10: Right-Rail Layout — Issues + AI Chat Stub

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Restructure the right rail so it hosts both the Issues panel (M-B5) and a Chat panel stub. The rail gets a two-tab strip (`ISSUES` / `CHAT`) using a full `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA pattern. The Chat tab renders a placeholder message "AI assistant coming in Phase D". The right rail can be toggled with `⌥H`. This milestone is load-bearing: it locks in the layout contract that M-D1 fills with real AI chat content, preventing a layout refactor in Phase D.

**Blocked by:** M-B5 (IssuesPanel — already written).

**Tech stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright.

---

## Pre-resolved decisions

### DECISION 1: RightRail replaces bare IssuesPanel in AppShell

`AppShell.tsx` currently mounts `<IssuesPanel />` directly. This milestone swaps it for `<RightRail />`. `RightRail` is a self-contained component that owns the tab strip, the active tab state, and the `⌥H` collapse toggle. `IssuesPanel` is unchanged — it's rendered inside the `ISSUES` tab panel as a child.

### DECISION 2: Tab architecture — controlled by local state

`RightRail` uses local `useState` for both `activeTab: 'issues' | 'chat'` and `collapsed: boolean`. Neither is hoisted to context or persisted to `localStorage` in this milestone. Persistence of collapse state is a nice-to-have for a future pass. Rationale: M-B7's `ActivityFeedPanel` also chose ephemeral collapse state; consistency matters more than persistence here.

### DECISION 3: ⌥H keyboard shortcut

`RightRail` registers a `keydown` listener for `altKey && key === 'h'` (lowercase) in a `useEffect`. The toggle announces itself via an `aria-live="polite"` visually-hidden span so screen readers hear "Right rail hidden" / "Right rail shown". The shortcut is scoped globally (not focus-trapped) consistent with M-B7's `⌥H` for the activity feed.

### DECISION 4: Tab strip ARIA pattern

Follows WAI-ARIA Tabs Pattern 1.1 with keyboard support:
- `role="tablist"` on the strip container, `aria-label="Right rail tabs"`
- `role="tab"` on each tab button with `aria-selected`, `aria-controls` pointing to the panel id
- `role="tabpanel"` on each panel div with `aria-labelledby` pointing to its tab id
- Arrow keys (Left/Right) move focus between tabs (roving tabindex: active tab `tabindex="0"`, inactive `tabindex="-1"`)
- Activating a tab (Enter/Space or arrow key focus) shows the corresponding panel
- Only the active panel is rendered (or shown; rendering both but hiding one is acceptable — we render both and use `hidden` attribute for the inactive panel to preserve IssuesPanel's scroll position)

### DECISION 5: Collapsed vs. visible state

When collapsed (`⌥H` pressed), the entire rail is hidden: `width: 0; overflow: hidden`. The collapse button within the rail header is inaccessible when the rail is hidden. A separate restore button is needed. The implementation adds a small `>` edge-reveal button outside the rail (attached to the layout's right edge) that re-expands it. This follows the same pattern as the left sidebar toggle in `AppShell`. A `data-testid="right-rail-restore-button"` attribute is added to the edge button.

Alternatively, for simplicity in this milestone: when collapsed, the rail shrinks to `width: 40px` (same as `IssuesPanel` collapsed state) showing only a restore toggle. The `⌥H` shortcut toggles between `w-10` (collapsed) and `w-[280px]` (expanded). This matches `IssuesPanel`'s existing pattern and requires no new edge-reveal button.

**Resolution:** Use the `w-10` collapsed pattern (mirrors `IssuesPanel`). The collapse button is visible at `w-10` as an icon.

### DECISION 6: Chat stub content

When the CHAT tab is active, a `ChatStub` sub-component renders:
```
[Robot icon]
AI assistant coming in Phase D
Connect a Gemini API key in settings to enable.
```
It carries `data-testid="chat-stub"`. This is the contract surface for M-D1 to swap out.

### DECISION 7: data-testid attributes

- `data-testid="right-rail"` on the `<aside>` root
- `data-testid="right-rail-tablist"` on the `role="tablist"` container
- `data-testid="right-rail-tab-issues"` on the ISSUES tab button
- `data-testid="right-rail-tab-chat"` on the CHAT tab button
- `data-testid="right-rail-panel-issues"` on the ISSUES panel
- `data-testid="right-rail-panel-chat"` on the CHAT panel
- `data-testid="right-rail-collapse-btn"` on the collapse/expand toggle button
- `data-testid="chat-stub"` on the chat placeholder content

### DECISION 8: IssuesPanel stays self-contained

`IssuesPanel` currently manages its own collapsed state and width. Inside `RightRail`, the ISSUES panel fills the full height of the panel area. The `IssuesPanel`'s own internal collapse toggle (its `«`/`»` button) must be hidden or suppressed — it would conflict with `RightRail`'s own collapse toggle. The implementation passes an `embedded` prop to `IssuesPanel`; when `embedded={true}`, the internal toggle is hidden and `IssuesPanel` takes `w-full h-full` always.

However, modifying `IssuesPanel` to accept an `embedded` prop requires touching a file that is owned by M-B5. This is acceptable — M-B10 explicitly modifies `IssuesPanel` to add the `embedded` prop as a backward-compatible optional boolean (default `false`).

---

## Steps

### Step 1 — Write failing tests for RightRail

- [ ] **1.1** Create `frontend-v2/src/__tests__/shell/RightRail.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSX } from 'react';
import { RightRail } from '../../components/shell/RightRail';
import { DiagnosticsProvider } from '../../services/diagnostics/DiagnosticsProvider';

// Wrap in diagnostics provider so IssuesPanel can read diagnostics
function Wrapper(): JSX.Element {
  return (
    <DiagnosticsProvider>
      <RightRail />
    </DiagnosticsProvider>
  );
}

describe('RightRail — tab behaviour', () => {
  it('renders ISSUES tab as selected by default', () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    expect(issuesTab).toHaveAttribute('aria-selected', 'true');
    const chatTab = screen.getByTestId('right-rail-tab-chat');
    expect(chatTab).toHaveAttribute('aria-selected', 'false');
  });

  it('shows ISSUES panel when ISSUES tab is selected', () => {
    render(<Wrapper />);
    const issuesPanel = screen.getByTestId('right-rail-panel-issues');
    expect(issuesPanel).not.toHaveAttribute('hidden');
    const chatPanel = screen.getByTestId('right-rail-panel-chat');
    expect(chatPanel).toHaveAttribute('hidden');
  });

  it('switches to CHAT tab when CHAT tab is clicked', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    expect(screen.getByTestId('right-rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('right-rail-tab-issues')).toHaveAttribute('aria-selected', 'false');
  });

  it('shows CHAT panel and hides ISSUES panel after switching', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    expect(screen.getByTestId('right-rail-panel-chat')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('right-rail-panel-issues')).toHaveAttribute('hidden');
  });

  it('renders "AI assistant coming in Phase D" in chat panel', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    const chatPanel = screen.getByTestId('right-rail-panel-chat');
    expect(within(chatPanel).getByText(/AI assistant coming in Phase D/i)).toBeInTheDocument();
  });

  it('switches back to ISSUES tab when ISSUES tab is clicked again', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    await userEvent.click(screen.getByTestId('right-rail-tab-issues'));
    expect(screen.getByTestId('right-rail-tab-issues')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RightRail — ⌥H collapse toggle', () => {
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is expanded by default', () => {
    render(<Wrapper />);
    const rail = screen.getByTestId('right-rail');
    expect(rail).not.toHaveAttribute('data-collapsed', 'true');
  });

  it('collapses when ⌥H is pressed', async () => {
    render(<Wrapper />);
    await userEvent.keyboard('{Alt>}h{/Alt}');
    const rail = screen.getByTestId('right-rail');
    expect(rail).toHaveAttribute('data-collapsed', 'true');
  });

  it('expands again when ⌥H is pressed a second time', async () => {
    render(<Wrapper />);
    await userEvent.keyboard('{Alt>}h{/Alt}');
    await userEvent.keyboard('{Alt>}h{/Alt}');
    const rail = screen.getByTestId('right-rail');
    expect(rail).not.toHaveAttribute('data-collapsed', 'true');
  });

  it('collapse button click also toggles collapsed state', async () => {
    render(<Wrapper />);
    const btn = screen.getByTestId('right-rail-collapse-btn');
    await userEvent.click(btn);
    expect(screen.getByTestId('right-rail')).toHaveAttribute('data-collapsed', 'true');
    await userEvent.click(btn);
    expect(screen.getByTestId('right-rail')).not.toHaveAttribute('data-collapsed', 'true');
  });
});

describe('RightRail — ARIA structure', () => {
  it('has role="tablist" on tab strip', () => {
    render(<Wrapper />);
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveAttribute('aria-label', 'Right rail tabs');
  });

  it('each tab has role="tab"', () => {
    render(<Wrapper />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
  });

  it('each tab has aria-controls pointing to its panel', () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    const chatTab = screen.getByTestId('right-rail-tab-chat');
    const issuesPanel = screen.getByTestId('right-rail-panel-issues');
    const chatPanel = screen.getByTestId('right-rail-panel-chat');

    expect(issuesTab).toHaveAttribute('aria-controls', issuesPanel.id);
    expect(chatTab).toHaveAttribute('aria-controls', chatPanel.id);
  });

  it('each panel has role="tabpanel"', () => {
    render(<Wrapper />);
    const panels = screen.getAllByRole('tabpanel');
    // Both panels are rendered (one hidden); getAllByRole sees all
    expect(panels).toHaveLength(2);
  });

  it('each panel has aria-labelledby pointing to its tab', () => {
    render(<Wrapper />);
    const issuesPanel = screen.getByTestId('right-rail-panel-issues');
    const chatPanel = screen.getByTestId('right-rail-panel-chat');
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    const chatTab = screen.getByTestId('right-rail-tab-chat');

    expect(issuesPanel).toHaveAttribute('aria-labelledby', issuesTab.id);
    expect(chatPanel).toHaveAttribute('aria-labelledby', chatTab.id);
  });

  it('active tab has tabindex 0, inactive has tabindex -1', () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    const chatTab = screen.getByTestId('right-rail-tab-chat');
    expect(issuesTab).toHaveAttribute('tabindex', '0');
    expect(chatTab).toHaveAttribute('tabindex', '-1');
  });
});

describe('RightRail — keyboard navigation', () => {
  it('ArrowRight moves focus from ISSUES to CHAT tab', async () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    issuesTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('right-rail-tab-chat')).toHaveFocus();
  });

  it('ArrowLeft moves focus from CHAT back to ISSUES tab', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    const chatTab = screen.getByTestId('right-rail-tab-chat');
    chatTab.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('right-rail-tab-issues')).toHaveFocus();
  });

  it('ArrowRight from last tab wraps to first', async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByTestId('right-rail-tab-chat'));
    const chatTab = screen.getByTestId('right-rail-tab-chat');
    chatTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('right-rail-tab-issues')).toHaveFocus();
  });

  it('ArrowLeft from first tab wraps to last', async () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    issuesTab.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('right-rail-tab-chat')).toHaveFocus();
  });

  it('Enter activates focused tab', async () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    issuesTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('right-rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  });

  it('Space activates focused tab', async () => {
    render(<Wrapper />);
    const issuesTab = screen.getByTestId('right-rail-tab-issues');
    issuesTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');
    expect(screen.getByTestId('right-rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **1.2** Run `npm run test -- RightRail` — all tests fail (component not yet created).

---

### Step 2 — Add `embedded` prop to IssuesPanel

- [ ] **2.1** Update `frontend-v2/src/components/issues/IssuesPanel.tsx` — add optional `embedded` prop that hides the internal collapse toggle and forces full-size:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useDiagnostics } from '../../services/diagnostics/useDiagnostics';
import { DiagnosticRow } from './DiagnosticRow';

const COLLAPSED_KEY = 'jfr-notebook.issuesPanel.collapsed';

function loadCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === 'true';
}

function saveCollapsed(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(COLLAPSED_KEY, value ? 'true' : 'false');
}

interface IssuesPanelProps {
  /**
   * When true, the panel fills its parent container without its own collapse toggle.
   * Used by RightRail to avoid conflicting collapse behaviours.
   */
  embedded?: boolean;
}

export function IssuesPanel({ embedded = false }: IssuesPanelProps): JSX.Element {
  const diagnostics = useDiagnostics();
  const [collapsed, setCollapsed] = useState<boolean>(embedded ? false : loadCollapsed());
  const previousKeys = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState<string>('');

  useEffect(() => {
    const next = new Set(
      diagnostics.map((d) => `${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`)
    );
    const added: string[] = [];
    for (const d of diagnostics) {
      const k = `${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`;
      if (!previousKeys.current.has(k)) added.push(d.kind);
    }
    previousKeys.current = next;
    if (added.length > 0) {
      setAnnouncement(
        `${added.length} new diagnostic${added.length === 1 ? '' : 's'}: ${added
          .slice(0, 3)
          .join(', ')}`
      );
    }
  }, [diagnostics]);

  function toggle(): void {
    setCollapsed((c) => {
      const next = !c;
      saveCollapsed(next);
      return next;
    });
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  // When embedded, we take full width/height and suppress the standalone collapse toggle
  const sizeClass = embedded
    ? 'w-full h-full'
    : `${collapsed ? 'w-10' : 'w-[280px]'}`;

  return (
    <aside
      role="region"
      aria-label="issues"
      data-testid="issues-panel"
      data-collapsed={(!embedded && collapsed) ? 'true' : 'false'}
      className={`flex h-full flex-col ${embedded ? '' : 'border-l border-[--color-border]'} bg-[--color-bg-surface] transition-[width] ${sizeClass}`}
    >
      <header className="flex h-7 items-center justify-between border-b border-[--color-border] px-2">
        {!embedded && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand issues panel' : 'Collapse issues panel'}
            className="text-[12px] text-[--color-fg-muted] hover:text-[--color-fg-base]"
          >
            {collapsed ? '«' : '»'}
          </button>
        )}
        {(!embedded && !collapsed) || embedded ? (
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[--color-fg-muted]">
            Issues
            {errorCount > 0 && (
              <span className="ml-2 text-[10px] text-[--color-accent-red]">{errorCount}</span>
            )}
            {warningCount > 0 && (
              <span className="ml-1 text-[10px] text-[--color-accent-amber]">{warningCount}</span>
            )}
          </h2>
        ) : (
          <span aria-hidden="true" className="text-[11px] text-[--color-accent-red]">
            {errorCount > 0 ? errorCount : ''}
          </span>
        )}
      </header>
      {(!collapsed || embedded) ? (
        <ul
          className="flex flex-1 flex-col gap-1 overflow-auto p-1"
          role="list"
          aria-label="diagnostic list"
        >
          {diagnostics.length === 0 ? (
            <li className="px-2 py-1 text-[12px] text-[--color-fg-muted]">No diagnostics.</li>
          ) : (
            diagnostics.map((d) => (
              <li key={`${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`}>
                <DiagnosticRow diagnostic={d} />
              </li>
            ))
          )}
        </ul>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only" data-testid="issues-announcement">
        {announcement}
      </div>
    </aside>
  );
}
```

- [ ] **2.2** Run `npm run test -- IssuesPanel` — existing tests must still pass.
- [ ] **2.3** Run `npx tsc --noEmit` — must pass.

---

### Step 3 — Implement ChatStub component

- [ ] **3.1** Create `frontend-v2/src/components/shell/ChatStub.tsx`:

```tsx
import type { JSX } from 'react';

export function ChatStub(): JSX.Element {
  return (
    <div
      data-testid="chat-stub"
      className="flex flex-col items-center justify-center h-full gap-4 px-4 py-8 text-center"
    >
      {/* Robot icon */}
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-fg-dim)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8" y2="16" strokeWidth="2" />
        <line x1="12" y1="16" x2="12" y2="16" strokeWidth="2" />
        <line x1="16" y1="16" x2="16" y2="16" strokeWidth="2" />
      </svg>
      <div>
        <p className="text-[13px] font-medium text-[--color-fg-muted]">
          AI assistant coming in Phase D
        </p>
        <p className="mt-1 text-[12px] text-[--color-fg-dim]">
          Connect a Gemini API key in settings to enable.
        </p>
      </div>
    </div>
  );
}
```

---

### Step 4 — Implement RightRail component

- [ ] **4.1** Create `frontend-v2/src/components/shell/RightRail.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { IssuesPanel } from '../issues/IssuesPanel';
import { ChatStub } from './ChatStub';

type Tab = 'issues' | 'chat';

const TABS: readonly Tab[] = ['issues', 'chat'];
const TAB_LABELS: Record<Tab, string> = {
  issues: 'ISSUES',
  chat: 'CHAT',
};
const TAB_IDS: Record<Tab, string> = {
  issues: 'right-rail-tab-issues-id',
  chat: 'right-rail-tab-chat-id',
};
const PANEL_IDS: Record<Tab, string> = {
  issues: 'right-rail-panel-issues-id',
  chat: 'right-rail-panel-chat-id',
};

export function RightRail(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [collapsed, setCollapsed] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    issues: null,
    chat: null,
  });

  // ⌥H global shortcut
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      setAnnouncement(next ? 'Right rail hidden' : 'Right rail shown');
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tab: Tab): void {
    const idx = TABS.indexOf(tab);

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length];
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = TABS[(idx - 1 + TABS.length) % TABS.length];
      tabRefs.current[prev]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTab(tab);
    }
  }

  return (
    <aside
      data-testid="right-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Right rail"
      className={`flex h-full flex-col border-l border-[--color-border] bg-[--color-bg-surface] transition-[width] ${
        collapsed ? 'w-10 overflow-hidden' : 'w-[280px]'
      }`}
    >
      {/* Collapse toggle */}
      <div className="flex h-7 items-center border-b border-[--color-border] px-1">
        <button
          type="button"
          data-testid="right-rail-collapse-btn"
          aria-label={collapsed ? 'Expand right rail' : 'Collapse right rail'}
          aria-expanded={!collapsed}
          onClick={toggle}
          className="text-[12px] text-[--color-fg-muted] hover:text-[--color-fg-base] px-1"
        >
          {collapsed ? '«' : '»'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Tab strip */}
          <div
            role="tablist"
            data-testid="right-rail-tablist"
            aria-label="Right rail tabs"
            className="flex border-b border-[--color-border]"
          >
            {TABS.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  id={TAB_IDS[tab]}
                  role="tab"
                  data-testid={`right-rail-tab-${tab}`}
                  aria-selected={isActive}
                  aria-controls={PANEL_IDS[tab]}
                  tabIndex={isActive ? 0 : -1}
                  ref={(el) => { tabRefs.current[tab] = el; }}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(e) => handleTabKeyDown(e, tab)}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                    isActive
                      ? 'text-[--color-accent] border-b-2 border-[--color-accent]'
                      : 'text-[--color-fg-muted] hover:text-[--color-fg-base]'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              );
            })}
          </div>

          {/* Tab panels */}
          <div className="flex-1 min-h-0 relative">
            {TABS.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <div
                  key={tab}
                  id={PANEL_IDS[tab]}
                  role="tabpanel"
                  data-testid={`right-rail-panel-${tab}`}
                  aria-labelledby={TAB_IDS[tab]}
                  hidden={!isActive}
                  className="h-full w-full"
                >
                  {tab === 'issues' && <IssuesPanel embedded />}
                  {tab === 'chat' && <ChatStub />}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Aria live region for collapse announcements */}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="right-rail-announcement"
      >
        {announcement}
      </div>
    </aside>
  );
}
```

- [ ] **4.2** Run `npm run test -- RightRail` — all tests must pass.
- [ ] **4.3** Run `npx tsc --noEmit` — must pass.

---

### Step 5 — Update AppShell to use RightRail

- [ ] **5.1** Update `frontend-v2/src/components/shell/AppShell.tsx` — swap `<IssuesPanel />` for `<RightRail />`:

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { JSX } from 'react';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { ErrorBoundary } from './ErrorBoundary';
import type { Notebook } from '../../services/parser/types';
import { DepGraphSource } from '../depGraph/DepGraphSource';
import { RightRail } from './RightRail';
import { SettingsProvider } from '../../context/SettingsContext';
import { CommandPalette } from '../palette/CommandPalette';
import { GlyphLegend } from '../welcome/GlyphLegend';
import { usePaletteHotkey, useGlyphLegendHotkey } from '../palette/usePaletteHotkey';
import type { PaletteContext } from '../../services/palette/types';

interface AppShellProps {
  children: ReactNode;
  notebook?: Notebook;
}

function AppShellInner({ children, notebook }: AppShellProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = usePaletteHotkey();
  const [legendOpen, setLegendOpen] = useGlyphLegendHotkey();

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const paletteCtx: PaletteContext = {
    notebook: notebook
      ? {
          cells: notebook.cells.map((c, i) => ({
            alias: c.alias ?? null,
            displayIndex: i + 1,
            blocks: c.blocks.map((b) => ({ kind: b.kind, source: b.source })),
          })),
        }
      : undefined,
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-[--color-bg-base] text-[--color-fg-base]">
        <Topbar />
        <div className="flex flex-1 min-h-0">
          <div className="flex items-start">
            <Sidebar collapsed={collapsed} />
            <button
              type="button"
              data-testid="sidebar-toggle"
              aria-label="Toggle sidebar"
              onClick={toggle}
              className="m-2 rounded px-2 py-1 text-xs text-[--color-fg-muted] hover:bg-[--color-bg-overlay]"
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>
          <main className="flex-1 overflow-auto">{children}</main>
          <RightRail />
        </div>
        <StatusBar />
        {notebook ? <DepGraphSource notebook={notebook} /> : null}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} context={paletteCtx} />
        <GlyphLegend open={legendOpen} onClose={() => setLegendOpen(false)} />
      </div>
    </ErrorBoundary>
  );
}

export function AppShell({ children, notebook }: AppShellProps): JSX.Element {
  return (
    <SettingsProvider>
      <AppShellInner notebook={notebook}>{children}</AppShellInner>
    </SettingsProvider>
  );
}
```

- [ ] **5.2** Run `npx tsc --noEmit` — must pass.
- [ ] **5.3** Run `npm run test` — full suite must pass.

---

### Step 6 — E2E tests

- [ ] **6.1** Create `frontend-v2/tests/e2e/right-rail.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('RightRail E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="right-rail"]');
  });

  test('@e2e ISSUES tab is selected by default', async ({ page }) => {
    await expect(page.locator('[data-testid="right-rail-tab-issues"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('@e2e clicking CHAT tab switches panel', async ({ page }) => {
    await page.click('[data-testid="right-rail-tab-chat"]');
    await expect(page.locator('[data-testid="right-rail-tab-chat"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[data-testid="chat-stub"]')).toBeVisible();
  });

  test('@e2e CHAT panel shows "AI assistant coming in Phase D"', async ({ page }) => {
    await page.click('[data-testid="right-rail-tab-chat"]');
    await expect(page.locator('[data-testid="chat-stub"]')).toContainText(
      'AI assistant coming in Phase D'
    );
  });

  test('@e2e ⌥H hides the rail', async ({ page }) => {
    await page.keyboard.press('Alt+h');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveAttribute(
      'data-collapsed',
      'true'
    );
  });

  test('@e2e ⌥H twice restores the rail', async ({ page }) => {
    await page.keyboard.press('Alt+h');
    await page.keyboard.press('Alt+h');
    await expect(page.locator('[data-testid="right-rail"]')).not.toHaveAttribute(
      'data-collapsed',
      'true'
    );
  });

  test('@e2e collapse button in rail header toggles collapse', async ({ page }) => {
    await page.click('[data-testid="right-rail-collapse-btn"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveAttribute(
      'data-collapsed',
      'true'
    );
    await page.click('[data-testid="right-rail-collapse-btn"]');
    await expect(page.locator('[data-testid="right-rail"]')).not.toHaveAttribute(
      'data-collapsed',
      'true'
    );
  });

  test('@e2e arrow keys navigate between tabs', async ({ page }) => {
    // Focus the ISSUES tab
    await page.locator('[data-testid="right-rail-tab-issues"]').focus();
    // Press ArrowRight to move to CHAT
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="right-rail-tab-chat"]')).toBeFocused();
  });

  test('@e2e Enter activates the focused tab', async ({ page }) => {
    await page.locator('[data-testid="right-rail-tab-issues"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="right-rail-tab-chat"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('@e2e issues panel is still functional inside RightRail', async ({ page }) => {
    // Issues panel should be present in the DOM inside the right rail
    await expect(page.locator('[data-testid="issues-panel"]')).toBeVisible();
  });
});
```

- [ ] **6.2** Run `npm run test:e2e -- right-rail` — tests must pass.

---

### Step 7 — Accessibility tests

- [ ] **7.1** Create `frontend-v2/tests/e2e/a11y-right-rail.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y RightRail Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="right-rail"]');
  });

  test('right rail with ISSUES tab has no axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .include('[data-testid="right-rail"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('right rail with CHAT tab has no axe violations', async ({ page }) => {
    await page.click('[data-testid="right-rail-tab-chat"]');
    const results = await new AxeBuilder({ page })
      .include('[data-testid="right-rail"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('tab strip has correct ARIA roles', async ({ page }) => {
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible();
    await expect(tablist).toHaveAttribute('aria-label', 'Right rail tabs');

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);

    const panels = page.locator('[role="tabpanel"]');
    // Both panels rendered, one hidden; visible count = 1
    await expect(panels.first()).toBeAttached();
  });

  test('collapse button has descriptive aria-label', async ({ page }) => {
    const btn = page.locator('[data-testid="right-rail-collapse-btn"]');
    await expect(btn).toHaveAttribute('aria-label', 'Collapse right rail');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  test('collapsed right rail has updated aria-label on toggle button', async ({ page }) => {
    await page.click('[data-testid="right-rail-collapse-btn"]');
    const btn = page.locator('[data-testid="right-rail-collapse-btn"]');
    await expect(btn).toHaveAttribute('aria-label', 'Expand right rail');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('chat stub is accessible', async ({ page }) => {
    await page.click('[data-testid="right-rail-tab-chat"]');
    const results = await new AxeBuilder({ page })
      .include('[data-testid="chat-stub"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });
});
```

- [ ] **7.2** Run `npm run test:a11y -- right-rail` — must pass.

---

### Step 8 — Visual regression tests

- [ ] **8.1** Create `frontend-v2/tests/visual/right-rail.visual.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual RightRail Visual Snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="right-rail"]');
  });

  test('right rail ISSUES tab — light theme', async ({ page }) => {
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-issues-light.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test('right rail ISSUES tab — dark theme', async ({ page }) => {
    await page.click('[data-testid="theme-toggle"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-issues-dark.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test('right rail CHAT tab — light theme', async ({ page }) => {
    await page.click('[data-testid="right-rail-tab-chat"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-chat-light.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test('right rail CHAT tab — dark theme', async ({ page }) => {
    await page.click('[data-testid="theme-toggle"]');
    await page.click('[data-testid="right-rail-tab-chat"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-chat-dark.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test('right rail collapsed — light theme', async ({ page }) => {
    await page.click('[data-testid="right-rail-collapse-btn"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-collapsed-light.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });

  test('right rail collapsed — dark theme', async ({ page }) => {
    await page.click('[data-testid="theme-toggle"]');
    await page.click('[data-testid="right-rail-collapse-btn"]');
    await expect(page.locator('[data-testid="right-rail"]')).toHaveScreenshot(
      'right-rail-collapsed-dark.png',
      { maxDiffPixelRatio: 0.01 }
    );
  });
});
```

- [ ] **8.2** Run `npm run test:visual -- right-rail` — capture baseline snapshots. Second run must pass.

---

### Step 9 — Performance benchmark

- [ ] **9.1** Create `frontend-v2/src/__tests__/shell/RightRail.bench.ts`:

```ts
import { bench, describe } from 'vitest';

type Tab = 'issues' | 'chat';
const TABS: readonly Tab[] = ['issues', 'chat'];

describe('RightRail tab navigation logic', () => {
  bench('compute next tab index (arrow right)', () => {
    const idx = 0; // ISSUES index
    const _next = TABS[(idx + 1) % TABS.length];
  });

  bench('compute prev tab index (arrow left)', () => {
    const idx = 0; // ISSUES index
    const _prev = TABS[(idx - 1 + TABS.length) % TABS.length];
  });

  bench('tab ARIA attribute mapping for 2 tabs', () => {
    const TAB_IDS: Record<Tab, string> = {
      issues: 'right-rail-tab-issues-id',
      chat: 'right-rail-tab-chat-id',
    };
    const PANEL_IDS: Record<Tab, string> = {
      issues: 'right-rail-panel-issues-id',
      chat: 'right-rail-panel-chat-id',
    };

    for (const tab of TABS) {
      const _tid = TAB_IDS[tab];
      const _pid = PANEL_IDS[tab];
    }
  });
});
```

- [ ] **9.2** Run `npm run test:perf -- RightRail` — benchmarks run and produce output.

---

### Step 10 — Final verification

- [ ] **10.1** Run `npm run test` — all unit tests pass.
- [ ] **10.2** Run `npx tsc --noEmit` — no type errors.
- [ ] **10.3** Run `npm run lint` — no lint errors.
- [ ] **10.4** Run `npm run test:e2e -- right-rail` — e2e tests pass.
- [ ] **10.5** Run `npm run test:a11y -- right-rail` — a11y tests pass.
- [ ] **10.6** Run `npm run test:visual -- right-rail` — visual snapshots stable.
- [ ] **10.7** Manual gate check:
  - Right rail shows ISSUES and CHAT tabs
  - Switching tabs works; correct panel is shown
  - ⌥H hides the rail (width collapses to `w-10`)
  - ⌥H again restores the rail
  - Arrow keys cycle between tabs with focus following
  - Chat tab shows "AI assistant coming in Phase D" stub
  - IssuesPanel still functional inside embedded mode

---

## Acceptance criteria

All of the following must be true before marking M-B10 complete:

1. `RightRail` renders a two-tab strip with `ISSUES` and `CHAT` tabs using full WAI-ARIA Tabs pattern.
2. ISSUES tab is active by default; CHAT tab shows the stub.
3. Arrow keys (Left/Right) navigate between tabs with wrapping; Enter/Space activate the focused tab.
4. `⌥H` toggles collapsed state; `data-collapsed` attribute reflects state; rail width transitions between `w-10` and `w-[280px]`.
5. `IssuesPanel` renders in `embedded` mode (no internal collapse toggle; full-size).
6. `AppShell` mounts `<RightRail />` instead of bare `<IssuesPanel />`.
7. Chat stub renders "AI assistant coming in Phase D" text in `data-testid="chat-stub"`.
8. All five test layers pass: unit, E2E, visual, a11y, perf bench.
9. No type errors (`npx tsc --noEmit` clean).
