import { describe, it, expect } from 'vitest';
import { formatSql } from '../utils/sqlFormatter';

// Cases: `in` is the raw input; `out`, when provided, is the canonical
// formatted form. Every case is also exercised for idempotence
// (`format(format(x)) === format(x)`) and validation-gate safety.
interface Case { name: string; in: string; out?: string; }

const CASES: Case[] = [
    // ---- 1-10: clause keywords + basic SELECT ----
    { name: 'select-star', in: 'select * from t', out: 'SELECT *\nFROM t' },
    { name: 'select-one-col', in: 'select a from t', out: 'SELECT a\nFROM t' },
    { name: 'select-multi-col', in: 'select a, b, c from t', out: 'SELECT\n    a,\n    b,\n    c\nFROM t' },
    { name: 'select-with-where', in: 'select a from t where x=1', out: 'SELECT a\nFROM t\nWHERE x = 1' },
    { name: 'where-and-or', in: "select a from t where x=1 and y=2 or z=3", out: 'SELECT a\nFROM t\nWHERE x = 1 AND y = 2 OR z = 3' },
    { name: 'group-by', in: 'select a, count(*) from t group by a', out: 'SELECT\n    a,\n    COUNT(*)\nFROM t\nGROUP BY a' },
    { name: 'order-by', in: 'select * from t order by a', out: 'SELECT *\nFROM t\nORDER BY a' },
    { name: 'order-by-desc', in: 'select * from t order by a desc', out: 'SELECT *\nFROM t\nORDER BY a DESC' },
    { name: 'limit', in: 'select * from t limit 10', out: 'SELECT *\nFROM t\nLIMIT 10' },
    { name: 'limit-offset', in: 'select * from t limit 10 offset 5', out: 'SELECT *\nFROM t\nLIMIT 10\nOFFSET 5' },

    // ---- 11-20: operators / spacing ----
    { name: 'eq-op', in: "select * from t where a='x'", out: "SELECT *\nFROM t\nWHERE a = 'x'" },
    { name: 'ne-op', in: "select * from t where a<>'x'", out: "SELECT *\nFROM t\nWHERE a <> 'x'" },
    { name: 'lt-op', in: 'select * from t where a<1', out: 'SELECT *\nFROM t\nWHERE a < 1' },
    { name: 'le-op', in: 'select * from t where a<=1', out: 'SELECT *\nFROM t\nWHERE a <= 1' },
    { name: 'gt-op', in: 'select * from t where a>1', out: 'SELECT *\nFROM t\nWHERE a > 1' },
    { name: 'ge-op', in: 'select * from t where a>=1', out: 'SELECT *\nFROM t\nWHERE a >= 1' },
    { name: 'plus', in: 'select a+1 from t', out: 'SELECT a + 1\nFROM t' },
    { name: 'minus', in: 'select a-1 from t', out: 'SELECT a - 1\nFROM t' },
    { name: 'mul', in: 'select a*2 from t', out: 'SELECT a * 2\nFROM t' },
    { name: 'div', in: 'select a/2 from t', out: 'SELECT a / 2\nFROM t' },

    // ---- 21-30: identifiers, quoting ----
    { name: 'qualified-ident', in: 'select e.a from t e', out: 'SELECT e.a\nFROM t e' },
    { name: 'quoted-ident', in: 'select "A B" from t', out: 'SELECT "A B"\nFROM t' },
    { name: 'single-quoted-string', in: "select 'hi' from t", out: "SELECT 'hi'\nFROM t" },
    { name: 'string-with-paren', in: "select * from t where a = 'a(b)c'", out: "SELECT *\nFROM t\nWHERE a = 'a(b)c'" },
    { name: 'string-with-comma', in: "select 'a,b' from t", out: "SELECT 'a,b'\nFROM t" },
    { name: 'string-with-semicolon', in: "select 'a;b' from t", out: "SELECT 'a;b'\nFROM t" },
    { name: 'string-with-newline', in: "select 'a\nb' from t" },
    { name: 'mixed-case-ident', in: 'select MyCol from MyTable', out: 'SELECT MyCol\nFROM MyTable' },
    { name: 'qualified-multi-dot', in: 'select db.schema.t.col from db.schema.t', out: 'SELECT db.schema.t.col\nFROM db.schema.t' },
    { name: 'numeric-literal', in: 'select 1, 2.5, .5, 1e3 from t', out: 'SELECT\n    1,\n    2.5,\n    .5,\n    1e3\nFROM t' },

    // ---- 31-40: functions ----
    { name: 'count-star', in: 'select count(*) from t', out: 'SELECT COUNT(*)\nFROM t' },
    { name: 'lower-func', in: 'select lower(a) from t', out: 'SELECT LOWER(a)\nFROM t' },
    { name: 'multiarg-func', in: 'select coalesce(a,b,c) from t', out: 'SELECT COALESCE(a, b, c)\nFROM t' },
    { name: 'nested-funcs', in: 'select sum(coalesce(a,0)) from t', out: 'SELECT SUM(COALESCE(a, 0))\nFROM t' },
    { name: 'func-with-distinct', in: 'select count(distinct a) from t', out: 'SELECT COUNT(DISTINCT a)\nFROM t' },
    { name: 'cast', in: 'select cast(a as int) from t', out: 'SELECT CAST(a AS INT)\nFROM t' },
    { name: 'try-cast', in: 'select try_cast(a as int) from t', out: 'SELECT TRY_CAST(a AS INT)\nFROM t' },
    { name: 'extract', in: "select extract(year from ts) from t", out: "SELECT EXTRACT(year FROM ts)\nFROM t" },
    { name: 'date-trunc', in: "select date_trunc('hour', ts) from t", out: "SELECT DATE_TRUNC('hour', ts)\nFROM t" },
    { name: 'concat-fn', in: "select concat(a,b) from t", out: "SELECT CONCAT(a, b)\nFROM t" },

    // ---- 41-50: JOINs ----
    { name: 'inner-join', in: 'select * from a join b on a.id=b.id', out: 'SELECT *\nFROM a\nJOIN b ON a.id = b.id' },
    { name: 'left-join', in: 'select * from a left join b on a.id=b.id', out: 'SELECT *\nFROM a\nLEFT JOIN b ON a.id = b.id' },
    { name: 'right-join', in: 'select * from a right join b on a.id=b.id', out: 'SELECT *\nFROM a\nRIGHT JOIN b ON a.id = b.id' },
    { name: 'full-join', in: 'select * from a full join b on a.id=b.id', out: 'SELECT *\nFROM a\nFULL JOIN b ON a.id = b.id' },
    { name: 'cross-join', in: 'select * from a cross join b', out: 'SELECT *\nFROM a\nCROSS JOIN b' },
    { name: 'two-joins', in: 'select * from a join b on a.id=b.id join c on b.id=c.id' },
    { name: 'join-with-alias', in: 'select * from a x join b y on x.id=y.id', out: 'SELECT *\nFROM a x\nJOIN b y ON x.id = y.id' },
    { name: 'using-clause', in: 'select * from a join b using (id)' },
    { name: 'left-outer', in: 'select * from a left outer join b on a.id=b.id' },
    { name: 'inner-keyword', in: 'select * from a inner join b on a.id=b.id', out: 'SELECT *\nFROM a\nINNER JOIN b ON a.id = b.id' },

    // ---- 51-60: subqueries ----
    { name: 'in-subquery', in: 'select * from a where x in (select y from b)' },
    { name: 'exists-subquery', in: 'select * from a where exists (select 1 from b)' },
    { name: 'derived-table', in: 'select * from (select a from t) sub' },
    { name: 'scalar-subquery', in: 'select (select count(*) from b) from a' },
    { name: 'nested-subquery', in: 'select * from a where x in (select y from b where z in (select w from c))' },
    { name: 'subquery-with-where', in: 'select * from a where x in (select y from b where z=1)' },
    { name: 'subquery-aliased', in: 'select s.a from (select a from t) s' },
    { name: 'lateral-join', in: 'select * from a, lateral (select 1) sub' },
    { name: 'in-list', in: "select * from t where a in (1,2,3)", out: "SELECT *\nFROM t\nWHERE a IN (1, 2, 3)" },
    { name: 'not-in-list', in: "select * from t where a not in (1,2)", out: "SELECT *\nFROM t\nWHERE a NOT IN (1, 2)" },

    // ---- 61-70: CTEs ----
    { name: 'simple-cte', in: 'with a as (select 1 x) select * from a' },
    { name: 'multi-cte', in: 'with a as (select 1 x), b as (select 2 y) select * from a, b' },
    { name: 'recursive-cte', in: 'with recursive a as (select 1 x union all select x+1 from a where x<10) select * from a' },
    { name: 'cte-with-group', in: 'with agg as (select host, count(*) c from events group by host) select * from agg' },
    { name: 'nested-cte', in: 'with a as (with b as (select 1 x) select * from b) select * from a' },

    // ---- 71-80: set ops + WHERE/HAVING/QUALIFY ----
    { name: 'union', in: 'select a from t1 union select a from t2', out: 'SELECT a\nFROM t1\nUNION\nSELECT a\nFROM t2' },
    { name: 'union-all', in: 'select a from t1 union all select a from t2' },
    { name: 'intersect', in: 'select a from t1 intersect select a from t2' },
    { name: 'except', in: 'select a from t1 except select a from t2' },
    { name: 'having', in: 'select a, count(*) from t group by a having count(*)>1' },
    { name: 'qualify', in: 'select a, row_number() over (partition by a order by ts) rn from t qualify rn=1' },
    { name: 'window-clause', in: 'select sum(a) over w from t window w as (partition by b)' },
    { name: 'between', in: 'select * from t where a between 1 and 10' },
    { name: 'is-null', in: 'select * from t where a is null' },
    { name: 'is-not-null', in: 'select * from t where a is not null' },

    // ---- 81-90: CASE / control flow ----
    { name: 'case-when', in: 'select case when a=1 then 1 else 0 end from t' },
    { name: 'case-multi-when', in: 'select case when a=1 then 1 when a=2 then 2 else 0 end from t' },
    { name: 'case-no-else', in: 'select case when a=1 then 1 end from t' },
    { name: 'nested-case', in: 'select case when a=1 then case when b=1 then 1 else 2 end else 0 end from t' },
    { name: 'coalesce-vs-case', in: 'select coalesce(a, case when b is null then 0 else b end) from t' },
    { name: 'cast-with-case', in: 'select cast(case when a then 1 else 0 end as int) from t' },
    { name: 'count-with-case', in: 'select count(case when a>0 then 1 end) from t' },
    { name: 'array-literal', in: 'select [1, 2, 3] from t' },
    { name: 'struct-literal', in: "select {'a': 1, 'b': 2} from t" },
    { name: 'array-access', in: 'select a[1] from t' },

    // ---- 91-100: misc / edge cases ----
    { name: 'multi-line-input', in: 'select\na,\nb\nfrom t' },
    { name: 'extra-whitespace', in: '   select   a   from   t   ', out: 'SELECT a\nFROM t' },
    { name: 'trailing-semicolon', in: 'select a from t;' },
    { name: 'line-comment', in: 'select a -- pick a\nfrom t' },
    { name: 'block-comment', in: 'select /* x */ a from t' },
    { name: 'comment-only', in: '-- nothing\n' },
    { name: 'comment-before-from', in: 'select a /* fields */ from t' },
    { name: 'dollar-var', in: 'select * from t where a = $foo' },
    { name: 'concat-op', in: "select a || b from t" },
    { name: 'cast-double-colon', in: 'select a::int from t' },

    // ---- 101-115: extras / stress ----
    { name: 'lowercased-keywords-throughout', in: 'select a, b from t where c=1 order by a', out: 'SELECT\n    a,\n    b\nFROM t\nWHERE c = 1\nORDER BY a' },
    { name: 'distinct', in: 'select distinct a from t', out: 'SELECT DISTINCT a\nFROM t' },
    { name: 'star-alias-table', in: 'select t.* from t' },
    { name: 'group-by-multi', in: 'select a, b, count(*) from t group by a, b' },
    { name: 'order-by-multi', in: 'select * from t order by a, b desc' },
    { name: 'where-nested-paren', in: 'select * from t where (a=1 or b=2) and c=3' },
    { name: 'function-no-args', in: 'select now() from t' },
    { name: 'function-empty-args-spaces', in: 'select count(  *  ) from t', out: 'SELECT COUNT(*)\nFROM t' },
    { name: 'in-string-arr', in: "select * from t where a in ('x','y','z')", out: "SELECT *\nFROM t\nWHERE a IN ('x', 'y', 'z')" },
    { name: 'mixed-quoted-keywords', in: 'SELECT "select" FROM t', out: 'SELECT "select"\nFROM t' },
    { name: 'where-not', in: 'select * from t where not a=1' },
    { name: 'two-statements-via-semi', in: 'select a from t; select b from t' },
    { name: 'select-no-from', in: 'select 1 + 1', out: 'SELECT 1 + 1' },
    { name: 'window-fn-empty-partition', in: 'select row_number() over () from t' },
    { name: 'nested-paren-arith', in: 'select (a+b)*c from t' },
];

