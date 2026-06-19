package me.bechberger.jfr.duckdb.util;

import io.jafar.parser.api.ArrayType;
import io.jafar.parser.api.ComplexType;
import io.jafar.parser.internal_api.metadata.MetadataAnnotation;
import io.jafar.parser.internal_api.metadata.MetadataClass;
import io.jafar.parser.internal_api.metadata.MetadataField;

import java.util.List;
import java.util.Map;

/**
 * Typed accessors and annotation lookup helpers for {@code Map<String,Object>} event values
 * produced by jafar's {@link io.jafar.parser.api.UntypedJafarParser}.
 *
 * <p>jafar wraps struct values in {@link ComplexType} (whose {@code getValue()} returns the
 * inner map) and array values in {@link ArrayType} (whose {@code getArray()} returns
 * {@code Object[]}). String constants surface as {@code Map{"string" -> actualValue}} after
 * {@link #unwrap}. These helpers normalize all of that.
 */
public final class JafarValues {

    private JafarValues() {}

    /**
     * Unwraps jafar's wrapper layers: {@link ComplexType} → its inner map; single-field
     * string-constant-pool structs (e.g. {@code Symbol{string:..}}, {@code GCWhen{when:..}},
     * {@code GCName{name:..}}) → their inner string. Returns the raw value (or {@code null})
     * otherwise.
     */
    public static Object unwrap(Object v) {
        if (v == null) return null;
        if (v instanceof ComplexType ct) v = ct.getValue();
        if (v instanceof Map<?, ?> m && m.size() == 1) {
            Object only = m.values().iterator().next();
            if (only instanceof String) return only;
            if (m.containsKey("string")) return m.get("string");
        }
        return v;
    }

    /** Unwraps an array value to {@code Object[]}, or returns {@code null}. */
    public static Object[] unwrapArray(Object v) {
        if (v == null) return null;
        if (v instanceof ArrayType at) v = at.getArray();
        if (v instanceof Object[] arr) return arr;
        return null;
    }

    /** Unwraps a struct value to its inner field map, or returns {@code null}. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> unwrapStruct(Object v) {
        v = unwrap(v);
        if (v instanceof Map<?, ?> m) return (Map<String, Object>) m;
        return null;
    }

    /**
     * Recursively unwraps every {@link ComplexType}/{@link ArrayType} layer in the value tree,
     * returning a canonical structure built only from {@link Map}, {@link java.util.List},
     * and primitive wrappers. Use this as a cache key when de-duplicating constant-pool entries
     * across chunks: jafar emits a fresh {@code ComplexType} instance per chunk and these instances
     * use identity-based equality, so the original maps are never structurally equal even when
     * the underlying entries are. The deep-unwrapped form has value-based equals/hashCode.
     */
    public static Object deepUnwrap(Object v) {
        v = unwrap(v);
        if (v instanceof Map<?, ?> m) {
            java.util.LinkedHashMap<String, Object> out = new java.util.LinkedHashMap<>(m.size());
            for (var e : m.entrySet()) {
                out.put(String.valueOf(e.getKey()), deepUnwrap(e.getValue()));
            }
            return out;
        }
        if (v instanceof Object[] arr) {
            java.util.ArrayList<Object> out = new java.util.ArrayList<>(arr.length);
            for (Object o : arr) out.add(deepUnwrap(o));
            return out;
        }
        return v;
    }

    public static String getString(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v == null) return null;
        if (v instanceof Map<?, ?> inner) {
            if (inner.size() == 1) {
                Object only = inner.values().iterator().next();
                return only != null ? only.toString() : null;
            }
            Object s = inner.get("string");
            return s != null ? s.toString() : null;
        }
        return v.toString();
    }

    public static Long getLong(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Long l) return l;
        if (v instanceof Integer i) return (long) i;
        if (v instanceof Short s) return (long) s;
        if (v instanceof Byte b) return (long) b;
        return null;
    }

    public static long getLongOr(Map<String, Object> m, String key, long fallback) {
        Long v = getLong(m, key);
        return v != null ? v : fallback;
    }

    public static Integer getInteger(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Integer i) return i;
        if (v instanceof Long l) return (int) (long) l;
        if (v instanceof Short s) return (int) s;
        if (v instanceof Byte b) return (int) b;
        if (v instanceof Character c) return (int) c;
        return null;
    }

    public static Double getDouble(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Double d) return d;
        if (v instanceof Float f) return (double) f;
        if (v instanceof Long l) return (double) l;
        if (v instanceof Integer i) return (double) i;
        return null;
    }

    public static Float getFloat(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Float f) return f;
        if (v instanceof Double d) return (float) (double) d;
        return null;
    }

    public static Boolean getBoolean(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Boolean b) return b;
        return null;
    }

    public static Character getCharacter(Map<String, Object> m, String key) {
        Object v = unwrap(m.get(key));
        if (v instanceof Character c) return c;
        if (v instanceof Integer i) return (char) (int) i;
        if (v instanceof Long l) return (char) (long) l;
        return null;
    }

    /** Returns the inner struct field map for {@code key}, or {@code null}. */
    public static Map<String, Object> getStruct(Map<String, Object> m, String key) {
        return unwrapStruct(m.get(key));
    }

    /** Returns the inner array for {@code key}, or {@code null}. */
    public static Object[] getArray(Map<String, Object> m, String key) {
        return unwrapArray(m.get(key));
    }

    /** True iff {@code field} represents an array (one or more dimensions). */
    public static boolean isArray(MetadataField field) {
        return field.getDimension() > 0;
    }

    /** Looks up an annotation on {@code field} by its fully-qualified type name. */
    public static MetadataAnnotation findAnnotation(MetadataField field, String annotationTypeName) {
        return findAnnotation(field.getAnnotations(), annotationTypeName);
    }

    /** Looks up an annotation on {@code cls} by its fully-qualified type name. */
    public static MetadataAnnotation findAnnotation(MetadataClass cls, String annotationTypeName) {
        return findAnnotation(cls.getAnnotations(), annotationTypeName);
    }

    private static MetadataAnnotation findAnnotation(
            List<MetadataAnnotation> anns, String annotationTypeName) {
        if (anns == null) return null;
        for (MetadataAnnotation a : anns) {
            MetadataClass at = a.getType();
            if (at != null && annotationTypeName.equals(at.getName())) return a;
        }
        return null;
    }

    /** Convenience: annotation value (or {@code null} if missing). */
    public static String getAnnotationValue(MetadataField field, String annotationTypeName) {
        MetadataAnnotation a = findAnnotation(field, annotationTypeName);
        return a != null ? a.getValue() : null;
    }

    /** Convenience: annotation value (or {@code null} if missing). */
    public static String getAnnotationValue(MetadataClass cls, String annotationTypeName) {
        MetadataAnnotation a = findAnnotation(cls, annotationTypeName);
        return a != null ? a.getValue() : null;
    }
}