describe('SQL formatter — corpus', () => {
    for (const c of CASES) {
        it(c.name, () => {
            const formatted = formatSql(c.in);
            if (c.out !== undefined) {
                expect(formatted).toBe(c.out);
            }
            // Idempotence: formatting an already-formatted string yields the same string.
            expect(formatSql(formatted)).toBe(formatted);
            // Validation-gate safety: never produce empty output for non-empty input.
            if (c.in.trim()) expect(formatted.length).toBeGreaterThan(0);
        });
    }
});

// Explicit shape tests kept from earlier — anchor key behaviours.
describe('SQL formatter — anchors', () => {
    it('uppercases clause keywords', () => {
        expect(formatSql('select * from events')).toBe('SELECT *\nFROM events');
    });

    it('multi-item SELECT breaks each onto its own line', () => {
        const lines = formatSql('select a, b, c from t').split('\n');
        expect(lines[0]).toBe('SELECT');
        expect(lines[1]).toBe('    a,');
        expect(lines[2]).toBe('    b,');
        expect(lines[3]).toBe('    c');
        expect(lines[4]).toBe('FROM t');
    });

    it('subquery in WHERE indents', () => {
        const out = formatSql('select * from a where x in (select y from b)');
        expect(out).toContain('WHERE x IN (\n    SELECT y\n    FROM b\n)');
    });

    it('CTE body indents; closing paren on own line', () => {
        const out = formatSql('with agg as (select host, count(*) c from events group by host) select * from agg');
        expect(out).toContain('WITH agg AS (\n    SELECT');
        expect(out).toContain(')\nSELECT');
    });

    it('handles empty/whitespace input', () => {
        expect(formatSql('')).toBe('');
        expect(formatSql('   ')).toBe('   ');
    });
});
