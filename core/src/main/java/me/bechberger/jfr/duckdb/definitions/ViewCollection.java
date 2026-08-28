/**
 * Copyright (c) 2025, SAP SE or an SAP affiliate company. All rights reserved. Copyright (c) 2023,
 * Oracle and/or its affiliates. All rights reserved. DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR
 * THIS FILE HEADER.
 *
 * <p>This code is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License version 2 only, as published by the Free Software Foundation. Oracle
 * designates this particular file as subject to the "Classpath" exception as provided by Oracle in
 * the LICENSE file that accompanied this code.
 *
 * <p>This code is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * General Public License version 2 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 *
 * <p>You should have received a copy of the GNU General Public License version 2 along with this
 * work; if not, write to the Free Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston,
 * MA 02110-1301 USA.
 *
 * <p>Please contact Oracle, 500 Oracle Parkway, Redwood Shores, CA 94065 USA or visit
 * www.oracle.com if you need additional information or have any questions.
 */
package me.bechberger.jfr.duckdb.definitions;

import static me.bechberger.jfr.duckdb.util.SQLUtil.getTableNames;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import me.bechberger.jfr.duckdb.RuntimeSQLException;
import org.duckdb.DuckDBConnection;

/** Implement all JFR views as defined in the OpenJDK (till 25. September 2025). */
@SuppressWarnings("DanglingJavadoc")
public class ViewCollection {

    private static final View[] views =
            new View[] {
                new View(
                                "active-recordings",
                                "environment",
                                "Active Recordings",
                                "active-recordings",
                                """
                            CREATE VIEW "active-recordings" AS
                            SELECT
                                LAST(recordingStart) AS "Start",
                                LAST(recordingDuration) AS "Duration",
                                LAST(name) AS "Name",
                                LAST(destination) AS "Destination",
                                LAST(maxAge) AS "Max Age",
                                LAST(maxSize) AS "Max Size"
                            FROM ActiveRecording
                            GROUP BY id
                            """,
                                "ActiveRecording")
                        .description(
                                """
                    Shows all active recordings with their start, duration and name.
                    """),
                new View(
                                "active-settings",
                                "environment",
                                "Active Settings",
                                "active-settings",
                                """
                            CREATE VIEW "active-settings" AS
                            SELECT
                                EVENT_NAME_FOR_ID(id) AS "Event Type",
                                MAX(CASE WHEN name = 'enabled' THEN value END) AS "Enabled",
                                MAX(CASE WHEN name = 'threshold' THEN value END) AS "Threshold",
                                MAX(CASE WHEN name = 'stackTrace' THEN value END) AS "Stack Trace",
                                MAX(CASE WHEN name = 'period' THEN value END) AS "Period",
                                MAX(CASE WHEN name = 'cutoff' THEN value END) AS "Cutoff",
                                MAX(CASE WHEN name = 'throttle' THEN value END) AS "Throttle"
                            FROM ActiveSetting
                            GROUP BY id
                            ORDER BY "Event Type"
                            """,
                                "ActiveSetting")
                        .description(
                                """
                    Shows the active settings for all event types.
                    """),
                new View(
                                "allocation-by-class",
                                "application",
                                "Allocation by Class",
                                "allocation-by-class",
                                """
                                 CREATE VIEW "allocation-by-class" AS
                                 SELECT cls.javaName as "Object Type", format_percentage(pressure) as "Allocation Pressure" FROM (SELECT
                                     objectClass AS _objectType,
                                     SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
                                 FROM ObjectAllocationSample
                                 GROUP BY objectClass
                                 ORDER BY pressure DESC
                                 LIMIT 25), Class cls
                                 WHERE _objectType = cls._id
                                 ORDER BY pressure DESC
                            """,
                                "ObjectAllocationSample",
                                "Class")
                        .description(
                                """
                    Shows the classes which have the highest allocation pressure.
                    """),
                new View(
                                "allocation-by-thread",
                                "application",
                                "Allocation by Thread",
                                "allocation-by-thread",
                                """
                                 CREATE VIEW "allocation-by-thread" AS
                                 SELECT th.javaName AS "Thread", format_percentage(pressure) AS "Allocation Pressure" FROM (SELECT
                                     eventThread AS _thread,
                                     SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
                                 FROM ObjectAllocationSample
                                 GROUP BY eventThread
                                 ORDER BY pressure DESC
                                 LIMIT 25), Thread th
                                 WHERE _thread = th._id
                                 ORDER BY pressure DESC
                            """,
                                "ObjectAllocationSample",
                                "Thread")
                        .description(
                                """
                    Shows the threads which have the highest allocation pressure.
                    """),
                new View(
                                "allocation-by-site",
                                "application",
                                "Allocation by Method (disregarding line number and descriptor)",
                                "allocation-by-site",
                                """
                                 CREATE VIEW "allocation-by-site" AS
                                 SELECT "Method", format_percentage(pressure) AS "Allocation Pressure" FROM
                                 (SELECT
                                     (c.javaName || m.name || m.descriptor) AS "Method",
                                     SUM(weight) / (SELECT SUM(weight) FROM ObjectAllocationSample) AS pressure
                                 FROM ObjectAllocationSample
                                 LEFT JOIN Method m ON m._id = stackTrace$topMethod
                                 LEFT JOIN Class c ON c._id = m.type
                                 GROUP BY stackTrace$topMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY pressure DESC
                                 LIMIT 25
                                 )
                                 ORDER BY pressure DESC
                            """,
                                "ObjectAllocationSample",
                                "Method",
                                "Class")
                        .description(
                                """
                    Shows the methods which have the highest allocation pressure.
                    """),
                /**
                 * [jvm.blocked-by-system-gc] label = "Blocked by System.gc()" table = "FORMAT none,
                 * none, cell-height:10 SELECT startTime, duration, stackTrace FROM SystemGC WHERE
                 * invokedConcurrent = 'false' ORDER BY duration DESC LIMIT 25"
                 */
                new View(
                                "blocked-by-system-gc",
                                "jvm",
                                "Blocked by System.gc()",
                                "blocked-by-system-gc",
                                """
                                 CREATE VIEW "blocked-by-system-gc" AS
                                 SELECT
                                     startTime AS "Time",
                                     format_duration(duration) AS "Duration",
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Stack Trace"
                                 FROM SystemGC sgc
                                 LEFT JOIN Method m ON m._id = sgc.stackTrace$topApplicationMethod
                                 LEFT JOIN Class c ON c._id = m.type
                                 WHERE invokedConcurrent = 'false'
                                 ORDER BY sgc.duration DESC
                                 LIMIT 25
                            """,
                                "SystemGC",
                                "Method",
                                "Class")
                        .description(
                                """
                    Shows the System.gc() calls which have blocked application threads the most.
                    """),
                new View(
                                "class-loaders",
                                "application",
                                "Class Loaders",
                                "class-loaders",
                                """
                                 CREATE VIEW "class-loaders" AS
                                 SELECT
                                     cl.javaName AS "Class Loader",
                                     LAST(hiddenClassCount) AS "Hidden Classes",
                                     LAST(classCount) AS "Classes"
                                 FROM ClassLoaderStatistics cls
                                 LEFT JOIN ClassLoader cl ON cls.classLoader = cl._id
                                 GROUP BY classLoader, cl.javaName
                                 ORDER BY "Classes" DESC
                            """,
                                "ClassLoaderStatistics",
                                "ClassLoader")
                        .description(
                                """
                    Shows all class loaders with their loaded class count and hidden class count.
                    """),
                new View(
                                "class-modifications",
                                "jvm",
                                "Class Modifications",
                                "class-modifications",
                                """
                                 CREATE VIEW "class-modifications" AS
                                 SELECT
                                     format_duration(duration) AS "Time",
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Requested By",
                                     CASE
                                         WHEN eventType = 'redefine' THEN 'Redefine Classes'
                                         WHEN eventType = 'retransform' THEN 'Retransform Classes'
                                         ELSE eventType
                                     END AS "Operation",
                                     classCount AS "Classes"
                                 FROM (
                                     SELECT
                                         'redefine' AS eventType,
                                         duration,
                                         stackTrace$topApplicationMethod,
                                         classCount
                                     FROM RedefineClasses
                                     UNION ALL
                                     SELECT
                                         'retransform' AS eventType,
                                         duration,
                                         stackTrace$topApplicationMethod,
                                         classCount
                                     FROM RetransformClasses
                                 ) AS combined
                                 LEFT JOIN Method m ON m._id = stackTrace$topApplicationMethod
                                 LEFT JOIN Class c ON c._id = m.type
                                 ORDER BY duration DESC
                            """,
                                "RedefineClasses",
                                "RetransformClasses",
                                "Method",
                                "Class")
                        .addUnionAlternatives()
                        .description(
                                """
                    Shows all class redefinitions and retransforms with their duration, requested by and class count.
                    """),
                new View(
                                "compiler-configuration",
                                "jvm",
                                "Compiler Configuration",
                                "compiler-configuration",
                                """
                                 CREATE VIEW "compiler-configuration" AS
                                 SELECT
                                     LAST(threadCount) AS "Compiler Threads",
                                     LAST(dynamicCompilerThreadCount) AS "Dynamic Compiler Threads",
                                     LAST(tieredCompilation) AS "Tiered Compilation"
                                 FROM CompilerConfiguration
                            """,
                                "CompilerConfiguration")
                        .description(
                                """
                    Shows the configuration of the JIT compiler.
                    """),
                new View(
                                "compiler-statistics",
                                "jvm",
                                "Compiler Statistics",
                                "compiler-statistics",
                                """
                                 CREATE VIEW "compiler-statistics" AS
                                 SELECT
                                     LAST(compileCount) AS "Compiled Methods",
                                     format_duration(LAST(peakTimeSpent)) AS "Peak Time",
                                     format_duration(LAST(totalTimeSpent)) AS "Total Time",
                                     LAST(bailoutCount) AS "Bailouts",
                                     LAST(osrCompileCount) AS "OSR Compilations",
                                     LAST(standardCompileCount) AS "Standard Compilations",
                                     format_memory(LAST(osrBytesCompiled)) AS "OSR Bytes Compiled",
                                     format_memory(LAST(standardBytesCompiled)) AS "Standard Bytes Compiled",
                                     format_memory(LAST(nmethodsSize)) AS "Compilation Resulting Size",
                                     format_memory(LAST(nmethodCodeSize)) AS "Compilation Resulting Code Size"
                                 FROM CompilerStatistics
                            """,
                                "CompilerStatistics")
                        .description(
                                """
                    Shows statistics about the JIT compiler.
                    """),
                /**
                 * [jvm.compiler-phases] label = "Concurrent Compiler Phases" table = "COLUMN
                 * 'Level', 'Phase', 'Average', 'P95', 'Longest', 'Count', 'Total' SELECT phaseLevel
                 * AS L, phase AS P, AVG(duration), P95(duration), MAX(duration), COUNT(*),
                 * SUM(duration) AS S FROM CompilerPhase GROUP BY P ORDER BY L ASC, S DESC"
                 */
                new View(
                                "compiler-phases",
                                "jvm",
                                "Concurrent Compiler Phases",
                                "compiler-phases",
                                """
                                 CREATE VIEW "compiler-phases" AS
                                 SELECT
                                     phaseLevel AS "Level",
                                     phase AS "Phase",
                                     format_duration(AVG(duration)) AS "Average",
                                     format_duration(P95(duration)) AS "P95",
                                     format_duration(MAX(duration)) AS "Longest",
                                     COUNT(*) AS "Count",
                                     format_duration(SUM(duration)) AS "Total"
                                 FROM CompilerPhase
                                 GROUP BY phase, phaseLevel
                                 ORDER BY phaseLevel ASC, SUM(duration) DESC
                            """,
                                "CompilerPhase")
                        .description(
                                """
                    Shows the phases of the concurrent compiler with their average, p95, longest, count and total duration.
                    """),
                /**
                 * [environment.container-configuration] label = "Container Configuration" form =
                 * "SELECT LAST(containerType), LAST(cpuSlicePeriod), LAST(cpuQuota),
                 * LAST(cpuShares), LAST(effectiveCpuCount), LAST(memorySoftLimit),
                 * LAST(memoryLimit), LAST(swapMemoryLimit), LAST(hostTotalMemory) FROM
                 * ContainerConfiguration"
                 */
                new View(
                                "container-configuration",
                                "environment",
                                "Container Configuration",
                                "container-configuration",
                                """
                                 CREATE VIEW "container-configuration" AS
                                 SELECT
                                     LAST(containerType) AS "Container Type",
                                     format_duration(LAST(cpuSlicePeriod)) AS "CPU Slice Period",
                                     format_duration(LAST(cpuQuota)) AS "CPU Quota",
                                     LAST(cpuShares) AS "CPU Shares",
                                     LAST(effectiveCpuCount) AS "Effective CPU Count",
                                     format_memory(LAST(memorySoftLimit)) AS "Memory Soft Limit",
                                     format_memory(LAST(memoryLimit)) AS "Memory Limit",
                                     format_memory(LAST(swapMemoryLimit)) AS "Swap Memory Limit",
                                     format_memory(LAST(hostTotalMemory)) AS "Host Total Memory"
                                 FROM ContainerConfiguration
                            """,
                                "ContainerConfiguration")
                        .description(
                                """
                    Shows the configuration of the container in which the JVM is running.
                    """),
                /**
                 * [environment.container-cpu-usage] label = "Container CPU Usage" form = "SELECT
                 * LAST(cpuTime), LAST(cpuUserTime), LAST(cpuSystemTime) FROM ContainerCPUUsage"
                 */
                new View(
                                "container-cpu-usage",
                                "environment",
                                "Container CPU Usage",
                                "container-cpu-usage",
                                """
                                 CREATE VIEW "container-cpu-usage" AS
                                 SELECT
                                     format_duration(LAST(cpuTime)) AS "CPU Time",
                                     format_duration(LAST(cpuUserTime)) AS "CPU User Time",
                                     format_duration(LAST(cpuSystemTime)) AS "CPU System Time"
                                 FROM ContainerCPUUsage
                            """,
                                "ContainerCPUUsage")
                        .description(
                                """
                    Shows the CPU usage of the container in which the JVM is running.
                    """),
                /**
                 * [environment.container-memory-usage] label = "Container Memory Usage" form =
                 * "SELECT LAST(memoryFailCount), LAST(memoryUsage), LAST(swapMemoryUsage) FROM
                 * ContainerMemoryUsage"
                 */
                new View(
                                "container-memory-usage",
                                "environment",
                                "Container Memory Usage",
                                "container-memory-usage",
                                """
                                 CREATE VIEW "container-memory-usage" AS
                                 SELECT
                                     LAST(memoryFailCount) AS "Memory Fail Count",
                                     format_memory(LAST(memoryUsage)) AS "Memory Usage",
                                     format_memory(LAST(swapMemoryUsage)) AS "Swap Memory Usage"
                                 FROM ContainerMemoryUsage
                            """,
                                "ContainerMemoryUsage")
                        .description(
                                """
                    Shows the memory usage of the container in which the JVM is running.
                    """),
                /**
                 * [environment.container-io-usage] label = "Container I/O Usage" form = "SELECT
                 * LAST(serviceRequests), LAST(dataTransferred) FROM ContainerIOUsage"
                 */
                new View(
                                "container-io-usage",
                                "environment",
                                "Container I/O Usage",
                                "container-io-usage",
                                """
                                 CREATE VIEW "container-io-usage" AS
                                 SELECT
                                     LAST(serviceRequests) AS "Service Requests",
                                     format_memory(LAST(dataTransferred)) AS "Data Transferred"
                                 FROM ContainerIOUsage
                            """,
                                "ContainerIOUsage")
                        .description(
                                """
                    Shows the I/O usage of the container in which the JVM is running.
                    """),
                /**
                 * [environment.container-cpu-throttling] label = "Container CPU Throttling" form =
                 * "SELECT LAST(cpuElapsedSlices), LAST(cpuThrottledSlices), LAST(cpuThrottledTime)
                 * FROM ContainerCPUThrottling"
                 */
                new View(
                                "container-cpu-throttling",
                                "environment",
                                "Container CPU Throttling",
                                "container-cpu-throttling",
                                """
                                 CREATE VIEW "container-cpu-throttling" AS
                                 SELECT
                                     LAST(cpuElapsedSlices) AS "CPU Elapsed Slices",
                                     LAST(cpuThrottledSlices) AS "CPU Throttled Slices",
                                     format_duration(LAST(cpuThrottledTime)) AS "CPU Throttled Time"
                                 FROM ContainerCPUThrottling
                            """,
                                "ContainerCPUThrottling")
                        .description(
                                """
                    Shows the CPU throttling of the container in which the JVM is running.
                    """),
                /**
                 * [application.contention-by-thread] label = "Contention by Thread" table = "COLUMN
                 * 'Thread', 'Count', 'Avg', 'P90', 'Max.' SELECT eventThread, COUNT(*),
                 * AVG(duration), P90(duration), MAX(duration) AS M FROM JavaMonitorEnter GROUP BY
                 * eventThread ORDER BY M"
                 */
                new View(
                                "contention-by-thread",
                                "application",
                                "Contention by Thread",
                                "contention-by-thread",
                                """
                                 CREATE VIEW "contention-by-thread" AS
                                 SELECT
                                     th.javaName AS "Thread",
                                     COUNT(*) AS "Count",
                                     format_duration(AVG(duration)) AS "Avg",
                                     format_duration(P90(duration)) AS "P90",
                                     format_duration(MAX(duration)) AS "Max."
                                 FROM JavaMonitorEnter jme
                                 JOIN Thread th ON jme.eventThread = th._id
                                 GROUP BY eventThread, th.javaName
                                 ORDER BY MAX(duration) DESC
                            """,
                                "JavaMonitorEnter",
                                "Thread")
                        .description(
                                """
                    Shows the threads which have the highest contention time.
                    """),
                /**
                 * [application.contention-by-class] label = "Contention by Lock Class" table =
                 * "COLUMN 'Lock Class', 'Count', 'Avg.', 'P90', 'Max.' SELECT monitorClass,
                 * COUNT(*), AVG(duration), P90(duration), MAX(duration) AS M FROM JavaMonitorEnter
                 * GROUP BY monitorClass ORDER BY M"
                 */
                new View(
                                "contention-by-class",
                                "application",
                                "Contention by Lock Class",
                                "contention-by-class",
                                """
                                 CREATE VIEW "contention-by-class" AS
                                 SELECT
                                     c.javaName AS "Lock Class",
                                     COUNT(*) AS "Count",
                                     format_duration(AVG(duration)) AS "Avg.",
                                     format_duration(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration)) AS "P90",
                                     format_duration(MAX(duration)) AS "Max."
                                 FROM JavaMonitorEnter jme
                                 JOIN Class c ON jme.monitorClass = c._id
                                 GROUP BY monitorClass, c.javaName
                                 ORDER BY MAX(duration) DESC
                            """,
                                "JavaMonitorEnter",
                                "Class")
                        .description(
                                """
                    Shows the classes which have the highest contention time.
                    """),
                /**
                 * [application.contention-by-site] label = "Contention by Site" table = "COLUMN
                 * 'StackTrace', 'Count', 'Avg.', 'Max.' SELECT stackTrace AS S, COUNT(*),
                 * AVG(duration), MAX(duration) AS M FROM JavaMonitorEnter GROUP BY S ORDER BY M"
                 */
                new View(
                                "contention-by-site",
                                "application",
                                "Contention by Site",
                                "contention-by-site",
                                """
                                 CREATE VIEW "contention-by-site" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "StackTrace",
                                     COUNT(*) AS "Count",
                                     format_duration(AVG(duration)) AS "Avg.",
                                     format_duration(MAX(duration)) AS "Max."
                                 FROM JavaMonitorEnter jme
                                 JOIN Method m ON jme.stackTrace$topMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY c.javaName, m.name, m.descriptor
                                 ORDER BY MAX(duration) DESC
                            """,
                                "JavaMonitorEnter",
                                "Method",
                                "Class")
                        .description(
                                """
                    Shows the stack traces which have the highest contention time.
                    """),
                /**
                 * [application.contention-by-address] label = "Contention by Monitor Address" table
                 * = "COLUMN 'Monitor Address', 'Class', 'Threads', 'Max Duration' SELECT address,
                 * FIRST(monitorClass), UNIQUE(eventThread), MAX(duration) AS M FROM
                 * JavaMonitorEnter GROUP BY monitorClass ORDER BY M"
                 */
                new View(
                                "contention-by-address",
                                "application",
                                "Contention by Monitor Address",
                                "contention-by-address",
                                """
                                 CREATE VIEW "contention-by-address" AS
                                 SELECT
                                     format_hex(jme.address) AS "Monitor Address",
                                     c.javaName AS "Class",
                                     COUNT(DISTINCT eventThread) AS "Threads",
                                     format_duration(MAX(duration)) AS "Max Duration"
                                 FROM JavaMonitorEnter jme
                                 JOIN Class c ON jme.monitorClass = c._id
                                 GROUP BY jme.address, c.javaName
                                 ORDER BY MAX(duration) DESC
                            """,
                                "JavaMonitorEnter",
                                "Class")
                        .description(
                                """
                    Shows the monitor addresses which have the highest contention time.
                    """),
                /**
                 * [application.deprecated-methods-for-removal] label = "Deprecated Methods for
                 * Removal" table = "COLUMN 'Deprecated Method', 'Called from Class' FORMAT
                 * truncate-beginning, cell-height:10000;truncate-beginning SELECT method AS m,
                 * SET(stackTrace.topFrame.method.type) FROM DeprecatedInvocation WHERE forRemoval =
                 * 'true' GROUP BY m ORDER BY m"
                 */
                new View(
                                "deprecated-methods-for-removal",
                                "application",
                                "Deprecated Methods for Removal",
                                "deprecated-methods-for-removal",
                                """
                                 CREATE VIEW "deprecated-methods-for-removal" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Deprecated Method",
                                     list(DISTINCT (cc.javaName) ORDER BY cc.javaName) AS "Called from Class"
                                 FROM DeprecatedInvocation di
                                 JOIN Method m ON di.method = m._id
                                 JOIN Class c ON m.type = c._id
                                 JOIN Method cm ON di.stackTrace$topMethod = cm._id
                                 JOIN Class cc ON cm.type = cc._id
                                 WHERE forRemoval = 'true'
                                 GROUP BY di.method, c.javaName, m.name, m.descriptor
                                 ORDER BY c.javaName, m.name, m.descriptor
                            """,
                                "DeprecatedInvocation",
                                "Method",
                                "Class")
                        .description(
                                """
                    Shows all deprecated methods which are marked for removal and the classes from which they are called.
                    """),
                /**
                 * [environment.cpu-information] label ="CPU Information" form = "SELECT cpu,
                 * sockets, cores, hwThreads, description FROM CPUInformation"
                 */
                new View(
                                "cpu-information",
                                "environment",
                                "CPU Information",
                                "cpu-information",
                                """
                                 CREATE VIEW "cpu-information" AS
                                 SELECT
                                     cpu AS "CPU",
                                     sockets AS "Sockets",
                                     cores AS "Cores",
                                     hwThreads AS "Hardware Threads",
                                     description AS "Description"
                                 FROM CPUInformation
                                 GROUP BY cpu, sockets, cores, hwThreads, description
                            """,
                                "CPUInformation")
                        .description(
                                """
                    Shows information about the CPU(s) on which the JVM is running.
                    """),
                /**
                 * [environment.cpu-load] label = "CPU Load Statistics" form = "COLUMN 'JVM User
                 * (Minimum)', 'JVM User (Average)', 'JVM User (Maximum)', 'JVM System (Minimum)',
                 * 'JVM System (Average)', 'JVM System (Maximum)', 'Machine Total (Minimum)',
                 * 'Machine Total (Average)', 'Machine Total (Maximum)' SELECT MIN(jvmUser),
                 * AVG(jvmUser), MAX(jvmUser), MIN(jvmSystem), AVG(jvmSystem), MAX(jvmSystem),
                 * MIN(machineTotal), AVG(machineTotal), MAX(machineTotal) FROM CPULoad"
                 */
                new View(
                                "cpu-load",
                                "environment",
                                "CPU Load Statistics",
                                "cpu-load",
                                """
                                 CREATE VIEW "cpu-load" AS
                                 SELECT
                                     format_percentage(MIN(jvmUser)) AS "JVM User (Minimum)",
                                     format_percentage(AVG(jvmUser)) AS "JVM User (Average)",
                                     format_percentage(MAX(jvmUser)) AS "JVM User (Maximum)",
                                     format_percentage(MIN(jvmSystem)) AS "JVM System (Minimum)",
                                     format_percentage(AVG(jvmSystem)) AS "JVM System (Average)",
                                     format_percentage(MAX(jvmSystem)) AS "JVM System (Maximum)",
                                     format_percentage(MIN(machineTotal)) AS "Machine Total (Minimum)",
                                     format_percentage(AVG(machineTotal)) AS "Machine Total (Average)",
                                     format_percentage(MAX(machineTotal)) AS "Machine Total (Maximum)"
                                 FROM CPULoad
                            """,
                                "CPULoad")
                        .description(
                                """
                    Shows statistics about the CPU load of the JVM and the machine.
                    """),
                /**
                 * [environment.cpu-load-samples] label = "CPU Load" table = "SELECT startTime,
                 * jvmUser, jvmSystem, machineTotal FROM CPULoad"
                 */
                new View(
                                "cpu-load-samples",
                                "environment",
                                "CPU Load",
                                "cpu-load-samples",
                                """
                                 CREATE VIEW "cpu-load-samples" AS
                                 SELECT
                                     startTime AS "Time",
                                     format_percentage(jvmUser) AS "JVM User",
                                     format_percentage(jvmSystem) AS "JVM System",
                                     format_percentage(machineTotal) AS "Machine Total"
                                 FROM CPULoad
                                 ORDER BY startTime
                            """,
                                "CPULoad")
                        .description(
                                """
                    Shows the CPU load samples of the JVM and the machine over time.
                    """),
                /*
                            [environment.cpu-tsc]
                label ="CPU Time Stamp Counter"
                form = "SELECT LAST(fastTimeAutoEnabled), LAST(fastTimeEnabled),
                               LAST(fastTimeFrequency), LAST(osFrequency)
                        FROM CPUTimeStampCounter"
                             */
                new View(
                                "cpu-tsc",
                                "environment",
                                "CPU Time Stamp Counter",
                                "cpu-tsc",
                                """
                                 CREATE VIEW "cpu-tsc" AS
                                 SELECT
                                     LAST(fastTimeAutoEnabled) AS "Fast Time Auto Enabled",
                                     LAST(fastTimeEnabled) AS "Fast Time Enabled",
                                     LAST(fastTimeFrequency) || ' Hz' AS "Fast Time Frequency",
                                     LAST(osFrequency) || ' Hz' AS "OS Frequency"
                                 FROM CPUTimeStampCounter
                            """,
                                "CPUTimeStampCounter")
                        .description(
                                """
                    Shows information about the CPU Time Stamp Counter (TSC).
                    """),
                /**
                 * [jvm.deoptimizations-by-reason] label = "Deoptimization by Reason" table =
                 * "SELECT reason, COUNT(reason) AS C FROM Deoptimization GROUP BY reason ORDER BY C
                 * DESC"
                 */
                new View(
                                "deoptimizations-by-reason",
                                "jvm",
                                "Deoptimization by Reason",
                                "deoptimizations-by-reason",
                                """
                                 CREATE VIEW "deoptimizations-by-reason" AS
                                 SELECT
                                     reason AS "Reason",
                                     COUNT(reason) AS "Count"
                                 FROM Deoptimization
                                 GROUP BY reason
                                 ORDER BY COUNT(reason) DESC
                            """,
                                "Deoptimization")
                        .description(
                                """
                    Shows the reasons for deoptimizations and their counts.
                    """),
                /**
                 * [jvm.deoptimizations-by-site] label = "Deoptimization by Site" table = "SELECT
                 * method, lineNumber, bci, COUNT(reason) AS C FROM Deoptimization GROUP BY method
                 * ORDER BY C DESC"
                 */
                new View(
                                "deoptimizations-by-site",
                                "jvm",
                                "Deoptimization by Site",
                                "deoptimizations-by-site",
                                """
                                 CREATE VIEW "deoptimizations-by-site" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     d.lineNumber AS "Line Number",
                                     d.bci AS "BCI",
                                     COUNT(d.reason) AS "Count"
                                 FROM Deoptimization d
                                 JOIN Method m ON d.method = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY d.method, d.lineNumber, d.bci, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(d.reason) DESC
                            """,
                                "Deoptimization",
                                "Method",
                                "Class")
                        .description(
                                """
                    Shows the methods where deoptimizations occurred and their counts.
                    """),
                /**
                 * [environment.events-by-count] label = "Event Types by Count" table = "SELECT
                 * eventType.label AS E, COUNT(*) AS C FROM * GROUP BY E ORDER BY C DESC"
                 */
                new View(
                        "events-by-count",
                        "environment",
                        "Event Types by Count",
                        "events-by-count",
                        """
                                 CREATE VIEW "events-by-count" AS
                                 SELECT
                                     label AS "Event Label",
                                     count AS "Count"
                                 FROM Events
                                 JOIN EventLabels ON Events.name = EventLabels.name
                                 ORDER BY count DESC
                                 """,
                        "Events",
                        "EventLabels"),
                /**
                 * [environment.events-by-name] label = "Event Types by Name" table = "SELECT
                 * eventType.label AS E, COUNT(*) AS C FROM * GROUP BY E ORDER BY E ASC"
                 */
                new View(
                        "events-by-name",
                        "environment",
                        "Event Types by Name",
                        "events-by-name",
                        """
                                 CREATE VIEW "events-by-name" AS
                                 SELECT
                                     label AS "Event Label",
                                     count AS "Count"
                                 FROM Events
                                 JOIN EventLabels ON Events.name = EventLabels.name
                                 ORDER BY Events.name ASC
                            """,
                        "Events",
                        "EventLabels"),
                /**
                 * [environment.environment-variables] label = "Environment Variables" table =
                 * "FORMAT none, cell-height:20 SELECT LAST(key) AS K, LAST(value) FROM
                 * InitialEnvironmentVariable GROUP BY key ORDER BY K"
                 */
                new View(
                        "environment-variables",
                        "environment",
                        "Environment Variables",
                        "environment-variables",
                        """
                                 CREATE VIEW "environment-variables" AS
                                 SELECT
                                     key AS "Key",
                                     value AS "Value"
                                 FROM InitialEnvironmentVariable
                                 GROUP BY key, value
                                 ORDER BY key
                            """,
                        "InitialEnvironmentVariable"),
                /**
                 * [application.exception-count] label ="Exception Statistics" form = "COLUMN
                 * 'Exceptions Thrown' SELECT DIFF(throwables) FROM ExceptionStatistics"
                 */
                new View(
                                "exception-count",
                                "application",
                                "Exception Statistics",
                                "exception-count",
                                """
                                 CREATE VIEW "exception-count" AS
                                 SELECT
                                     LAST(throwables) - FIRST(throwables) AS "Exceptions Thrown"
                                 FROM ExceptionStatistics
                            """,
                                "ExceptionStatistics")
                        .description(
                                "Shows the total number of exceptions thrown during the JFR recording period."),
                /**
                 * [application.exception-by-type] label ="Exceptions by Type" table = "COLUMN
                 * 'Class', 'Count' SELECT thrownClass AS T, COUNT(thrownClass) AS C FROM
                 * JavaErrorThrow, JavaExceptionThrow GROUP BY T ORDER BY C DESC"
                 */
                new View(
                                "exception-by-type",
                                "application",
                                "Exceptions by Type",
                                "exception-by-type",
                                """
                                 CREATE VIEW "exception-by-type" AS
                                 SELECT
                                     c.javaName AS "Class",
                                     COUNT(*) AS "Count"
                                 FROM (
                                     SELECT thrownClass FROM JavaErrorThrow
                                     UNION ALL
                                     SELECT thrownClass FROM JavaExceptionThrow
                                 ) AS combined
                                 JOIN Class c ON combined.thrownClass = c._id
                                 GROUP BY combined.thrownClass, c.javaName
                                    ORDER BY COUNT(*) DESC
                            """,
                                "JavaErrorThrow",
                                "JavaExceptionThrow",
                                "Class")
                        .addUnionAlternatives()
                        .description(
                                "Categorizes all thrown exceptions and errors by their class type, ranked by frequency."),
                /**
                 * [application.exception-by-message] label ="Exceptions by Message" table = "COLUMN
                 * 'Message', 'Count' SELECT message AS M, COUNT(message) AS C FROM JavaErrorThrow,
                 * JavaExceptionThrow GROUP BY M ORDER BY C DESC"
                 */
                new View(
                                "exception-by-message",
                                "application",
                                "Exceptions by Message",
                                "exception-by-message",
                                """
                                 CREATE VIEW "exception-by-message" AS
                                 SELECT
                                     message AS "Message",
                                     COUNT(*) AS "Count"
                                 FROM (
                                     SELECT message FROM JavaErrorThrow
                                     UNION ALL
                                     SELECT message FROM JavaExceptionThrow
                                 ) AS combined
                                 GROUP BY message
                                 ORDER BY COUNT(*) DESC
                            """,
                                "JavaErrorThrow",
                                "JavaExceptionThrow")
                        .addUnionAlternatives()
                        .description(
                                "Groups exceptions by their specific error messages, revealing the most frequent error conditions in your application."),
                /**
                 * [application.exception-by-site] label ="Exceptions by Site" table = "COLUMN
                 * 'Method', 'Count' SELECT stackTrace.notInit AS S, COUNT(startTime) AS C FROM
                 * JavaErrorThrow, JavaExceptionThrow GROUP BY S ORDER BY C DESC"
                 */
                new View(
                                "exception-by-site",
                                "application",
                                "Exceptions by Site",
                                "exception-by-site",
                                """
                                 CREATE VIEW "exception-by-site" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     COUNT(*) AS "Count"
                                 FROM (
                                     SELECT stackTrace$topNonInitMethod as ni FROM JavaErrorThrow
                                     UNION ALL
                                     SELECT stackTrace$topNonInitMethod as ni FROM JavaExceptionThrow
                                 ) AS combined
                                 JOIN Method m ON combined.ni = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY combined.ni, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(*) DESC
                            """,
                                "JavaErrorThrow",
                                "JavaExceptionThrow",
                                "Method",
                                "Class")
                        .addUnionAlternatives()
                        .description(
                                """
                    Shows the locations in the code (methods) where exceptions are thrown, along with the count of how many times exceptions were thrown at each location.
                    """),
                /**
                 * [application.file-reads-by-path] label = "File Reads by Path" table = "COLUMN
                 * 'Path', 'Reads', 'Total Read' FORMAT cell-height:5, none, none SELECT path,
                 * COUNT(*), SUM(bytesRead) AS S FROM FileRead GROUP BY path ORDER BY S DESC"
                 */
                new View(
                                "file-reads-by-path",
                                "application",
                                "File Reads by Path",
                                "file-reads-by-path",
                                """
                                 CREATE VIEW "file-reads-by-path" AS
                                 SELECT
                                     path AS "Path",
                                     COUNT(*) AS "Reads",
                                     format_memory(SUM(bytesRead)) AS "Total Read"
                                 FROM FileRead
                                 GROUP BY path
                                 ORDER BY SUM(bytesRead) DESC
                            """,
                                "FileRead")
                        .description(
                                "Analyzes file system read operations grouped by file path, showing both operation frequency and total data volume."),
                /**
                 * [application.file-writes-by-path] label = "File Writes by Path" table = "COLUMN
                 * 'Path', 'Writes', 'Total Written' FORMAT cell-height:5, none, none SELECT path,
                 * COUNT(bytesWritten), SUM(bytesWritten) AS S FROM FileWrite GROUP BY path ORDER BY
                 * S DESC"
                 */
                new View(
                                "file-writes-by-path",
                                "application",
                                "File Writes by Path",
                                "file-writes-by-path",
                                """
                                 CREATE VIEW "file-writes-by-path" AS
                                 SELECT
                                     path AS "Path",
                                     COUNT(*) AS "Writes",
                                     format_memory(SUM(bytesWritten)) AS "Total Written"
                                 FROM FileWrite
                                 GROUP BY path
                                 ORDER BY SUM(bytesWritten) DESC
                            """,
                                "FileWrite")
                        .description(
                                """
                    Shows the file write operations grouped by file path.
                    """),
                /**
                 * [application.finalizers] label = "Finalizers" table = "SELECT finalizableClass,
                 * LAST_BATCH(objects) AS O, LAST_BATCH(totalFinalizersRun) FROM FinalizerStatistics
                 * GROUP BY finalizableClass ORDER BY O DESC"
                 */
                new View(
                                "finalizers", // TODO: test
                                "application",
                                "Finalizers",
                                "finalizers",
                                """
                                 CREATE VIEW "finalizers" AS
                                 SELECT
                                     c.javaName AS "Finalizable Class",
                                     LAST(objects) AS "Objects",
                                     LAST(totalFinalizersRun) AS "Total Finalizers Run"
                                 FROM FinalizerStatistics fs
                                 JOIN Class c ON fs.finalizableClass = c._id
                                 GROUP BY fs.finalizableClass, c.javaName
                                 ORDER BY LAST(objects) DESC
                            """,
                                "FinalizerStatistics",
                                "Class")
                        .description(
                                """
                    Shows statistics about finalizers grouped by the class of the objects being finalized.
                    """),
                /**
                 * [jvm.gc] label = "Garbage Collections" table = "COLUMN 'Start', 'GC ID', 'GC
                 * Name', 'Heap Before GC', 'Heap After GC', 'Longest Pause' FORMAT none, none,
                 * missing:Unknown, none, none, none SELECT G.startTime, gcId, G.name, B.heapUsed,
                 * A.heapUsed, longestPause FROM GarbageCollection AS G, GCHeapSummary AS B,
                 * GCHeapSummary AS A WHERE B.when = 'Before GC' AND A.when = 'After GC' GROUP BY
                 * gcId ORDER BY gcId"
                 */
                new View(
                                "gc",
                                "jvm",
                                "Garbage Collections",
                                "gc",
                                """
                            CREATE VIEW "gc" AS
                            SELECT
                                G.startTime                          AS "Start",
                                G.gcId                               AS "GC ID",
                                COALESCE(G.name, 'Unknown')          AS "Type",
                                format_memory(B.heapUsed)            AS "Heap Before GC",
                                format_memory(A.heapUsed)            AS "Heap After GC",
                                format_duration(G.longestPause)      AS "Longest Pause"
                            FROM GarbageCollection G
                            JOIN GCHeapSummary B ON G.gcId = B.gcId AND B.when = 'Before GC'
                            JOIN GCHeapSummary A ON G.gcId = A.gcId AND A.when = 'After GC'
                            ORDER BY G.gcId;
                            """,
                                "GarbageCollection",
                                "GCHeapSummary")
                        .addUnionAlternatives()
                        .description(
                                """
                    Provides a summary of all garbage collection events, including start time, type, heap usage before and after GC, and the longest pause duration.
                    """),
                /**
                 * [jvm.gc-concurrent-phases] label = "Concurrent GC Phases" table = "COLUMN 'Name',
                 * 'Average', 'P95', 'Longest', 'Count', 'Total' SELECT name, AVG(duration),
                 * P95(duration), MAX(duration), COUNT(*), SUM(duration) AS S FROM
                 * GCPhaseConcurrent, GCPhaseConcurrentLevel1 GROUP BY name ORDER BY S"
                 */
                new View(
                                "gc-concurrent-phases",
                                "jvm",
                                "Concurrent GC Phases",
                                "gc-concurrent-phases",
                                """
                                 CREATE VIEW "gc-concurrent-phases" AS
                                 SELECT
                                     name AS "Name",
                                     format_duration(AVG(duration)) AS "Average",
                                     format_duration(P95(duration)) AS "P95",
                                     format_duration(MAX(duration)) AS "Longest",
                                     COUNT(*) AS "Count",
                                     format_duration(SUM(duration)) AS "Total"
                                 FROM GCPhaseConcurrent
                                 GROUP BY name
                                 ORDER BY SUM(duration) DESC
                            """,
                                "GCPhaseConcurrent")
                        .description("Shows how long each gc phase took on average."),
                /**
                 * [jvm.gc-parallel-phases] label = "Parallel GC Phases" table = "COLUMN 'Name',
                 * 'Average', 'P95', 'Longest', 'Count', 'Total' SELECT name, AVG(duration),
                 * P95(duration), MAX(duration), COUNT(*), SUM(duration) AS S FROM GCPhaseParallel
                 * GROUP BY name ORDER BY S"
                 */
                new View(
                                "gc-parallel-phases",
                                "jvm",
                                "Parallel GC Phases",
                                "gc-parallel-phases",
                                """
                                 CREATE VIEW "gc-parallel-phases" AS
                                 SELECT
                                     name AS "Name",
                                     format_duration(AVG(duration)) AS "Average",
                                     format_duration(P95(duration)) AS "P95",
                                     format_duration(MAX(duration)) AS "Longest",
                                     COUNT(*) AS "Count",
                                     format_duration(SUM(duration)) AS "Total"
                                 FROM GCPhaseParallel
                                 GROUP BY name
                                 ORDER BY SUM(duration) DESC
                            """,
                                "GCPhaseParallel")
                        .description("Shows how long each parallel gc phase took on average."),
                /**
                 * [jvm.gc-configuration] label = 'GC Configuration' form = "COLUMN 'Young GC', 'Old
                 * GC', 'Parallel GC Threads','Concurrent GC Threads', 'Dynamic GC Threads',
                 * 'Concurrent Explicit GC', 'Disable Explicit GC', 'Pause Target', 'GC Time Ratio'
                 * SELECT LAST(youngCollector), LAST(oldCollector), LAST(parallelGCThreads),
                 * LAST(concurrentGCThreads), LAST(usesDynamicGCThreads),
                 * LAST(isExplicitGCConcurrent), LAST(isExplicitGCDisabled), LAST(pauseTarget),
                 * LAST(gcTimeRatio) FROM GCConfiguration"
                 */
                new View(
                                "gc-configuration",
                                "jvm",
                                "GC Configuration",
                                "gc-configuration",
                                """
                                 CREATE VIEW "gc-configuration" AS
                                 SELECT
                                     LAST(youngCollector) AS "Young GC",
                                     LAST(oldCollector) AS "Old GC",
                                     LAST(parallelGCThreads) AS "Parallel GC Threads",
                                     LAST(concurrentGCThreads) AS "Concurrent GC Threads",
                                     LAST(usesDynamicGCThreads) AS "Dynamic GC Threads",
                                     LAST(isExplicitGCConcurrent) AS "Concurrent Explicit GC",
                                     LAST(isExplicitGCDisabled) AS "Disable Explicit GC",
                                     format_duration(LAST(pauseTarget)) AS "Pause Target",
                                     LAST(gcTimeRatio) AS "GC Time Ratio"
                                 FROM GCConfiguration
                            """,
                                "GCConfiguration")
                        .description(
                                "Shows the configuration of the garbage collector (including number of gc threads)."),
                /**
                 * [jvm.gc-references] label = "GC References" table = "COLUMN 'Time', 'GC ID',
                 * 'Soft Ref.', 'Weak Ref.', 'Phantom Ref.', 'Final Ref.', 'Total Count' SELECT
                 * G.startTime, G.gcId, S.count, W.count, P.count, F.count, SUM(G.count) FROM
                 * GCReferenceStatistics AS S, GCReferenceStatistics AS W, GCReferenceStatistics AS
                 * P, GCReferenceStatistics AS F, GCReferenceStatistics AS G WHERE S.type = 'Soft
                 * reference' AND W.type = 'Weak reference' AND P.type = 'Phantom reference' AND
                 * F.type = 'Final reference' GROUP BY gcId ORDER By G.gcId ASC"
                 */
                new View(
                                "gc-references",
                                "jvm",
                                "GC References",
                                "gc-references",
                                """
                                 CREATE VIEW "gc-references" AS
                                 SELECT
                                     FIRST(G.startTime) AS "Time",
                                     G.gcId AS "GC ID",
                                     S.count AS "Soft Ref.",
                                     W.count AS "Weak Ref.",
                                     P.count AS "Phantom Ref.",
                                     F.count AS "Final Ref.",
                                     (S.count + W.count + P.count + F.count) AS "Total Count"
                                 FROM GCReferenceStatistics S
                                 JOIN GCReferenceStatistics W ON S.gcId = W.gcId
                                 JOIN GCReferenceStatistics P ON S.gcId = P.gcId
                                 JOIN GCReferenceStatistics F ON S.gcId = F.gcId
                                 JOIN GCReferenceStatistics G ON S.gcId = G.gcId
                                 WHERE S.type = 'Soft reference'
                                   AND W.type = 'Weak reference'
                                   AND P.type = 'Phantom reference'
                                   AND F.type = 'Final reference'
                                 GROUP BY G.gcId, S.count, W.count, P.count, F.count
                                 ORDER BY G.gcId ASC
                            """,
                                "GCReferenceStatistics")
                        .description(
                                "Shows reference processing statistics during garbage collection including soft, weak, phantom, and final reference counts."),
                /**
                 * [jvm.gc-pause-phases] label = "GC Pause Phases" table = "COLUMN 'Type', 'Name',
                 * 'Average', 'P95', 'Longest', 'Count', 'Total' SELECT eventType.label AS T, name,
                 * AVG(duration), P95(duration), MAX(duration), COUNT(*), SUM(duration) AS S FROM
                 * GCPhasePause, GCPhasePauseLevel1, GCPhasePauseLevel2, GCPhasePauseLevel3,
                 * GCPhasePauseLevel4 GROUP BY name ORDER BY T ASC, S DESC"
                 */
                new View(
                                "gc-pause-phases",
                                "jvm",
                                "GC Pause Phases",
                                "gc-pause-phases",
                                """
                            CREATE VIEW "gc-pause-phases" AS
                            SELECT
                                eventTypeLabel AS "Type",
                                name AS "Name",
                                format_duration(AVG(duration)) AS "Average",
                                format_duration(P95(duration)) AS "P95",
                                format_duration(MAX(duration)) AS "Longest",
                                COUNT(*) AS "Count",
                                format_duration(SUM(duration)) AS "Total"
                            FROM (
                                SELECT 'GC Phase Pause' as eventTypeLabel, name, duration FROM GCPhasePause
                                UNION ALL
                                SELECT 'GC Phase Pause Level 1' as eventTypeLabel, name, duration FROM GCPhasePauseLevel1
                                UNION ALL
                                SELECT 'GC Phase Pause Level 2' as eventTypeLabel, name, duration FROM GCPhasePauseLevel2
                                UNION ALL
                                SELECT 'GC Phase Pause Level 3' as eventTypeLabel, name, duration FROM GCPhasePauseLevel3
                                UNION ALL
                                SELECT 'GC Phase Pause Level 4' as eventTypeLabel, name, duration FROM GCPhasePauseLevel4
                            ) phases
                            GROUP BY eventTypeLabel, name
                            ORDER BY eventTypeLabel ASC, SUM(duration) DESC;
                    """,
                                "GCPhasePause",
                                "GCPhasePauseLevel1",
                                "GCPhasePauseLevel2",
                                "GCPhasePauseLevel3",
                                "GCPhasePauseLevel4",
                                "EventType")
                        .addUnionAlternatives()
                        .description(
                                """
                    Shows the pause phases of the garbage collector with their type, name, average, p95, longest, count, and total duration.
                    """),
                /**
                 * [jvm.gc-pauses] label = "GC Pauses" form = "COLUMN 'Total Pause Time','Number of
                 * Pauses', 'Minimum Pause Time', 'Median Pause Time', 'Average Pause Time', 'P90
                 * Pause Time', 'P95 Pause Time', 'P99 Pause Time', 'P99.9% Pause Time', 'Maximum
                 * Pause Time' SELECT SUM(duration), COUNT(duration), MIN(duration),
                 * MEDIAN(duration), AVG(duration), P90(duration), P95(duration), P99(duration),
                 * P999(duration), MAX(duration) FROM GCPhasePause"
                 */
                new View(
                                "gc-pauses",
                                "jvm",
                                "GC Pauses",
                                "gc-pauses",
                                """
                                 CREATE VIEW "gc-pauses" AS
                                 SELECT
                                     format_duration(SUM(duration)) AS "Total Pause Time",
                                     COUNT(duration) AS "Number of Pauses",
                                     format_duration(MIN(duration)) AS "Minimum Pause Time",
                                     format_duration(MEDIAN(duration)) AS "Median Pause Time",
                                     format_duration(AVG(duration)) AS "Average Pause Time",
                                     format_duration(P90(duration)) AS "P90 Pause Time",
                                     format_duration(P95(duration)) AS "P95 Pause Time",
                                     format_duration(P99(duration)) AS "P99 Pause Time",
                                     format_duration(P999(duration)) AS "P99.9% Pause Time",
                                     format_duration(MAX(duration)) AS "Maximum Pause Time"
                                 FROM GCPhasePause
                            """,
                                "GCPhasePause")
                        .description(
                                """
                    Shows statistics about the garbage collection pauses including total pause time and number of pauses.
                    """),
                /**
                 * [jvm.gc-allocation-trigger] label = "GC Allocation Trigger" table = "COLUMN
                 * 'Trigger Method (Non-JDK)', 'Count', 'Total Requested' SELECT
                 * stackTrace.topApplicationFrame AS S, COUNT(*), SUM(size) FROM
                 * AllocationRequiringGC GROUP BY S"
                 */
                new View(
                                "gc-allocation-trigger",
                                "jvm",
                                "GC Allocation Trigger",
                                "gc-allocation-trigger",
                                """
                                 CREATE VIEW "gc-allocation-trigger" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Trigger Method (Non-JDK)",
                                     COUNT(*) AS "Count",
                                     format_memory(SUM(ar.size)) AS "Total Requested"
                                 FROM AllocationRequiringGC ar
                                 JOIN Method m ON ar.stackTrace$topApplicationMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY ar.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(*) DESC, SUM(ar.size) DESC
                            """,
                                "AllocationRequiringGC",
                                "Class")
                        .description(
                                """
                    Identifies the application methods that most frequently trigger garbage collections due to memory allocation requests.
                    """),
                /**
                 * [jvm.gc-cpu-time] label = "GC CPU Time" form = "COLUMN 'GC User Time', 'GC System
                 * Time', 'GC Wall Clock Time', 'Total Time', 'GC Count' SELECT SUM(userTime),
                 * SUM(systemTime), SUM(realTime), DIFF(startTime), COUNT(*) FROM GCCPUTime"
                 */
                new View(
                                "gc-cpu-time",
                                "jvm",
                                "GC CPU Time",
                                "gc-cpu-time",
                                """
                                 CREATE VIEW "gc-cpu-time" AS
                                 SELECT
                                     format_duration(SUM(userTime)) AS "GC User Time",
                                     format_duration(SUM(systemTime)) AS "GC System Time",
                                     format_duration(SUM(realTime)) AS "GC Wall Clock Time",
                                     format_duration(epoch(MAX(startTime) - MIN(startTime))) AS "Total Time",
                                     COUNT(*) AS "GC Count"
                                 FROM GCCPUTime
                            """,
                                "GCCPUTime")
                        .description(
                                """
                    Summarizes the CPU time consumed by garbage collection.
                    """),

                // ==========================================
                // GC ANALYSIS VIEWS
                // ==========================================

                new View(
                                "gc-pause-distribution",
                                "gc-analysis",
                                "GC Pause Distribution",
                                null,
                                """
                                 CREATE VIEW "gc-pause-distribution" AS
                                 SELECT
                                     name AS "Phase",
                                     COUNT(*) AS "Count",
                                     format_duration(MIN(duration)) AS "Min",
                                     format_duration(MEDIAN(duration)) AS "Median",
                                     format_duration(P90(duration)) AS "P90",
                                     format_duration(P99(duration)) AS "P99",
                                     format_duration(MAX(duration)) AS "Max",
                                     format_duration(SUM(duration)) AS "Total"
                                 FROM GCPhasePause
                                 GROUP BY name
                                 ORDER BY MAX(duration) DESC
                            """,
                                "GCPhasePause")
                        .description(
                                """
                    Pause-time distribution per GC phase: p50/p90/p99/max by phase name.
                    Useful for pinpointing which GC sub-phase contributes most to latency.
                    """),

                new View(
                                "gc-top-pauses",
                                "gc-analysis",
                                "Top GC Pauses",
                                null,
                                """
                                 CREATE VIEW "gc-top-pauses" AS
                                 SELECT
                                     startTime AS "Start Time",
                                     name AS "Phase",
                                     gcId AS "GC ID",
                                     format_duration(duration) AS "Duration"
                                 FROM GCPhasePause
                                 ORDER BY duration DESC
                                 LIMIT 20
                            """,
                                "GCPhasePause")
                        .description(
                                """
                    The 20 longest individual GC pause events, with start time, phase name and GC ID.
                    """),

                new View(
                                "gc-phase-breakdown",
                                "gc-analysis",
                                "GC Phase Breakdown",
                                null,
                                """
                                 CREATE VIEW "gc-phase-breakdown" AS
                                 SELECT
                                     gcId AS "GC ID",
                                     name AS "Phase",
                                     format_duration(duration) AS "Duration",
                                     startTime AS "Start"
                                 FROM GCPhasePause
                                 ORDER BY gcId, startTime
                            """,
                                "GCPhasePause")
                        .description(
                                """
                    All pause-phase records ordered by GC ID and start time.
                    Use to drill into which sub-phases make up each collection.
                    """),

                new View(
                                "gc-young-vs-old",
                                "gc-analysis",
                                "GC Young vs Old Collector",
                                null,
                                """
                                 CREATE VIEW "gc-young-vs-old" AS
                                 SELECT
                                     cause AS "Cause",
                                     COUNT(*) AS "Collections",
                                     format_duration(SUM(sumOfPauses)) AS "Total Pause",
                                     format_duration(AVG(sumOfPauses)) AS "Avg Pause",
                                     format_duration(MAX(longestPause)) AS "Max Single Pause"
                                 FROM GarbageCollection
                                 GROUP BY cause
                                 ORDER BY SUM(sumOfPauses) DESC
                            """,
                                "GarbageCollection")
                        .description(
                                """
                    Collection counts and total pause time grouped by GC cause,
                    distinguishing young-gen vs old-gen collections.
                    """),

                new View(
                                "gc-efficiency",
                                "gc-analysis",
                                "GC Efficiency",
                                null,
                                """
                                 CREATE VIEW "gc-efficiency" AS
                                 SELECT
                                     g.gcId AS "GC ID",
                                     g.cause AS "Cause",
                                     format_duration(g.sumOfPauses) AS "Pause",
                                     format_memory(before.heapUsed - after.heapUsed) AS "Reclaimed",
                                     CASE WHEN g.sumOfPauses > 0 THEN
                                         round((before.heapUsed - after.heapUsed) / (1024.0 * 1024.0)
                                             / g.sumOfPauses, 1)
                                     ELSE 0 END AS "MB/s reclaimed"
                                 FROM GarbageCollection g
                                 JOIN GCHeapSummary before ON g.gcId = before.gcId AND before."when" = 'Before GC'
                                 JOIN GCHeapSummary after  ON g.gcId = after.gcId  AND after."when"  = 'After GC'
                                 ORDER BY g.gcId
                            """,
                                "GarbageCollection",
                                "GCHeapSummary")
                        .description(
                                """
                    Bytes reclaimed per millisecond of pause for each collection.
                    Low efficiency values indicate collections that paused long but freed little.
                    """),

                new View(
                                "heap-summary-over-time",
                                "gc-analysis",
                                "Heap Summary Over Time",
                                null,
                                """
                                 CREATE VIEW "heap-summary-over-time" AS
                                 SELECT
                                     startTime AS "Time",
                                     gcId AS "GC ID",
                                     "when" AS "When",
                                     format_memory(heapUsed) AS "Heap Used"
                                 FROM GCHeapSummary
                                 ORDER BY startTime
                            """,
                                "GCHeapSummary")
                        .description(
                                """
                    Heap used and committed size before and after each GC, ordered by time.
                    Pair with LINE_CHART LINK_X for an interactive heap timeline.
                    """),

                new View(
                                "heap-committed-vs-used",
                                "gc-analysis",
                                "Heap Committed vs Used",
                                null,
                                """
                                 CREATE VIEW "heap-committed-vs-used" AS
                                 SELECT
                                     startTime AS "Time",
                                     "when" AS "Phase",
                                     heapUsed / (1024.0 * 1024.0) AS "Used MB"
                                 FROM GCHeapSummary
                                 ORDER BY startTime
                            """,
                                "GCHeapSummary")
                        .description(
                                """
                    Raw heap used vs committed in MB, suitable for LINE_CHART rendering.
                    """),

                new View(
                                "allocation-rate",
                                "gc-analysis",
                                "Allocation Rate",
                                null,
                                """
                                 CREATE VIEW "allocation-rate" AS
                                 SELECT
                                     time_bucket(startTime, 1000) AS "Bucket",
                                     SUM(weight) / (1024.0 * 1024.0) AS "Sample MB/s",
                                     COUNT(*) AS "Samples"
                                 FROM ObjectAllocationSample
                                 GROUP BY time_bucket(startTime, 1000)
                                 ORDER BY 1
                            """,
                                "ObjectAllocationSample")
                        .description(
                                """
                    Per-second allocation rate in MB/s (from ObjectAllocationSample events).
                    Bucketed into 1-second windows. 'Sample MB/s' represents sampled allocation weight.
                    """),

                new View(
                                "allocation-by-class-detail",
                                "gc-analysis",
                                "Allocation by Class (Detail)",
                                null,
                                """
                                 CREATE VIEW "allocation-by-class-detail" AS
                                 SELECT
                                     objectClass AS "Class",
                                     COUNT(*) AS "Sample Events",
                                     format_memory(SUM(weight)) AS "Sampled Bytes",
                                     format_memory(AVG(weight)) AS "Avg Sample Weight"
                                 FROM ObjectAllocationSample
                                 GROUP BY objectClass
                                 ORDER BY SUM(weight) DESC
                                 LIMIT 30
                            """,
                                "ObjectAllocationSample")
                        .description(
                                """
                    Top 30 classes by sampled allocation weight (ObjectAllocationSample events).
                    """),

                new View(
                                "gc-concurrent-phases-detail",
                                "gc-analysis",
                                "GC Concurrent Phases",
                                null,
                                """
                                 CREATE VIEW "gc-concurrent-phases-detail" AS
                                 SELECT
                                     startTime AS "Start",
                                     name AS "Phase",
                                     gcId AS "GC ID",
                                     format_duration(duration) AS "Duration"
                                 FROM GCPhaseConcurrent
                                 ORDER BY startTime
                            """,
                                "GCPhaseConcurrent")
                        .description(
                                """
                    All concurrent (non-stop-the-world) GC phase events ordered by start time.
                    """),

                new View(
                                "safepoint-overhead",
                                "gc-analysis",
                                "Safepoint Overhead",
                                null,
                                """
                                 CREATE VIEW "safepoint-overhead" AS
                                 SELECT
                                     sb.startTime AS "Start",
                                     sb.safepointId AS "Safepoint ID",
                                     format_duration(ss.duration) AS "Sync Duration",
                                     sb.initialThreadCount AS "Initial Threads",
                                     sb.runningThreadCount AS "Running Threads"
                                 FROM SafepointBegin sb
                                 LEFT JOIN SafepointStateSynchronization ss ON sb.safepointId = ss.safepointId
                                 ORDER BY sb.startTime
                            """,
                                "SafepointBegin")
                        .description(
                                """
                    Per-safepoint overhead: total duration, synchronization time, and thread counts.
                    Includes both GC and non-GC safepoints (deopt, class redefinition, etc.).
                    """),

                new View(
                                "tlab-efficiency",
                                "gc-analysis",
                                "TLAB Efficiency",
                                null,
                                """
                                 CREATE VIEW "tlab-efficiency" AS
                                 SELECT
                                     time_bucket(startTime, 5000) AS "Bucket (5s)",
                                     SUM(allocationSize) / NULLIF(SUM(tlabSize), 0) AS "Fill Ratio",
                                     COUNT(*) AS "Allocations",
                                     format_memory(SUM(tlabSize)) AS "Total TLAB",
                                     format_memory(SUM(allocationSize)) AS "Total Allocated"
                                 FROM ObjectAllocationInNewTLAB
                                 GROUP BY time_bucket(startTime, 5000)
                                 ORDER BY 1
                            """,
                                "ObjectAllocationInNewTLAB")
                        .description(
                                """
                    TLAB fill ratio per 5-second window. A fill ratio close to 1.0 means TLABs
                    are well-sized; a low ratio means many half-empty TLABs are retired early.
                    """),

                new View(
                                "gc-throughput",
                                "gc-analysis",
                                "GC Throughput (10s windows)",
                                null,
                                """
                                 CREATE VIEW "gc-throughput" AS
                                 SELECT
                                     time_bucket(startTime, 10000) AS "Window",
                                     SUM(sumOfPauses) * 1000 AS "GC Time (ms)",
                                     10000 - (SUM(sumOfPauses) * 1000) AS "Mutator Time (ms)",
                                     ROUND(100.0 - (SUM(sumOfPauses) * 1000 / 10000.0 * 100), 1) AS "Throughput %"
                                 FROM GarbageCollection
                                 GROUP BY time_bucket(startTime, 10000)
                                 ORDER BY 1
                            """,
                                "GarbageCollection")
                        .description(
                                """
                    GC vs mutator time ratio in 10-second windows.
                    'Throughput %' is the fraction of time the application was NOT paused by GC.
                    """),

                new View(
                                "gc-overhead",
                                "gc-analysis",
                                "GC Overhead % (10s windows)",
                                null,
                                """
                                 CREATE VIEW "gc-overhead" AS
                                 SELECT
                                     time_bucket(startTime, 10000) AS "Window",
                                     ROUND(SUM(sumOfPauses) * 1000 / 10000.0 * 100, 2) AS "GC Overhead %",
                                     SUM(sumOfPauses) * 1000 AS "Pause ms",
                                     COUNT(*) AS "Collections"
                                 FROM GarbageCollection
                                 GROUP BY time_bucket(startTime, 10000)
                                 ORDER BY 1
                            """,
                                "GarbageCollection")
                        .description(
                                """
                    Rolling GC overhead percentage in 10-second windows.
                    High values (>5%) indicate the application is spending significant time in GC.
                    """),
                new View(
                                "heap-configuration",
                                "jvm",
                                "Heap Configuration",
                                "heap-configuration",
                                """
                                 CREATE VIEW "heap-configuration" AS
                                 SELECT
                                     format_memory(LAST(initialSize)) AS "Initial Size",
                                     format_memory(LAST(minSize)) AS "Minimum Size",
                                     format_memory(LAST(maxSize)) AS "Maximum Size",
                                     LAST(usesCompressedOops) AS "If Compressed Oops Are Used",
                                     LAST(compressedOopsMode) AS "Compressed Oops Mode"
                                 FROM GCHeapConfiguration
                            """,
                                "GCHeapConfiguration")
                        .description(
                                """
                    Displays the configuration settings of the JVM heap, including sizes and compressed oops usage.
                    """),
                /**
                 * [application.hot-methods] label = "Java Methods that Execute the Most" table =
                 * "COLUMN 'Method', 'Samples', 'Percent' FORMAT none, none, normalized SELECT
                 * stackTrace.topFrame AS T, COUNT(*), COUNT(*) FROM ExecutionSample GROUP BY T
                 * LIMIT 25"
                 */
                new View(
                                "hot-methods",
                                "application",
                                "Java Methods that Execute the Most",
                                "hot-methods",
                                """
                                 CREATE VIEW "hot-methods" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     COUNT(*) AS "Samples",
                                     format_percentage(COUNT(*) / (SELECT COUNT(*) FROM ExecutionSample)) AS "Percent"
                                 FROM ExecutionSample es
                                 JOIN Method m ON es.stackTrace$topMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY es.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(*) DESC
                                 LIMIT 25
                            """,
                                "ExecutionSample",
                                "Method",
                                "Class")
                        .description(
                                """
                    Identifies the top Java methods where the application spends the most execution time, based on sampling data.
                    """),
                /**
                 * [application.cpu-time-hot-methods] label = "Java Methods that Execute the Most
                 * from CPU Time Sampler" table = "COLUMN 'Method', 'Samples', 'Percent' FORMAT
                 * none, none, normalized SELECT stackTrace.topFrame AS T, COUNT(*), COUNT(*) FROM
                 * CPUTimeSample GROUP BY T LIMIT 25"
                 */
                new View(
                                "cpu-time-hot-methods",
                                "application",
                                "Java Methods that Execute the Most from CPU Time Sampler",
                                "cpu-time-hot-methods",
                                """
                                 CREATE VIEW "cpu-time-hot-methods" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     COUNT(*) AS "Samples",
                                     format_percentage(COUNT(*) / (SELECT COUNT(*) FROM CPUTimeSample)) AS "Percent"
                                 FROM CPUTimeSample cs
                                 JOIN Method m ON cs.stackTrace$topMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY cs.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(*) DESC
                                 LIMIT 25
                            """,
                                "CPUTimeSample",
                                "Method",
                                "Class")
                        .description(
                                """
                    Identifies the top Java methods where the application spends the most CPU time, based on CPU time sampling data.
                    """),
                /**
                 * [application.cpu-time-statistics] label = "CPU Time Sample Statistics" form =
                 * "COLUMN 'Successful Samples', 'Failed Samples', 'Biased Samples', 'Total
                 * Samples', 'Lost Samples' SELECT COUNT(S.startTime), COUNT(F.startTime),
                 * COUNT(B.startTime), Count(A.startTime), SUM(L.lostSamples) FROM CPUTimeSample AS
                 * S, CPUTimeSample AS F, CPUTimeSample AS A, CPUTimeSample AS B, CPUTimeSamplesLost
                 * AS L WHERE S.failed = 'false' AND F.failed = 'true' AND B.biased = 'true'"
                 */
                new View(
                                "cpu-time-statistics",
                                "application",
                                "CPU Time Sample Statistics",
                                "cpu-time-statistics",
                                """
                                 CREATE VIEW "cpu-time-statistics" AS
                                 SELECT
                                     (SELECT COUNT(*) FROM CPUTimeSample WHERE failed = FALSE) AS "Successful Samples",
                                     (SELECT COUNT(*) FROM CPUTimeSample WHERE failed = TRUE) AS "Failed Samples",
                                     (SELECT COUNT(*) FROM CPUTimeSample WHERE biased = TRUE) AS "Biased Samples",
                                     (SELECT COUNT(*) FROM CPUTimeSample) AS "Total Samples",
                                     (SELECT SUM(lostSamples) FROM CPUTimeSamplesLost) AS "Lost Samples"
                            """,
                                "CPUTimeSample",
                                "CPUTimeSamplesLost")
                        .description(
                                """
                    Provides statistics about CPU time sampling, including counts of successful, failed, biased, total, and lost samples.
                    """),
                /**
                 * [jvm.jdk-agents] label = "JDK Agents" table = "COLUMN 'Time', 'Initialization',
                 * 'Name', 'Options' FORMAT none, none, truncate-beginning;cell-height:10,
                 * cell-height:10 SELECT LAST(initializationTime) AS t, LAST(initializationDuration)
                 * AS d, LAST(name), LAST(JavaAgent.options) FROM JavaAgent, NativeAgent ORDER BY t"
                 */
                new View(
                                "jdk-agents",
                                "jvm",
                                "JDK Agents",
                                "jdk-agents",
                                """
                                 CREATE VIEW "jdk-agents" AS
                                 SELECT
                                     t AS "Time",
                                     format_duration(d) AS "Initialization",
                                     name AS "Name",
                                     o AS "Options"
                                 FROM (
                                     SELECT LAST(initializationTime) AS t, LAST(initializationDuration) AS d, name, LAST(options) AS o FROM JavaAgent GROUP BY name
                                     UNION ALL
                                     SELECT LAST(initializationTime) AS t, LAST(initializationDuration) AS d, name, LAST(options) AS o FROM NativeAgent GROUP BY name
                                 ) agents
                                 ORDER BY t
                            """,
                                "JavaAgent",
                                "NativeAgent")
                        .addUnionAlternatives()
                        .description(
                                """
                    Lists all JDK and native agents that were initialized, along with their initialization time and other info.
                    """),
                /**
                 * [environment.jvm-flags] label = "Command Line Flags" table = "SELECT name AS N,
                 * LAST(value) FROM IntFlag, UnsignedIntFlag, BooleanFlag, LongFlag,
                 * UnsignedLongFlag, DoubleFlag, StringFlag, IntFlagChanged, UnsignedIntFlagChanged,
                 * BooleanFlagChanged, LongFlagChanged, UnsignedLongFlagChanged, DoubleFlagChanged,
                 * StringFlagChanged GROUP BY name ORDER BY name ASC"
                 */
                new View(
                                "jvm-flags",
                                "environment",
                                "Command Line Flags",
                                "jvm-flags",
                                """
                                 CREATE VIEW "jvm-flags" AS
                                 SELECT
                                     name AS "Name",
                                     value AS "Value"
                                 FROM (
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM IntFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedIntFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM BooleanFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM LongFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedLongFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM DoubleFlag
                                     UNION ALL
                                     SELECT name, value FROM StringFlag
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM IntFlagChanged
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedIntFlagChanged
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM BooleanFlagChanged
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM LongFlagChanged
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM UnsignedLongFlagChanged
                                     UNION ALL
                                     SELECT name, CAST(value AS VARCHAR) AS value FROM DoubleFlagChanged
                                     UNION ALL
                                     SELECT name, value FROM StringFlagChanged
                                 ) flags
                                 GROUP BY name, value
                                 ORDER BY name ASC
                            """,
                                "IntFlag",
                                "UnsignedIntFlag",
                                "BooleanFlag",
                                "LongFlag",
                                "UnsignedLongFlag",
                                "DoubleFlag",
                                "StringFlag",
                                "IntFlagChanged",
                                "UnsignedIntFlagChanged",
                                "BooleanFlagChanged",
                                "LongFlagChanged",
                                "UnsignedLongFlagChanged",
                                "DoubleFlagChanged",
                                "StringFlagChanged")
                        .addUnionAlternatives()
                        .description(
                                """
                    Displays all JVM command line flags along with their current values.
                    """),
                /**
                 * [jvm.jvm-information] label = "JVM Information" form = "COLUMN 'PID', 'VM Start',
                 * 'Name', 'Version', 'VM Arguments', 'Program Arguments' SELECT LAST(pid),
                 * LAST(jvmStartTime), LAST(jvmName), LAST(jvmVersion), LAST(jvmArguments),
                 * LAST(javaArguments) FROM JVMInformation"
                 */
                new View(
                        "jvm-information",
                        "jvm",
                        "JVM Information",
                        "jvm-information",
                        """
                                 CREATE VIEW "jvm-information" AS
                                 SELECT
                                     LAST(pid) AS "PID",
                                     LAST(jvmStartTime) AS "VM Start",
                                     LAST(jvmName) AS "Name",
                                     LAST(jvmVersion) AS "Version",
                                     LAST(jvmArguments) AS "VM Arguments",
                                     LAST(javaArguments) AS "Program Arguments"
                                 FROM JVMInformation
                            """,
                        "JVMInformation"),
                /**
                 * [application.latencies-by-type] label = "Latencies by Type" table = "COLUMN
                 * 'Event Type', 'Count', 'Average', 'P 99', 'Longest', 'Total' SELECT
                 * eventType.label AS T, COUNT(*), AVG(duration), P99(duration), MAX(duration),
                 * SUM(duration) FROM JavaMonitorWait, JavaMonitorEnter, ThreadPark, ThreadSleep,
                 * SocketRead, SocketWrite, FileWrite, FileRead GROUP BY T"
                 */
                new View(
                                "latencies-by-type",
                                "application",
                                "Latencies by Type",
                                "latencies-by-type",
                                """
                                 CREATE VIEW "latencies-by-type" AS
                                 SELECT
                                     eventType AS "Event Type",
                                     COUNT(*) AS "Count",
                                     format_duration(AVG(duration)) AS "Average",
                                     format_duration(P99(duration)) AS "P 99",
                                     format_duration(MAX(duration)) AS "Longest",
                                     format_duration(SUM(duration)) AS "Total"
                                 FROM (
                                     SELECT 'Java Monitor Wait' AS eventType, duration FROM JavaMonitorWait
                                     UNION ALL
                                     SELECT 'Java Monitor Enter' AS eventType, duration FROM JavaMonitorEnter
                                     UNION ALL
                                     SELECT 'Thread Park' AS eventType, duration FROM ThreadPark
                                     UNION ALL
                                     SELECT 'Thread Sleep' AS eventType, duration FROM ThreadSleep
                                     UNION ALL
                                     SELECT 'Socket Read' AS eventType, duration FROM SocketRead
                                     UNION ALL
                                     SELECT 'Socket Write' AS eventType, duration FROM SocketWrite
                                     UNION ALL
                                     SELECT 'File Write' AS eventType, duration FROM FileWrite
                                     UNION ALL
                                     SELECT 'File Read' AS eventType, duration FROM FileRead
                                 ) latencies
                                 GROUP BY eventType
                                 ORDER BY SUM(duration) DESC
                            """,
                                "JavaMonitorWait",
                                "JavaMonitorEnter",
                                "ThreadPark",
                                "ThreadSleep",
                                "SocketRead",
                                "SocketWrite",
                                "FileWrite",
                                "FileRead")
                        .addUnionAlternatives()
                        .description(
                                """
                    Summarizes various latency events by type, including counts and duration statistics.
                    """),
                /**
                 * [application.memory-leaks-by-class] label = "Memory Leak Candidates by Class"
                 * table = "COLUMN 'Alloc. Time', 'Object Class', 'Object Age', 'Heap Usage' SELECT
                 * LAST_BATCH(allocationTime), LAST_BATCH(object.type), LAST_BATCH(objectAge),
                 * LAST_BATCH(lastKnownHeapUsage) FROM OldObjectSample GROUP BY object.type ORDER BY
                 * allocationTime"
                 */
                new View(
                        "memory-leaks-by-class",
                        "application",
                        "Memory Leak Candidates by Class",
                        "memory-leaks-by-class",
                        """
                                 CREATE VIEW "memory-leaks-by-class" AS
                                 SELECT
                                     LAST(allocationTime) AS "Alloc. Time",
                                     c.javaName AS "Object Class",
                                     format_duration(LAST(objectAge)) AS "Object Age",
                                     format_memory(LAST(lastKnownHeapUsage)) AS "Heap Usage"
                                 FROM OldObjectSample os
                                 JOIN OldObject o ON os.object = o._id
                                 JOIN Class c ON o.type = c._id
                                 GROUP BY c.javaName
                                 ORDER BY LAST(allocationTime) ASC
                            """,
                        "OldObjectSample",
                        "Class"),
                /**
                 * [application.memory-leaks-by-site] label = "Memory Leak Candidates by Site" table
                 * = "COLUMN 'Alloc. Time', 'Application Method', 'Object Age', 'Heap Usage' SELECT
                 * LAST_BATCH(allocationTime), LAST_BATCH(stackTrace.topApplicationFrame),
                 * LAST_BATCH(objectAge), LAST_BATCH(lastKnownHeapUsage) FROM OldObjectSample GROUP
                 * BY stackTrace.topApplicationFrame ORDER BY allocationTime"
                 */
                new View(
                        "memory-leaks-by-site",
                        "application",
                        "Memory Leak Candidates by Site",
                        "memory-leaks-by-site",
                        """
                                 CREATE VIEW "memory-leaks-by-site" AS
                                 SELECT
                                     LAST(allocationTime) AS "Alloc. Time",
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Application Method",
                                     format_duration(LAST(objectAge)) AS "Object Age",
                                     format_memory(LAST(lastKnownHeapUsage)) AS "Heap Usage"
                                 FROM OldObjectSample os
                                 JOIN Method m ON os.stackTrace$topApplicationMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY os.stackTrace$topApplicationMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY LAST(allocationTime) ASC
                            """,
                        "OldObjectSample",
                        "Method",
                        "Class"),
                /**
                 * [application.method-timing] label = "Method Timing" table = "COLUMN 'Timed
                 * Method', 'Invocations', 'Minimum Time', 'Average Time', 'Maximum Time' FORMAT
                 * none, none, ms-precision:6, ms-precision:6, ms-precision:6 SELECT
                 * LAST_BATCH(method) AS M, LAST_BATCH(invocations), LAST_BATCH(minimum),
                 * LAST_BATCH(average), LAST_BATCH(maximum) FROM jdk.MethodTiming GROUP BY method
                 * ORDER BY average"
                 */
                new View(
                                "method-timing",
                                "application",
                                "Method Timing",
                                "method-timing",
                                """
                                 CREATE VIEW "method-timing" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Timed Method",
                                     LAST(invocations) AS "Invocations",
                                     format_duration(LAST(minimum)) AS "Minimum Time",
                                     format_duration(LAST(average)) AS "Average Time",
                                     format_duration(LAST(maximum)) AS "Maximum Time"
                                 FROM MethodTiming mt
                                 JOIN Method m ON mt.method = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY mt.method, c.javaName, m.name, m.descriptor
                                 ORDER BY LAST(average) ASC
                            """,
                                "MethodTiming",
                                "Method",
                                "Class")
                        .description(
                                """
                    Provides timing statistics for methods, including invocation counts and time metrics.
                    """),
                /**
                 * [application.method-calls] label = "Method Calls" table = "COLUMN 'Traced
                 * Method', 'Caller', 'Invocations' SELECT method as M, stackTrace.topFrame.method
                 * AS S, COUNT(*) AS C FROM jdk.MethodTrace GROUP BY M, S ORDER BY C DESC"
                 */
                new View(
                                "method-calls",
                                "application",
                                "Method Calls",
                                "method-calls",
                                """
                                 CREATE VIEW "method-calls" AS
                                 SELECT
                                     (cm.javaName || '.' || m.name || m.descriptor) AS "Traced Method",
                                     (cc.javaName || '.' || sm.name || sm.descriptor) AS "Caller",
                                     COUNT(*) AS "Invocations"
                                 FROM MethodTrace mt
                                 JOIN Method m ON mt.method = m._id
                                 JOIN Class cm ON m.type = cm._id
                                 JOIN Method sm ON mt.stackTrace$topMethod = sm._id
                                 JOIN Class cc ON sm.type = cc._id
                                 GROUP BY mt.method, mt.stackTrace$topMethod, cm.javaName, m.name, m.descriptor, cc.javaName, sm.name, sm.descriptor
                                 ORDER BY COUNT(*) DESC
                            """,
                                "MethodTrace",
                                "Method",
                                "Class")
                        .description(
                                """
                    Displays method call relationships, showing which methods are called by which callers along with invocation counts.
                    """),
                /**
                 * [application.modules] label = "Modules" table = "SELECT LAST(source.name) AS S
                 * FROM ModuleRequire GROUP BY source.name ORDER BY S"
                 */
                new View(
                        "modules",
                        "application",
                        "Modules",
                        "modules",
                        """
                                 CREATE VIEW "modules" AS
                                 SELECT
                                     LAST(m.name) AS "Module Name"
                                 FROM ModuleRequire
                                 JOIN Module m ON ModuleRequire.source = m._id
                                 GROUP BY source
                                 ORDER BY "Module Name" ASC
                            """,
                        "ModuleRequire",
                        "Module"),
                /**
                 * [application.monitor-inflation] label = "Monitor Inflation" table = "SELECT
                 * stackTrace, monitorClass, COUNT(*), SUM(duration) AS S FROM
                 * jdk.JavaMonitorInflate GROUP BY stackTrace, monitorClass ORDER BY S"
                 */
                new View(
                                "monitor-inflation",
                                "application",
                                "Monitor Inflation",
                                "monitor-inflation",
                                """
                                 CREATE VIEW "monitor-inflation" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     mc.javaName AS "Monitor Class",
                                     COUNT(*) AS "Count",
                                     format_duration(SUM(jmi.duration)) AS "Total Duration"
                                 FROM JavaMonitorInflate jmi
                                 JOIN Method m ON jmi.stackTrace$topMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 JOIN Class mc ON jmi.monitorClass = mc._id
                                 GROUP BY jmi.stackTrace$topApplicationMethod, mc.javaName, c.javaName, m.name, m.descriptor
                                 ORDER BY SUM(jmi.duration) DESC
                            """,
                                "JavaMonitorInflate",
                                "Class")
                        .description(
                                """
                    Identifies methods that caused monitor inflation, along with the associated monitor classes and duration statistics.
                    """),
                /**
                 * [environment.native-libraries] label = "Native Libraries" table = "FORMAT
                 * cell-height:2, none, none SELECT name AS N, baseAddress, topAddress FROM
                 * NativeLibrary GROUP BY name ORDER BY N"
                 */
                new View(
                        "native-libraries",
                        "environment",
                        "Native Libraries",
                        "native-libraries",
                        """
                                 CREATE VIEW "native-libraries" AS
                                 SELECT
                                     name AS "Name",
                                     format_hex(baseAddress) AS "Base Address",
                                     format_hex(topAddress) AS "Top Address"
                                 FROM NativeLibrary
                                 GROUP BY name, baseAddress, topAddress
                                 ORDER BY name ASC
                            """,
                        "NativeLibrary"),
                /**
                 * [environment.native-library-failures] label = "Native Library Load/Unload
                 * Failures" table = "COLUMN 'Operation', 'Library', 'Error Message' FORMAT none,
                 * truncate-beginning, cell-height:10 SELECT eventType.label, name, errorMessage
                 * FROM NativeLibraryUnload, NativeLibraryLoad WHERE success = 'false'"
                 */
                new View(
                                "native-library-failures",
                                "environment",
                                "Native Library Load/Unload Failures",
                                "native-library-failures",
                                """
                                 CREATE VIEW "native-library-failures" AS
                                 SELECT
                                     eventType AS "Operation",
                                     name AS "Library",
                                     errorMessage AS "Error Message"
                                 FROM (
                                     SELECT 'Native Library Unload' AS eventType, name, errorMessage, success FROM NativeLibraryUnload
                                     UNION ALL
                                     SELECT 'Native Library Load' AS eventType, name, errorMessage, success FROM NativeLibraryLoad
                                 ) failures
                                 WHERE success = FALSE
                                 ORDER BY eventType ASC, name ASC
                            """,
                                "NativeLibraryUnload",
                                "NativeLibraryLoad")
                        .addUnionAlternatives()
                        .description(
                                """
                    Lists any failures that occurred during the loading or unloading of native libraries, along with error messages.
                    """),
                /**
                 * [jvm.native-memory-committed] label = "Native Memory Committed" table = "COLUMN
                 * 'Memory Type', 'First Observed', 'Average', 'Last Observed', 'Maximum' SELECT
                 * type, FIRST(committed), AVG(committed), LAST(committed), MAX(committed) AS M FROM
                 * NativeMemoryUsage GROUP BY type ORDER BY M DESC"
                 */
                new View(
                        "native-memory-committed",
                        "jvm",
                        "Native Memory Committed",
                        "native-memory-committed",
                        """
                                 CREATE VIEW "native-memory-committed" AS
                                 SELECT
                                     type AS "Memory Type",
                                     FIRST(committed) AS "First Observed",
                                     format_memory(AVG(committed)) AS "Average",
                                     LAST(committed) AS "Last Observed",
                                     format_memory(MAX(committed)) AS "Maximum"
                                 FROM NativeMemoryUsage
                                 GROUP BY type
                                 ORDER BY MAX(committed) DESC
                            """,
                        "NativeMemoryUsage"),
                /**
                 * [jvm.native-memory-reserved] label = "Native Memory Reserved" table = "COLUMN
                 * 'Memory Type', 'First Observed', 'Average', 'Last Observed', 'Maximum' SELECT
                 * type, FIRST(reserved), AVG(reserved), LAST(reserved), MAX(reserved) AS M FROM
                 * NativeMemoryUsage GROUP BY type ORDER BY M DESC"
                 */
                new View(
                        "native-memory-reserved",
                        "jvm",
                        "Native Memory Reserved",
                        "native-memory-reserved",
                        """
                                 CREATE VIEW "native-memory-reserved" AS
                                 SELECT
                                     type AS "Memory Type",
                                     FIRST(reserved) AS "First Observed",
                                     format_memory(AVG(reserved)) AS "Average",
                                     LAST(reserved) AS "Last Observed",
                                     format_memory(MAX(reserved)) AS "Maximum"
                                 FROM NativeMemoryUsage
                                 GROUP BY type
                                 ORDER BY MAX(reserved) DESC
                            """,
                        "NativeMemoryUsage"),
                /**
                 * [application.native-methods] label = "Waiting or Executing Native Methods" table
                 * = "COLUMN 'Method', 'Samples', 'Percent' FORMAT none, none, normalized SELECT
                 * stackTrace.topFrame AS T, COUNT(*), COUNT(*) FROM NativeMethodSample GROUP BY T"
                 */
                new View(
                                "native-methods",
                                "application",
                                "Waiting or Executing Native Methods",
                                "native-methods",
                                """
                                 CREATE VIEW "native-methods" AS
                                 SELECT
                                     (c.javaName || '.' || m.name || m.descriptor) AS "Method",
                                     COUNT(*) AS "Samples",
                                     format_percentage(COUNT(*) / (SELECT COUNT(*) FROM NativeMethodSample)) AS "Percent"
                                 FROM NativeMethodSample nms
                                 JOIN Method m ON nms.stackTrace$topMethod = m._id
                                 JOIN Class c ON m.type = c._id
                                 GROUP BY nms.stackTrace$topMethod, c.javaName, m.name, m.descriptor
                                 ORDER BY COUNT(*) DESC
                            """,
                                "NativeMethodSample",
                                "Method",
                                "Class")
                        .description(
                                """
                    Identifies the top native methods where the application spends the most time, based on sampling data.
                    """),
                /**
                 * [environment.network-utilization] label = "Network Utilization" table = "SELECT
                 * networkInterface, AVG(readRate), MAX(readRate), AVG(writeRate), MAX(writeRate)
                 * FROM NetworkUtilization GROUP BY networkInterface"
                 */
                new View(
                                "network-utilization",
                                "environment",
                                "Network Utilization",
                                "network-utilization",
                                """
                                 CREATE VIEW "network-utilization" AS
                                 SELECT
                                     networkInterface AS "Network Interface",
                                     format_memory(AVG(readRate) / 8) || '/s' AS "Avg. Read Rate",
                                     format_memory(MAX(readRate) / 8) || '/s' AS "Max. Read Rate",
                                     format_memory(AVG(writeRate) / 8) || '/s' AS "Avg. Write Rate",
                                     format_memory(MAX(writeRate) / 8) || '/s' AS "Max. Write Rate"
                                 FROM NetworkUtilization
                                 GROUP BY networkInterface
                                 ORDER BY networkInterface ASC
                            """,
                                "NetworkUtilization")
                        .description(
                                """
                    Displays network utilization statistics for each network interface, including read and write rates.
                    """),
                /**
                 * [application.object-statistics] label = "Objects Occupying More than 1%" table =
                 * "COLUMN 'Class', 'Count', 'Heap Space', 'Increase' SELECT
                 * LAST_BATCH(objectClass), LAST_BATCH(count), LAST_BATCH(totalSize),
                 * DIFF(totalSize) FROM ObjectCountAfterGC, ObjectCount GROUP BY objectClass ORDER
                 * BY totalSize DESC"
                 */
                new View(
                                "object-statistics",
                                "application",
                                "Objects Occupying More than 1%",
                                "object-statistics",
                                """
                            CREATE VIEW "object-statistics" AS
                            SELECT "Class", "Count", "Heap Space", "Increase"
                            FROM
                            (SELECT
                                c.javaName AS "Class",
                                LAST(count) AS "Count",
                                format_memory(LAST(totalSize)) AS "Heap Space",
                                LAST(totalSize) as h,
                                format_memory(MAX(totalSize) - MIN(totalSize)) AS "Increase"
                            FROM (
                                SELECT objectClass, count, totalSize FROM ObjectCountAfterGC
                                UNION ALL
                                SELECT objectClass, count, totalSize FROM ObjectCount
                            ) ocg
                            JOIN Class c ON ocg.objectClass = c._id
                            GROUP BY c.javaName)
                            ORDER BY h DESC
                            """,
                                "ObjectCountAfterGC",
                                "ObjectCount",
                                "Class")
                        .addUnionAlternatives()
                        .description(
                                """
                    Summarizes object statistics by class, including counts, heap space usage, and increases over time.
                    """),
                /**
                 * [application.pinned-threads] label = "Pinned Virtual Threads" table = "COLUMN
                 * 'Method', 'Pinned Count', 'Longest Pinning', 'Total Time Pinned' SELECT
                 * stackTrace.topApplicationFrame AS S, COUNT(*), MAX(duration), SUM(duration) AS T
                 * FROM VirtualThreadPinned GROUP BY S ORDER BY T DESC"
                 */
                new View(
                                "pinned-threads", // TODO test
                                "application",
                                "Pinned Virtual Threads",
                                "pinned-threads",
                                """
                            CREATE VIEW "pinned-threads" AS
                            SELECT
                                (c.javaName || '.' || vtp.stackTrace$topApplicationMethod) AS "Method",
                                COUNT(*) AS "Pinned Count",
                                format_duration(MAX(vtp.duration)) AS "Longest Pinning",
                                format_duration(SUM(vtp.duration)) AS "Total Time Pinned"
                            FROM VirtualThreadPinned vtp
                            JOIN Class c ON vtp.stackTrace$topApplicationClass = c._id
                            GROUP BY vtp.stackTrace$topApplicationMethod, vtp.stackTrace$topApplicationClass, c.javaName
                            ORDER BY SUM(vtp.duration) DESC
                            """,
                                "VirtualThreadPinned",
                                "Class")
                        .description(
                                """
                    Identifies virtual threads that have been pinned, along with statistics on pinning duration and counts.
                    """),
                /**
                 * [application.thread-count] label ="Java Thread Statistics" table = "SELECT * FROM
                 * JavaThreadStatistics"
                 */
                new View(
                        "thread-count",
                        "application",
                        "Java Thread Statistics",
                        "thread-count",
                        """
                            CREATE VIEW "thread-count" AS
                            SELECT
                            startTime AS "Start Time",
                            activeCount AS "Active Threads",
                            daemonCount AS "Daemon Threads",
                            accumulatedCount AS "Accumulated Threads",
                            peakCount AS "Peak Threads"
                            FROM JavaThreadStatistics
                            ORDER BY startTime ASC
                            """,
                        "JavaThreadStatistics"),
                /**
                 * [environment.recording] label = "Recording Information" form = "COLUMN 'Event
                 * Count', 'First Recorded Event', 'Last Recorded Event', 'Length of Recorded
                 * Events', 'Dump Reason' SELECT COUNT(startTime), FIRST(startTime),
                 * LAST(startTime), DIFF(startTime), LAST(jdk.Shutdown.reason) FROM *
                 *
                 * <p>new Table.Column("eventCount", "INTEGER", null), new
                 * Table.Column("firstEvent", "TIMESTAMP", null), new Table.Column("lastEvent",
                 * "TIMESTAMP", null), new Table.Column("eventDurationSeconds", "DOUBLE", null), new
                 * Table.Column("dumpReason", "VARCHAR", null)
                 */
                new View(
                        "recording",
                        "environment",
                        "Recording Information",
                        "recording",
                        """
                            CREATE VIEW "recording" AS
                            SELECT
                                eventCount AS "Event Count",
                                firstEvent AS "First Recorded Event",
                                lastEvent AS "Last Recorded Event",
                                format_duration(eventDurationSeconds) AS "Length of Recorded Events",
                                dumpReason AS "Dump Reason"
                            FROM RecordingInfo
                            """,
                        "RecordingInfo"),
                /**
                 * [jvm.safepoints] label = "Safepoints" table = "COLUMN 'Start Time', 'Duration',
                 * 'State Syncronization', 'Cleanup', 'JNI Critical Threads', 'Total Threads' SELECT
                 * B.startTime, DIFF([B|E].startTime), S.duration, C.duration,
                 * jniCriticalThreadCount, totalThreadCount FROM SafepointBegin AS B, SafepointEnd
                 * AS E, SafepointCleanup AS C, SafepointStateSynchronization AS S GROUP BY
                 * safepointId ORDER BY B.startTime"
                 */
                new View(
                                "safepoints", // TODO test
                                "jvm",
                                "Safepoints",
                                "safepoints",
                                """
                            CREATE VIEW "safepoints" AS
                            SELECT
                                B.startTime AS "Start Time",
                                format_duration(epoch(E.startTime - B.startTime)) AS "Duration",
                                format_duration(S.duration) AS "State Synchronization",
                                format_duration(C.duration) AS "Cleanup",
                                jniCriticalThreadCount AS "JNI Critical Threads",
                                totalThreadCount AS "Total Threads"
                            FROM SafepointBegin B
                            JOIN SafepointEnd E ON B.safepointId = E.safepointId
                            LEFT JOIN SafepointStateSynchronization S ON B.safepointId = S.safepointId
                            LEFT JOIN SafepointCleanup C ON B.safepointId = C.safepointId
                            ORDER BY B.startTime ASC
                            """,
                                "SafepointBegin",
                                "SafepointEnd",
                                "SafepointStateSynchronization",
                                "SafepointCleanup")
                        .addAlternative(
                                "SafepointStateSynchronization",
                                "SafepointBegin",
                                "SafepointEnd",
                                """
                    CREATE VIEW "safepoints" AS
                    SELECT
                        B.startTime AS "Start Time",
                        format_duration(epoch(E.startTime - B.startTime)) AS "Duration",
                        format_duration(S.duration) AS "State Synchronization",
                        jniCriticalThreadCount AS "JNI Critical Threads",
                        totalThreadCount AS "Total Threads"
                    FROM SafepointBegin B
                    JOIN SafepointEnd E ON B.safepointId = E.safepointId
                    LEFT JOIN SafepointStateSynchronization S ON B.safepointId = S.safepointId
                    ORDER BY B.startTime ASC
                    """),
                /**
                 * [jvm.longest-compilations] label = "Longest Compilations" table = "SELECT
                 * startTime, duration AS D, method, compileLevel, succeded FROM Compilation ORDER
                 * BY D LIMIT 25"
                 */
                new View(
                        "longest-compilations",
                        "jvm",
                        "Longest Compilations",
                        "longest-compilations",
                        """
                            CREATE VIEW "longest-compilations" AS
                            SELECT
                                startTime AS "Start Time",
                                format_duration(duration) AS "Duration",
                                (c.javaName || '.' || m.name) AS "Method",
                                compileLevel AS "Compile Level",
                                Compilation.succeded AS "Succeeded"
                            FROM Compilation
                            JOIN Method m ON Compilation.method = m._id
                            JOIN Class c ON m.type = c._id
                            ORDER BY duration DESC
                            LIMIT 25
                            """,
                        "Compilation",
                        "Method",
                        "Class"),
                /**
                 * [application.longest-class-loading] label = "Longest Class Loading" table =
                 * "COLUMN 'Time', 'Loaded Class', 'Load Time' SELECT startTime,loadedClass,
                 * duration AS D FROM ClassLoad ORDER BY D DESC LIMIT 25"
                 */
                new View(
                        "longest-class-loading",
                        "application",
                        "Longest Class Loading",
                        "longest-class-loading",
                        """
                            CREATE VIEW "longest-class-loading" AS
                            SELECT
                                startTime AS "Time",
                                c.javaName AS "Loaded Class",
                                format_duration(duration) AS "Load Time"
                            FROM ClassLoad cl
                            JOIN Class c ON cl.loadedClass = c._id
                            ORDER BY duration DESC
                            LIMIT 25
                            """,
                        "ClassLoad",
                        "Class"),
                /**
                 * [environment.system-properties] label = "System Properties at Startup" table =
                 * "FORMAT none, cell-height:25 SELECT key AS K, value FROM InitialSystemProperty
                 * GROUP BY key ORDER by K"
                 */
                new View(
                        "system-properties",
                        "environment",
                        "System Properties at Startup",
                        "system-properties",
                        """
                            CREATE VIEW "system-properties" AS
                            SELECT
                                key AS "Key",
                                value AS "Value"
                            FROM InitialSystemProperty
                            GROUP BY key, value
                            ORDER BY key ASC
                            """,
                        "InitialSystemProperty"),
                /**
                 * [application.socket-writes-by-host] label = "Socket Writes by Host" table =
                 * "COLUMN 'Host', 'Writes', 'Total Written' FORMAT cell-height:2, none, none SELECT
                 * host, COUNT(*), SUM(bytesWritten) AS S FROM SocketWrite GROUP BY host ORDER BY S
                 * DESC"
                 */
                new View(
                        "socket-writes-by-host",
                        "application",
                        "Socket Writes by Host",
                        "socket-writes-by-host",
                        """
                            CREATE VIEW "socket-writes-by-host" AS
                            SELECT
                                host AS "Host",
                                COUNT(*) AS "Writes",
                                format_memory(SUM(bytesWritten)) AS "Total Written"
                            FROM SocketWrite
                            GROUP BY host
                            ORDER BY SUM(bytesWritten) DESC
                            """,
                        "SocketWrite"),
                /**
                 * [application.socket-reads-by-host] label = "Socket Reads by Host" table = "COLUMN
                 * 'Host', 'Reads', 'Total Read' FORMAT cell-height:2, none, none SELECT host,
                 * COUNT(*), SUM(bytesRead) AS S FROM SocketRead GROUP BY host ORDER BY S DESC"
                 */
                new View(
                        "socket-reads-by-host",
                        "application",
                        "Socket Reads by Host",
                        "socket-reads-by-host",
                        """
                            CREATE VIEW "socket-reads-by-host" AS
                            SELECT
                                host AS "Host",
                                COUNT(*) AS "Reads",
                                format_memory(SUM(bytesRead)) AS "Total Read"
                            FROM SocketRead
                            GROUP BY host
                            ORDER BY SUM(bytesRead) DESC
                            """,
                        "SocketRead"),
                /**
                 * [environment.system-information] label = "System Information" form = "COLUMN
                 * 'Total Physical Memory Size', 'OS Version', 'Virtualization', 'CPU Type', 'Number
                 * of Cores', 'Number of Hardware Threads', 'Number of Sockets', 'CPU Description'
                 * SELECT LAST(totalSize), LAST(osVersion), LAST(name), LAST(cpu), LAST(cores),
                 * LAST(hwThreads), LAST(sockets), LAST(description) FROM CPUInformation,
                 * PhysicalMemory, OSInformation, VirtualizationInformation"
                 */
                new View(
                        "system-information",
                        "environment",
                        "System Information",
                        "system-information",
                        """
                            CREATE VIEW "system-information" AS
                            SELECT
                                format_memory(LAST(pm.totalSize)) AS "Total Physical Memory Size",
                                LAST(osi.osVersion) AS "OS Version",
                                LAST(vi.name) AS "Virtualization",
                                LAST(cii.cpu) AS "CPU Type",
                                LAST(cii.cores) AS "Number of Cores",
                                LAST(cii.hwThreads) AS "Number of Hardware Threads",
                                LAST(cii.sockets) AS "Number of Sockets",
                                LAST(cii.description) AS "CPU Description"
                            FROM PhysicalMemory pm, OSInformation osi, CPUInformation cii, VirtualizationInformation vi
                            """,
                        "PhysicalMemory",
                        "OSInformation",
                        "CPUInformation",
                        "VirtualizationInformation"),
                /**
                 * [environment.system-processes] label = "System Processes" table = "COLUMN 'First
                 * Observed', 'Last Observed', 'PID', 'Command Line' SELECT FIRST(startTime),
                 * LAST(startTime), FIRST(pid), FIRST(commandLine) FROM SystemProcess GROUP BY pid"
                 */
                new View(
                        "system-processes",
                        "environment",
                        "System Processes",
                        "system-processes",
                        """
                            CREATE VIEW "system-processes" AS
                            SELECT
                                FIRST(startTime) AS "First Observed",
                                LAST(startTime) AS "Last Observed",
                                pid AS "PID",
                                FIRST(commandLine) AS "Command Line"
                            FROM SystemProcess
                            GROUP BY pid
                            ORDER BY FIRST(startTime) ASC
                            """,
                        "SystemProcess"),
                /**
                 * [jvm.tlabs] label = "Thread Local Allocation Buffers" form = "COLUMN 'Inside TLAB
                 * Count', 'Inside TLAB Minimum Size', 'Inside TLAB Average Size', 'Inside TLAB
                 * Maximum Size', 'Inside TLAB Total Allocation', 'Outside TLAB Count', 'OutSide
                 * TLAB Minimum Size', 'Outside TLAB Average Size', 'Outside TLAB Maximum Size',
                 * 'Outside TLAB Total Allocation' SELECT COUNT(I.tlabSize), MIN(I.tlabSize),
                 * AVG(I.tlabSize), MAX(I.tlabSize), SUM(I.tlabSize), COUNT(O.allocationSize),
                 * MIN(O.allocationSize), AVG(O.allocationSize), MAX(O.allocationSize),
                 * SUM(O.allocationSize) FROM ObjectAllocationInNewTLAB AS I,
                 * ObjectAllocationOutsideTLAB AS O"
                 */
                new View(
                        "tlabs",
                        "jvm",
                        "Thread Local Allocation Buffers",
                        "tlabs",
                        """
                            CREATE VIEW "tlabs" AS
                            SELECT * FROM (SELECT
                                COUNT(tlabSize) AS "Inside Count",
                                format_memory(MIN(tlabSize)) AS "Inside Minimum Size",
                                format_memory(AVG(tlabSize)) AS "Inside Average Size",
                                format_memory(MAX(tlabSize)) AS "Inside Maximum Size",
                                format_memory(SUM(tlabSize)) AS "Inside Total Allocation"
                            FROM ObjectAllocationInNewTLAB),
                            (SELECT
                                COUNT(allocationSize) AS "Outside Count",
                                format_memory(MIN(allocationSize)) AS "Outside Minimum Size",
                                format_memory(AVG(allocationSize)) AS "Outside Average Size",
                                format_memory(MAX(allocationSize)) AS "Outside Maximum Size",
                                format_memory(SUM(allocationSize)) AS "Outside Total Allocation"
                            FROM ObjectAllocationOutsideTLAB)
                            """,
                        "ObjectAllocationInNewTLAB",
                        "ObjectAllocationOutsideTLAB"),
                /**
                 * [application.thread-allocation] label = "Thread Allocation Statistics" table =
                 * "COLUMN 'Thread', 'Allocated', 'Percentage' FORMAT none, none, normalized SELECT
                 * thread, LAST(allocated), LAST(allocated) AS A FROM ThreadAllocationStatistics
                 * GROUP BY thread ORDER BY A DESC"
                 */
                new View(
                        "thread-allocation", // TODO test
                        "application",
                        "Thread Allocation Statistics",
                        "thread-allocation",
                        """
                            CREATE VIEW "thread-allocation" AS
                            SELECT
                                thread AS "Thread",
                                LAST(allocated) AS "Allocated",
                                format_percentage(
                                    LAST(allocated) * 1.0 / SUM(LAST(allocated)) OVER ()
                                ) AS "Percentage"
                            FROM ThreadAllocationStatistics
                            GROUP BY thread
                            ORDER BY "Allocated" DESC
                            """,
                        "ThreadAllocationStatistics"),
                /**
                 * [application.thread-cpu-load] label = "Thread CPU Load" table = "COLUMN 'Thread',
                 * 'System', 'User' SELECT eventThread AS E, LAST(system), LAST(user) AS U FROM
                 * ThreadCPULoad GROUP BY E ORDER BY U DESC"
                 */
                new View(
                        "thread-cpu-load",
                        "application",
                        "Thread CPU Load",
                        "thread-cpu-load",
                        """
                            CREATE VIEW "thread-cpu-load" AS
                            SELECT
                                t.javaName AS "Thread",
                                format_percentage(LAST(system)) AS "System",
                                format_percentage(LAST(user)) AS "User"
                            FROM ThreadCPULoad
                            JOIN Thread t ON ThreadCPULoad.eventThread = t._id
                            GROUP BY t.javaName
                            ORDER BY LAST(user) DESC, LAST(system) DESC
                            """,
                        "ThreadCPULoad",
                        "Thread"),
                /**
                 * [application.thread-start] label = "Platform Thread Start by Method" table =
                 * "COLUMN 'Start Time','Stack Trace', 'Thread', 'Duration' SELECT S.startTime,
                 * S.stackTrace, eventThread, DIFF(startTime) AS D FROM ThreadStart AS S, ThreadEnd
                 * AS E GROUP by eventThread ORDER BY D DESC"
                 */
                new View(
                        "thread-start",
                        "application",
                        "Platform Thread Start by Method",
                        "thread-start",
                        """
                            CREATE VIEW "thread-start" AS
                            SELECT
                                CASE
                                    WHEN j.ts_start IS NOT NULL THEN j.ts_start
                                    ELSE NULL
                                END AS "Start Time",
                                CASE
                                    WHEN c.javaName IS NULL THEN m.name || m.descriptor
                                    ELSE (c.javaName || '.' || m.name || m.descriptor)
                                END AS "Stack Trace",
                                t.javaName AS "Thread",
                                CASE
                                    WHEN j.ts_start IS NULL THEN 'unknown'        -- only End, can't compute
                                    WHEN j.te_start IS NULL THEN 'infinity'      -- no End -> infinite
                                    ELSE format_duration(epoch(j.te_start - j.ts_start))
                                END AS "Duration"
                            FROM Thread t
                            JOIN (
                                SELECT
                                    COALESCE(ts.eventThread, te.eventThread) AS eventThread,
                                    ts.startTime AS ts_start,
                                    te.startTime AS te_start,
                                    ts.stackTrace$topMethod
                                FROM ThreadStart ts
                                FULL OUTER JOIN ThreadEnd te
                                  ON ts.eventThread = te.eventThread
                            ) j ON j.eventThread = t._id
                            LEFT JOIN Method m ON j.stackTrace$topMethod = m._id
                            LEFT JOIN Class c ON m.type = c._id
                            WHERE t.javaName IS NOT NULL
                            QUALIFY ROW_NUMBER() OVER (
                                PARTITION BY j.eventThread
                                ORDER BY
                                    CASE
                                        WHEN j.ts_start IS NOT NULL AND j.te_start IS NOT NULL
                                             AND j.te_start >= j.ts_start THEN 0  -- prefer valid duration
                                        WHEN j.ts_start IS NOT NULL AND j.te_start IS NULL THEN 1 -- infinity
                                        WHEN j.ts_start IS NULL AND j.te_start IS NOT NULL THEN 2 -- only end
                                        ELSE 3
                                    END
                            ) = 1
                            ORDER BY
                                CASE
                                    WHEN j.te_start IS NULL AND j.ts_start IS NOT NULL THEN 0 -- infinity first
                                    ELSE 1
                                END,
                                (j.te_start - j.ts_start) DESC NULLS LAST, j.ts_start ASC;
                            """,
                        "Thread",
                        "ThreadStart",
                        "ThreadEnd",
                        "Method",
                        "Class"),
                /**
                 * [jvm.vm-operations] label = "VM Operations" table = "COLUMN 'VM Operation',
                 * 'Average Duration', 'Longest Duration', 'Count' , 'Total Duration' SELECT
                 * operation, AVG(duration), MAX(duration), COUNT(*), SUM(duration) FROM
                 * jdk.ExecuteVMOperation GROUP BY operation"
                 */
                new View(
                        "vm-operations",
                        "jvm",
                        "VM Operations",
                        "vm-operations",
                        """
                            CREATE VIEW "vm-operations" AS
                            SELECT
                                operation AS "VM Operation",
                                format_duration(AVG(duration)) AS "Average Duration",
                                format_duration(MAX(duration)) AS "Longest Duration",
                                COUNT(*) AS "Count",
                                format_duration(SUM(duration)) AS "Total Duration"
                            FROM ExecuteVMOperation
                            GROUP BY operation
                            ORDER BY SUM(duration) DESC
                            """,
                        "ExecuteVMOperation"),
                // ── jvmlog views ──────────────────────────────────────────────────
                new View(
                        "jvmlog-gc-summary",
                        "jvmlog",
                        "GC Log: Pause Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-summary" AS
                            SELECT
                                cause AS "Cause",
                                count(*) AS "Count",
                                round(sum(pauseMs), 1) AS "Total ms",
                                round(avg(pauseMs), 2) AS "Avg ms",
                                round(approx_quantile(pauseMs, 0.5), 2) AS "P50 ms",
                                round(approx_quantile(pauseMs, 0.9), 2) AS "P90 ms",
                                round(approx_quantile(pauseMs, 0.99), 2) AS "P99 ms",
                                round(max(pauseMs), 2) AS "Max ms"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY cause
                            ORDER BY "Total ms" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("GC pause statistics grouped by cause from JVM GC log."),
                new View(
                        "jvmlog-pause-percentiles",
                        "jvmlog",
                        "GC Log: Pause Percentiles",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-percentiles" AS
                            SELECT
                                round(approx_quantile(pauseMs, 0.5),  2) AS "P50 ms",
                                round(approx_quantile(pauseMs, 0.9),  2) AS "P90 ms",
                                round(approx_quantile(pauseMs, 0.95), 2) AS "P95 ms",
                                round(approx_quantile(pauseMs, 0.99), 2) AS "P99 ms",
                                round(max(pauseMs), 2) AS "Max ms",
                                count(*) AS "Count"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            """,
                        "jvmlog_gc_event")
                    .description("Overall pause-time percentiles from the JVM GC log."),
                new View(
                        "jvmlog-gc-overhead",
                        "jvmlog",
                        "GC Log: GC Overhead",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-overhead" AS
                            SELECT
                                floor(uptimeSecs / 10) * 10 AS "Window Start (s)",
                                round(sum(pauseMs) / 10000.0 * 100, 2) AS "GC Overhead %",
                                count(*) AS "GC Events"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 10)
                            ORDER BY 1
                            """,
                        "jvmlog_gc_event")
                    .description("Stop-the-world overhead as percentage of wall time in 10-second windows."),
                new View(
                        "jvmlog-heap-snapshot-raw",
                        "jvmlog",
                        "GC Log: Heap Snapshot (raw bytes)",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-snapshot-raw" AS
                            SELECT
                                gcId AS "GC ID",
                                heapBefore / 1048576.0 AS "Heap Before (MB)",
                                heapAfter / 1048576.0 AS "Heap After (MB)",
                                heapCommittedBefore / 1048576.0 AS "Committed Before (MB)",
                                heapCommittedAfter / 1048576.0 AS "Committed After (MB)"
                            FROM jvmlog_heap_snapshot
                            ORDER BY gcId
                            """,
                        "jvmlog_heap_snapshot")
                    .description("Heap size before and after each GC event (raw, without pause time)."),
                new View(
                        "jvmlog-phase-breakdown",
                        "jvmlog",
                        "GC Log: Phase Breakdown",
                        null,
                        """
                            CREATE VIEW "jvmlog-phase-breakdown" AS
                            SELECT
                                phaseName AS "Phase",
                                count(*) AS "Count",
                                round(avg(durationMs), 2) AS "Avg ms",
                                round(approx_quantile(durationMs, 0.99), 2) AS "P99 ms",
                                round(max(durationMs), 2) AS "Max ms"
                            FROM jvmlog_gc_phase
                            WHERE durationMs IS NOT NULL
                            GROUP BY phaseName
                            ORDER BY "Avg ms" DESC
                            """,
                        "jvmlog_gc_phase")
                    .description("Average and P99 duration per GC phase from the JVM GC log."),
                new View(
                        "jvmlog-phase-timeline",
                        "jvmlog",
                        "GC Log: Phase Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-phase-timeline" AS
                            SELECT gcId AS "GC ID",
                                   phaseName AS "Phase",
                                   round(durationMs, 2) AS "Duration (ms)",
                                   uptimeSecs AS "Uptime (s)"
                            FROM jvmlog_gc_phase
                            WHERE durationMs IS NOT NULL
                            ORDER BY uptimeSecs NULLS LAST, gcId
                            """,
                        "jvmlog_gc_phase")
                    .description("Per-GC phase durations over time, useful for spotting trends."),
                new View(
                        "jvmlog-g1-regions",
                        "jvmlog",
                        "GC Log: G1 Region Counts",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-regions" AS
                            SELECT
                                r.gcId AS "GC ID",
                                e.cause AS "Cause",
                                max(r.edenBefore) AS "Eden Before",
                                max(r.edenAfter) AS "Eden After",
                                max(r.edenMax) AS "Eden Max",
                                max(r.survivorBefore) AS "Survivor Before",
                                max(r.survivorAfter) AS "Survivor After",
                                max(r.oldBefore) AS "Old Before",
                                max(r.oldAfter) AS "Old After",
                                max(r.humongousBefore) AS "Humongous Before",
                                max(r.humongousAfter) AS "Humongous After"
                            FROM jvmlog_g1_regions r
                            LEFT JOIN jvmlog_gc_event e ON r.gcId = e.gcId
                            GROUP BY r.gcId, e.cause
                            ORDER BY r.gcId
                            """,
                        "jvmlog_g1_regions",
                        "jvmlog_gc_event")
                    .description("G1 Eden, Survivor, Old, and Humongous region counts before and after each GC event."),
                new View(
                        "jvmlog-zgc-cycle",
                        "jvmlog",
                        "GC Log: ZGC Cycle Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-cycle" AS
                            SELECT
                                gcId AS "GC ID",
                                generation AS "Generation",
                                sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS "Concurrent ms",
                                sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS "Pause ms"
                            FROM jvmlog_zgc_phases
                            GROUP BY gcId, generation
                            ORDER BY gcId
                            """,
                        "jvmlog_zgc_phases")
                    .description("Concurrent vs stop-the-world time per ZGC cycle."),
                new View(
                        "jvmlog-jfr-correlation",
                        "jvmlog",
                        "GC Log: JFR vs Log Correlation",
                        null,
                        """
                            CREATE VIEW "jvmlog-jfr-correlation" AS
                            SELECT
                                gcId AS "GC ID",
                                source AS "Source",
                                round(jfrLongestPauseMs, 2) AS "JFR Pause ms",
                                round(logPauseMs, 2) AS "Log Pause ms",
                                round(abs(jfrLongestPauseMs - logPauseMs), 2) AS "Delta ms"
                            FROM jvmlog_jfr_correlation
                            ORDER BY gcId
                            """,
                        "jvmlog_jfr_correlation")
                    .description("Side-by-side comparison of pause times from JFR events and the GC log."),
                new View(
                        "jvmlog-gc-pause-summary",
                        "jvmlog",
                        "GC Log: Pause Summary by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-pause-summary" AS
                            SELECT cause AS "Cause",
                                   count(*) AS "Count",
                                   round(avg(pauseMs), 2) AS "Avg (ms)",
                                   round(max(pauseMs), 2) AS "Max (ms)",
                                   round(sum(pauseMs), 1) AS "Total (ms)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY cause
                            ORDER BY "Total (ms)" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Per-cause pause statistics: count, average, max, and total pause time."),
                new View(
                        "jvmlog-gc-pause-by-type",
                        "jvmlog",
                        "GC Log: Pause Stats by GC Type",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-pause-by-type" AS
                            SELECT gcType AS "Type",
                                   count(*) AS "Count",
                                   round(avg(pauseMs), 2) AS "Avg (ms)",
                                   round(max(pauseMs), 2) AS "Max (ms)"
                            FROM jvmlog_gc_event
                            GROUP BY gcType
                            ORDER BY "Count" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Per-GC-type pause statistics: count, average, and max pause time."),
                new View(
                        "jvmlog-heap-timeline",
                        "jvmlog",
                        "GC Log: Heap Timeline (MB)",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-timeline" AS
                            SELECT h.gcId AS "gcId",
                                   round(h.heapBefore / 1048576.0, 2) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 2) AS "Heap After (MB)",
                                   round(h.heapCommittedBefore / 1048576.0, 2) AS "Committed Before (MB)",
                                   round(h.heapCommittedAfter / 1048576.0, 2) AS "Committed After (MB)",
                                   e.pauseMs AS "Pause (ms)"
                            FROM jvmlog_heap_snapshot h
                            LEFT JOIN jvmlog_gc_event e ON h.gcId = e.gcId
                            QUALIFY row_number() OVER (PARTITION BY h.gcId ORDER BY h.heapCommittedBefore DESC NULLS LAST) = 1
                            ORDER BY h.gcId
                            """,
                        "jvmlog_heap_snapshot",
                        "jvmlog_gc_event")
                    .description("Heap before and after each GC cycle (converted from bytes to MB), joined with pause time."),
                new View(
                        "jvmlog-gc-phase-breakdown",
                        "jvmlog",
                        "GC Log: Phase Breakdown",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-phase-breakdown" AS
                            SELECT phaseName AS "Phase",
                                   count(*) AS "Count",
                                   round(avg(durationMs), 2) AS "Avg (ms)",
                                   round(max(durationMs), 2) AS "Max (ms)",
                                   round(sum(durationMs), 1) AS "Total (ms)"
                            FROM jvmlog_gc_phase
                            GROUP BY phaseName
                            ORDER BY "Avg (ms)" DESC
                            """,
                        "jvmlog_gc_phase")
                    .description("Average phase durations across all GC cycles."),
                new View(
                        "jvmlog-gc-init-summary",
                        "jvmlog",
                        "GC Log: Init Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-init-summary" AS
                            SELECT max(algorithm) AS "Algorithm",
                                   max(jdkVersion) AS "JDK Version",
                                   round(max(minHeap) / 1048576.0, 0) AS "Min Heap (MB)",
                                   round(max(initialHeap) / 1048576.0, 0) AS "Initial Heap (MB)",
                                   round(max(maxHeap) / 1048576.0, 0) AS "Max Heap (MB)",
                                   round(max(softMaxCapacity) / 1048576.0, 0) AS "Soft Max (MB)",
                                   max(parallelWorkers) AS "Parallel Workers",
                                   max(concurrentWorkers) AS "Concurrent Workers",
                                   max(cpuTotal) AS "CPUs",
                                   round(max(physicalMemory) / 1073741824.0, 1) AS "Physical Memory (GB)",
                                   max(numaSupport) AS "NUMA",
                                   max(heapRegionSize) AS "Region Bytes",
                                   max(periodicGc) AS "Periodic GC",
                                   max(preTouch) AS "PreTouch"
                            FROM jvmlog_gc_init
                            """,
                        "jvmlog_gc_init")
                    .description("GC configuration summary: algorithm, JDK version, heap sizing, worker counts, and hardware info."),
                new View(
                        "jvmlog-gc-cumulative-pause",
                        "jvmlog",
                        "GC Log: Cumulative Pause Time",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-cumulative-pause" AS
                            SELECT gcId AS "GC ID",
                                   round(pauseMs, 2) AS "Pause (ms)",
                                   round(sum(pauseMs) OVER (ORDER BY gcId ROWS UNBOUNDED PRECEDING), 1) AS "Cumulative (ms)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            ORDER BY gcId
                            """,
                        "jvmlog_gc_event")
                    .description("Per-GC pause time with running cumulative total."),
                new View(
                        "jvmlog-g1-heap-expansion",
                        "jvmlog",
                        "GC Log: G1 Heap Resize Events",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-heap-expansion" AS
                            SELECT decision AS "Decision",
                                   round(requestedExpansionBytes / 1048576.0, 1) AS "Requested (MB)",
                                   round(actualExpansionBytes / 1048576.0, 1) AS "Actual (MB)"
                            FROM jvmlog_g1_ergonomics
                            ORDER BY rowid
                            """,
                        "jvmlog_g1_ergonomics")
                    .description("G1 heap resize events: expand, shrink, and no-shrink decisions with sizes."),
                new View(
                        "jvmlog-heap-efficiency",
                        "jvmlog",
                        "GC Log: Heap Collection Efficiency",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-efficiency" AS
                            SELECT gcId AS "GC ID",
                                   round(heapBefore / 1048576.0, 1) AS "Before (MB)",
                                   round(heapAfter / 1048576.0, 1) AS "After (MB)",
                                   round((heapBefore - heapAfter) / 1048576.0, 1) AS "Reclaimed (MB)",
                                   round(100.0 * (heapBefore - heapAfter) / heapBefore, 1) AS "Reclaim %"
                            FROM jvmlog_heap_snapshot
                            WHERE heapBefore > 0
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ORDER BY gcId
                            """,
                        "jvmlog_heap_snapshot")
                    .description("Per-GC heap reclaim amount and percentage (before vs after collection)."),
                new View(
                        "jvmlog-metaspace-timeline",
                        "jvmlog",
                        "GC Log: Metaspace Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-metaspace-timeline" AS
                            SELECT gcId AS "GC ID",
                                   metaspaceBefore / 1048576.0 AS "Metaspace Before (MB)",
                                   metaspaceAfter / 1048576.0 AS "Metaspace After (MB)",
                                   metaspaceCommitted / 1048576.0 AS "Committed (MB)"
                            FROM jvmlog_metaspace
                            WHERE metaspaceBefore IS NOT NULL
                            ORDER BY gcId
                            """,
                        "jvmlog_metaspace")
                    .description("Metaspace usage before and after each GC event."),
                new View(
                        "jvmlog-parallel-sizing",
                        "jvmlog",
                        "GC Log: Parallel GC Generation Sizes",
                        null,
                        """
                            CREATE VIEW "jvmlog-parallel-sizing" AS
                            SELECT gcId AS "GC ID",
                                   round(max(youngGenBytes) / 1048576.0, 2) AS "Young Gen (MB)",
                                   round(max(youngGenCapacity) / 1048576.0, 2) AS "Young Capacity (MB)",
                                   round(max(oldGenBytes) / 1048576.0, 2) AS "Old Gen (MB)",
                                   round(max(oldGenCapacity) / 1048576.0, 2) AS "Old Capacity (MB)",
                                   round(max(throughputPct), 1) AS "Throughput %"
                            FROM jvmlog_parallel_sizing
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_parallel_sizing")
                    .description("Parallel GC Young/Old generation sizes and throughput per GC cycle."),
                new View(
                        "jvmlog-stringdedup-summary",
                        "jvmlog",
                        "GC Log: String Deduplication Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-stringdedup-summary" AS
                            SELECT gcId AS "GC ID",
                                   max(deduplicatedObjects) AS "Objects Deduped",
                                   round(max(durationMs), 2) AS "Duration (ms)",
                                   max(savedBytes) AS "Bytes Saved",
                                   max(objectCount) AS "Objects with Savings"
                            FROM jvmlog_stringdedup
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_stringdedup")
                    .description("String deduplication statistics per GC cycle."),
                new View(
                        "jvmlog-zgc-director-summary",
                        "jvmlog",
                        "GC Log: ZGC Director Decisions",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-director-summary" AS
                            SELECT gcId AS "GC ID",
                                   max(ruleName) AS "Rule",
                                   round(max(allocationRateMbps), 1) AS "Alloc Rate (MB/s)",
                                   round(max(freeHeapPct), 1) AS "Free Heap %",
                                   round(max(timeUntilOomSecs), 1) AS "Time to OOM (s)"
                            FROM jvmlog_zgc_director
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_zgc_director")
                    .description("ZGC director decisions: allocation rate, free heap percentage, and time to OOM."),
                new View(
                        "jvmlog-safepoint-summary",
                        "jvmlog",
                        "GC Log: Safepoint Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-safepoint-summary" AS
                            SELECT operation AS "Operation",
                                   count(*) AS "Count",
                                   round(avg(totalMs), 2) AS "Avg Total (ms)",
                                   round(max(totalMs), 2) AS "Max Total (ms)",
                                   round(avg(syncMs), 2) AS "Avg Sync (ms)",
                                   round(sum(totalMs), 2) AS "Total (ms)"
                            FROM jvmlog_safepoint
                            WHERE operation IS NOT NULL
                            GROUP BY operation
                            ORDER BY "Total (ms)" DESC
                            """,
                        "jvmlog_safepoint")
                    .description("Safepoint operations: count, average, and max total and sync time."),
                new View(
                        "jvmlog-safepoint-timeline",
                        "jvmlog",
                        "GC Log: Safepoint Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-safepoint-timeline" AS
                            SELECT row_number() OVER (ORDER BY rowid) AS "#",
                                   operation AS "Operation",
                                   round(totalMs, 2) AS "Total (ms)",
                                   round(syncMs, 2) AS "Sync (ms)"
                            FROM jvmlog_safepoint
                            WHERE operation IS NOT NULL
                            ORDER BY rowid
                            """,
                        "jvmlog_safepoint")
                    .description("Per-safepoint operation name and duration in log order."),
                new View(
                        "jvmlog-alloc-stall-summary",
                        "jvmlog",
                        "GC Log: Allocation Stalls",
                        null,
                        """
                            CREATE VIEW "jvmlog-alloc-stall-summary" AS
                            SELECT threadName AS "Thread",
                                   count(*) AS "Stalls",
                                   round(sum(stallMs), 2) AS "Total Stall (ms)",
                                   round(avg(stallMs), 2) AS "Avg Stall (ms)",
                                   round(max(stallMs), 2) AS "Max Stall (ms)"
                            FROM jvmlog_alloc_stall
                            GROUP BY threadName
                            ORDER BY "Total Stall (ms)" DESC
                            """,
                        "jvmlog_alloc_stall")
                    .description("Per-thread allocation stall statistics: count, total, average, and max stall time."),
                new View(
                        "jvmlog-longest-pauses",
                        "jvmlog",
                        "GC Log: Longest Pause Events",
                        null,
                        """
                            CREATE VIEW "jvmlog-longest-pauses" AS
                            SELECT gcId AS "GC ID",
                                   gcType AS "Type",
                                   cause AS "Cause",
                                   round(pauseMs, 2) AS "Pause (ms)",
                                   uptimeSecs AS "Uptime (s)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            ORDER BY pauseMs DESC
                            LIMIT 20
                            """,
                        "jvmlog_gc_event")
                    .description("Top 20 longest GC pause events with type, cause, and timestamp."),
                new View(
                        "jvmlog-gc-errors",
                        "jvmlog",
                        "GC Log: GC Error Events",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-errors" AS
                            SELECT gcId AS "GC ID",
                                   errorType AS "Error Type",
                                   errorDetail AS "Detail",
                                   round(durationMs, 2) AS "Duration (ms)"
                            FROM jvmlog_gc_errors
                            ORDER BY gcId
                            """,
                        "jvmlog_gc_errors")
                    .description("GC error conditions: to-space exhausted, evacuation failures, OOM events."),
                new View(
                        "jvmlog-gc-error-summary",
                        "jvmlog",
                        "GC Log: GC Error Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-error-summary" AS
                            SELECT errorType AS "Error Type",
                                   count(*) AS "Count",
                                   round(sum(durationMs), 2) AS "Total (ms)",
                                   round(avg(durationMs), 2) AS "Avg (ms)"
                            FROM jvmlog_gc_errors
                            GROUP BY errorType
                            ORDER BY "Count" DESC
                            """,
                        "jvmlog_gc_errors")
                    .description("GC error event counts and durations grouped by error type."),
                new View(
                        "jvmlog-pause-percentiles-by-cause",
                        "jvmlog",
                        "GC Log: Pause Percentiles by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-percentiles-by-cause" AS
                            SELECT cause AS "Cause",
                                   count(*) AS "Count",
                                   round(min(pauseMs), 2) AS "Min (ms)",
                                   round(approx_quantile(pauseMs, 0.5), 2) AS "P50 (ms)",
                                   round(approx_quantile(pauseMs, 0.95), 2) AS "P95 (ms)",
                                   round(approx_quantile(pauseMs, 0.99), 2) AS "P99 (ms)",
                                   round(max(pauseMs), 2) AS "Max (ms)",
                                   round(sum(pauseMs), 2) AS "Total (ms)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY cause
                            ORDER BY "Total (ms)" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Pause time percentiles (p50/p95/p99) grouped by GC cause."),
                new View(
                        "jvmlog-combined-timeline",
                        "jvmlog",
                        "GC Log: Combined Heap + Pause Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-combined-timeline" AS
                            SELECT e.uptimeSecs AS "Uptime (s)",
                                   e.gcId AS "GC ID",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(h.heapBeforeMB, 1) AS "Heap Before (MB)",
                                   round(h.heapAfterMB, 1) AS "Heap After (MB)"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore / 1048576.0 AS heapBeforeMB,
                                       heapAfter / 1048576.0 AS heapAfterMB
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            WHERE e.uptimeSecs IS NOT NULL
                            ORDER BY e.uptimeSecs
                            """,
                        "jvmlog_gc_event",
                        "jvmlog_heap_snapshot")
                    .description("GC pause and heap usage combined per-event timeline."),
                new View(
                        "jvmlog-alloc-stall-timeline",
                        "jvmlog",
                        "GC Log: Allocation Stall Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-alloc-stall-timeline" AS
                            SELECT threadName AS "Thread",
                                   round(stallMs, 2) AS "Stall (ms)",
                                   gcId AS "GC ID"
                            FROM jvmlog_alloc_stall
                            ORDER BY rowid
                            """,
                        "jvmlog_alloc_stall")
                    .description("Chronological allocation stall events with thread name and duration."),
                new View(
                        "jvmlog-g1-mixed-gc",
                        "jvmlog",
                        "GC Log: G1 Mixed GC Decisions",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-mixed-gc" AS
                            SELECT gcId AS "GC ID",
                                   decision AS "Decision",
                                   round(reclaimablePct, 1) AS "Reclaimable %",
                                   round(thresholdPct, 1) AS "Threshold %",
                                   candidateOldRegions AS "Candidate Regions"
                            FROM jvmlog_g1_mixed_gc
                            ORDER BY gcId
                            """,
                        "jvmlog_g1_mixed_gc")
                    .description("G1 mixed GC trigger/skip decisions with reclaimable heap percentage."),
                new View(
                        "jvmlog-g1-mixed-gc-summary",
                        "jvmlog",
                        "GC Log: G1 Mixed GC Decision Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-mixed-gc-summary" AS
                            SELECT decision AS "Decision",
                                   count(*) AS "Count",
                                   round(avg(reclaimablePct), 1) AS "Avg Reclaimable %",
                                   round(avg(thresholdPct), 1) AS "Avg Threshold %"
                            FROM jvmlog_g1_mixed_gc
                            GROUP BY decision
                            ORDER BY "Count" DESC
                            """,
                        "jvmlog_g1_mixed_gc")
                    .description("Counts of G1 mixed GC decisions grouped by outcome."),
                new View(
                        "jvmlog-zgc-load",
                        "jvmlog",
                        "GC Log: ZGC Load Per Cycle",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-load" AS
                            SELECT gcId AS "GC ID",
                                   round(max(load1s), 2) AS "Load 1s",
                                   round(max(load5s), 2) AS "Load 5s",
                                   round(max(load15s), 2) AS "Load 15s",
                                   round(max(allocRateMbps), 1) AS "Alloc Rate (MB/s)",
                                   max(allocStalls) AS "Alloc Stalls"
                            FROM jvmlog_zgc_load
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_zgc_load")
                    .description("System load averages and allocation pressure per ZGC cycle."),
                new View(
                        "jvmlog-zgc-cycle-detail",
                        "jvmlog",
                        "GC Log: ZGC Full Cycle Detail",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(p.concurrentMs, 1) AS "Concurrent (ms)",
                                   round(p.pauseMs, 2) AS "STW (ms)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)",
                                   round(st.liveBytes / 1048576.0, 1) AS "Live (MB)",
                                   round(st.garbageBytes / 1048576.0, 1) AS "Garbage (MB)",
                                   round(l.allocRateMbps, 1) AS "Alloc Rate (MB/s)",
                                   l.allocStalls AS "Alloc Stalls"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS concurrentMs,
                                       sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS pauseMs
                                FROM jvmlog_zgc_phases
                                GROUP BY gcId
                            ) p ON e.gcId = p.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       max(liveBytes) AS liveBytes,
                                       max(garbageBytes) AS garbageBytes
                                FROM jvmlog_zgc_stats
                                GROUP BY gcId
                            ) st ON e.gcId = st.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       max(allocRateMbps) AS allocRateMbps,
                                       max(allocStalls) AS allocStalls
                                FROM jvmlog_zgc_load
                                GROUP BY gcId
                            ) l ON e.gcId = l.gcId
                            WHERE e.gcType IS NOT NULL OR e.cause IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_zgc_phases", "jvmlog_heap_snapshot", "jvmlog_zgc_stats", "jvmlog_zgc_load")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-zgc-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(p.concurrentMs, 1) AS "Concurrent (ms)",
                                   round(p.pauseMs, 2) AS "STW (ms)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)",
                                   round(l.allocRateMbps, 1) AS "Alloc Rate (MB/s)",
                                   l.allocStalls AS "Alloc Stalls"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS concurrentMs,
                                       sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS pauseMs
                                FROM jvmlog_zgc_phases
                                GROUP BY gcId
                            ) p ON e.gcId = p.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       max(allocRateMbps) AS allocRateMbps,
                                       max(allocStalls) AS allocStalls
                                FROM jvmlog_zgc_load
                                GROUP BY gcId
                            ) l ON e.gcId = l.gcId
                            WHERE e.gcType IS NOT NULL OR e.cause IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_zgc_phases", "jvmlog_heap_snapshot", "jvmlog_zgc_load")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-zgc-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(p.concurrentMs, 1) AS "Concurrent (ms)",
                                   round(p.pauseMs, 2) AS "STW (ms)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS concurrentMs,
                                       sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS pauseMs
                                FROM jvmlog_zgc_phases
                                GROUP BY gcId
                            ) p ON e.gcId = p.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            WHERE e.gcType IS NOT NULL OR e.cause IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_zgc_phases", "jvmlog_heap_snapshot")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-zgc-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(p.concurrentMs, 1) AS "Concurrent (ms)",
                                   round(p.pauseMs, 2) AS "STW (ms)"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS concurrentMs,
                                       sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS pauseMs
                                FROM jvmlog_zgc_phases
                                GROUP BY gcId
                            ) p ON e.gcId = p.gcId
                            WHERE e.gcType IS NOT NULL OR e.cause IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_zgc_phases")
                    .description("ZGC per-cycle: pause, concurrent time, heap before/after, and allocation pressure in one row."),
                new View(
                        "jvmlog-pause-histogram",
                        "jvmlog",
                        "GC Log: Pause Duration Histogram",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-histogram" AS
                            SELECT bucket AS "Bucket (ms)",
                                   count(*) AS "Count"
                            FROM (
                                SELECT CASE
                                    WHEN pauseMs < 1   THEN '<1'
                                    WHEN pauseMs < 5   THEN '1-5'
                                    WHEN pauseMs < 10  THEN '5-10'
                                    WHEN pauseMs < 25  THEN '10-25'
                                    WHEN pauseMs < 50  THEN '25-50'
                                    WHEN pauseMs < 100 THEN '50-100'
                                    WHEN pauseMs < 250 THEN '100-250'
                                    WHEN pauseMs < 500 THEN '250-500'
                                    ELSE '500+'
                                END AS bucket,
                                CASE
                                    WHEN pauseMs < 1   THEN 0
                                    WHEN pauseMs < 5   THEN 1
                                    WHEN pauseMs < 10  THEN 2
                                    WHEN pauseMs < 25  THEN 3
                                    WHEN pauseMs < 50  THEN 4
                                    WHEN pauseMs < 100 THEN 5
                                    WHEN pauseMs < 250 THEN 6
                                    WHEN pauseMs < 500 THEN 7
                                    ELSE 8
                                END AS sort_order
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL
                            ) t
                            GROUP BY bucket, sort_order
                            ORDER BY sort_order
                            """,
                        "jvmlog_gc_event")
                    .description("Histogram of GC pause durations bucketed by millisecond ranges."),
                new View(
                        "jvmlog-gc-frequency",
                        "jvmlog",
                        "GC Log: GC Frequency Over Time",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-frequency" AS
                            SELECT floor(uptimeSecs / 10) * 10 AS "Window Start (s)",
                                   count(*) AS "GC Count",
                                   round(sum(pauseMs), 1) AS "Total Pause (ms)",
                                   round(avg(pauseMs), 2) AS "Avg Pause (ms)"
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 10) * 10
                            ORDER BY 1
                            """,
                        "jvmlog_gc_event")
                    .description("GC count and total pause per 10-second window."),
                new View(
                        "jvmlog-gc-pressure-timeline",
                        "jvmlog",
                        "GC Log: Combined GC Pressure Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-pressure-timeline" AS
                            SELECT e.uptimeSecs AS "Uptime (s)",
                                   e.gcId AS "GC ID",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(h.heapBeforeMB, 1) AS "Heap Before (MB)",
                                   round(h.heapAfterMB, 1) AS "Heap After (MB)",
                                   round(w.gcOverheadPct, 1) AS "GC Overhead %"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore / 1048576.0 AS heapBeforeMB,
                                       heapAfter / 1048576.0 AS heapAfterMB
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            LEFT JOIN (
                                SELECT floor(uptimeSecs / 10) * 10 AS windowStart,
                                       100.0 * sum(pauseMs) / 10000.0 AS gcOverheadPct
                                FROM jvmlog_gc_event
                                WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                                GROUP BY floor(uptimeSecs / 10) * 10
                            ) w ON floor(e.uptimeSecs / 10) * 10 = w.windowStart
                            WHERE e.uptimeSecs IS NOT NULL
                            ORDER BY e.uptimeSecs
                            """,
                        "jvmlog_gc_event")
                    .description("Per-GC event with pause, heap before/after, and windowed overhead — all in one row."),
                new View(
                        "jvmlog-problematic-gcs",
                        "jvmlog",
                        "GC Log: Problematic GC Events",
                        null,
                        """
                            CREATE VIEW "jvmlog-problematic-gcs" AS
                            SELECT e.gcId AS "GC ID",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   e.uptimeSecs AS "Uptime (s)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)",
                                   round(100.0 * (h.heapBefore - h.heapAfter) / h.heapBefore, 1) AS "Reclaim %"
                            FROM jvmlog_gc_event e
                            JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            WHERE e.pauseMs IS NOT NULL
                              AND (
                                e.pauseMs > (SELECT approx_quantile(pauseMs, 0.9) FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL)
                                OR (100.0 * (h.heapBefore - h.heapAfter) / h.heapBefore) < 10
                              )
                            ORDER BY e.pauseMs DESC
                            LIMIT 50
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("GC events in the top 10% of pause time or reclaiming less than 10% of heap — the most impactful events."),
                new View(
                        "jvmlog-g1-cycle-detail",
                        "jvmlog",
                        "GC Log: G1 Full Cycle Detail",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   r.edenBefore AS "Eden Before",
                                   r.edenAfter AS "Eden After",
                                   r.oldBefore AS "Old Before",
                                   r.oldAfter AS "Old After",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       max(edenBefore) AS edenBefore,
                                       max(edenAfter) AS edenAfter,
                                       max(oldBefore) AS oldBefore,
                                       max(oldAfter) AS oldAfter
                                FROM jvmlog_g1_regions
                                GROUP BY gcId
                            ) r ON e.gcId = r.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            WHERE e.pauseMs IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_g1_regions", "jvmlog_heap_snapshot")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-g1-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   r.edenBefore AS "Eden Before",
                                   r.edenAfter AS "Eden After",
                                   r.oldBefore AS "Old Before",
                                   r.oldAfter AS "Old After"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       max(edenBefore) AS edenBefore,
                                       max(edenAfter) AS edenAfter,
                                       max(oldBefore) AS oldBefore,
                                       max(oldAfter) AS oldAfter
                                FROM jvmlog_g1_regions
                                GROUP BY gcId
                            ) r ON e.gcId = r.gcId
                            WHERE e.pauseMs IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_g1_regions")
                    .description("G1 per-cycle: pause, region counts before/after, and heap before/after in one row."),
                new View(
                        "jvmlog-unknown-summary",
                        "jvmlog",
                        "GC Log: Unrecognised Lines",
                        null,
                        """
                            CREATE VIEW "jvmlog-unknown-summary" AS
                            SELECT tags AS "Tags",
                                   level AS "Level",
                                   messagePrefix AS "Message Prefix",
                                   count AS "Count"
                            FROM jvmlog_unknown_lines
                            ORDER BY count DESC
                            LIMIT 20
                            """,
                        "jvmlog_unknown_lines")
                    .description("Top unrecognised log lines by occurrence count."),
                new View(
                        "jvmlog-gc-error-timeline",
                        "jvmlog",
                        "GC Log: GC Error Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-error-timeline" AS
                            SELECT err.gcId AS "GC ID",
                                   err.errorType AS "Error Type",
                                   err.errorDetail AS "Detail",
                                   round(err.durationMs, 2) AS "Duration (ms)",
                                   e.uptimeSecs AS "Uptime (s)",
                                   round(e.pauseMs, 2) AS "Pause (ms)"
                            FROM jvmlog_gc_errors err
                            LEFT JOIN jvmlog_gc_event e ON err.gcId = e.gcId
                            ORDER BY err.gcId
                            """,
                        "jvmlog_gc_errors", "jvmlog_gc_event")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-gc-error-timeline" AS
                            SELECT gcId AS "GC ID",
                                   errorType AS "Error Type",
                                   errorDetail AS "Detail",
                                   round(durationMs, 2) AS "Duration (ms)"
                            FROM jvmlog_gc_errors
                            ORDER BY gcId
                            """,
                        "jvmlog_gc_errors")
                    .description("GC error events with uptime context — shows when failures occurred in the JVM lifecycle."),
                new View(
                        "jvmlog-metaspace-detail",
                        "jvmlog",
                        "GC Log: Metaspace + Class Space Detail",
                        null,
                        """
                            CREATE VIEW "jvmlog-metaspace-detail" AS
                            SELECT gcId AS "GC ID",
                                   round(max(metaspaceBefore) / 1048576.0, 2) AS "Metaspace Before (MB)",
                                   round(max(metaspaceAfter) / 1048576.0, 2) AS "Metaspace After (MB)",
                                   round(max(metaspaceCommitted) / 1048576.0, 2) AS "Committed (MB)",
                                   round(max(classSpaceBefore) / 1048576.0, 2) AS "Class Before (MB)",
                                   round(max(classSpaceAfter) / 1048576.0, 2) AS "Class After (MB)",
                                   round(max(classSpaceCommitted) / 1048576.0, 2) AS "Class Committed (MB)"
                            FROM jvmlog_metaspace
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_metaspace")
                    .description("Metaspace and class space usage before/after each GC event."),
                new View(
                        "jvmlog-shenandoah-cycle-detail",
                        "jvmlog",
                        "GC Log: Shenandoah Full Cycle Detail",
                        null,
                        """
                            CREATE VIEW "jvmlog-shenandoah-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Init Mark'), 2) AS "Init Mark (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Final Mark'), 2) AS "Final Mark (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Init Update Refs'), 2) AS "Init UpdateRefs (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Final Update Refs'), 2) AS "Final UpdateRefs (ms)",
                                   round(sum(e.pauseMs), 2) AS "Total STW (ms)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)",
                                   round(f.freeBytes / 1048576.0, 1) AS "Free After (MB)",
                                   f.freeRegions AS "Free Regions"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            LEFT JOIN (
                                SELECT gcId,
                                       max(freeBytes) AS freeBytes,
                                       max(freeRegions) AS freeRegions
                                FROM jvmlog_shenandoah_free
                                GROUP BY gcId
                            ) f ON e.gcId = f.gcId
                            WHERE e.gcType IN ('Init Mark', 'Final Mark', 'Init Update Refs', 'Final Update Refs')
                            GROUP BY e.gcId, e.cause, h.heapBefore, h.heapAfter, f.freeBytes, f.freeRegions
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot", "jvmlog_shenandoah_free")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-shenandoah-cycle-detail" AS
                            SELECT e.gcId AS "GC ID",
                                   e.cause AS "Cause",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Init Mark'), 2) AS "Init Mark (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Final Mark'), 2) AS "Final Mark (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Init Update Refs'), 2) AS "Init UpdateRefs (ms)",
                                   round(sum(e.pauseMs) FILTER (WHERE e.gcType = 'Final Update Refs'), 2) AS "Final UpdateRefs (ms)",
                                   round(sum(e.pauseMs), 2) AS "Total STW (ms)",
                                   round(h.heapBefore / 1048576.0, 1) AS "Heap Before (MB)",
                                   round(h.heapAfter / 1048576.0, 1) AS "Heap After (MB)"
                            FROM jvmlog_gc_event e
                            LEFT JOIN (
                                SELECT gcId,
                                       heapBefore,
                                       heapAfter
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ) h ON e.gcId = h.gcId
                            WHERE e.gcType IN ('Init Mark', 'Final Mark', 'Init Update Refs', 'Final Update Refs')
                            GROUP BY e.gcId, e.cause, h.heapBefore, h.heapAfter
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-shenandoah-cycle-detail" AS
                            SELECT gcId AS "GC ID",
                                   cause AS "Cause",
                                   round(sum(pauseMs) FILTER (WHERE gcType = 'Init Mark'), 2) AS "Init Mark (ms)",
                                   round(sum(pauseMs) FILTER (WHERE gcType = 'Final Mark'), 2) AS "Final Mark (ms)",
                                   round(sum(pauseMs) FILTER (WHERE gcType = 'Init Update Refs'), 2) AS "Init UpdateRefs (ms)",
                                   round(sum(pauseMs) FILTER (WHERE gcType = 'Final Update Refs'), 2) AS "Final UpdateRefs (ms)",
                                   round(sum(pauseMs), 2) AS "Total STW (ms)"
                            FROM jvmlog_gc_event
                            WHERE gcType IN ('Init Mark', 'Final Mark', 'Init Update Refs', 'Final Update Refs')
                            GROUP BY gcId, cause
                            ORDER BY gcId
                            """,
                        "jvmlog_gc_event")
                    .description("Shenandoah per-cycle: all pause phases, total STW, and heap before/after in one row."),
                new View(
                        "jvmlog-shenandoah-free-timeline",
                        "jvmlog",
                        "GC Log: Shenandoah Free Heap Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-shenandoah-free-timeline" AS
                            SELECT gcId AS "GC ID",
                                   round(max(freeBytes) / 1048576.0, 1) AS "Free (MB)",
                                   max(freeRegions) AS "Free Regions",
                                   round(max(headroomBytes) / 1048576.0, 1) AS "Headroom (MB)"
                            FROM jvmlog_shenandoah_free
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_shenandoah_free")
                    .description("Shenandoah free heap regions and headroom per GC cycle — shows how close the JVM is to running out of memory."),
                new View(
                        "jvmlog-zgc-stats",
                        "jvmlog",
                        "GC Log: ZGC Per-Cycle Statistics",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-stats" AS
                            SELECT gcId AS "GC ID",
                                   round(max(usedBytes) FILTER (WHERE phase = 'Mark Start') / 1048576.0, 1) AS "Used at Mark Start (MB)",
                                   round(max(usedBytes) FILTER (WHERE phase = 'Mark End') / 1048576.0, 1) AS "Used at Mark End (MB)",
                                   round(max(liveBytes) FILTER (WHERE phase = 'Relocate Start') / 1048576.0, 1) AS "Live (MB)",
                                   round(max(garbageBytes) FILTER (WHERE phase = 'Relocate Start') / 1048576.0, 1) AS "Garbage (MB)",
                                   round(max(usedBytes) FILTER (WHERE phase = 'Relocate End') / 1048576.0, 1) AS "Used at Relocate End (MB)"
                            FROM jvmlog_zgc_stats
                            GROUP BY gcId
                            ORDER BY gcId
                            """,
                        "jvmlog_zgc_stats")
                    .description("ZGC per-cycle live set, garbage, and used bytes at each phase boundary."),
                new View(
                        "jvmlog-gc-worker-summary",
                        "jvmlog",
                        "GC Log: GC Worker Utilisation",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-worker-summary" AS
                            SELECT taskName AS "Task",
                                   count(*) AS "Count",
                                   round(avg(workersUsed), 1) AS "Avg Workers Used",
                                   round(avg(workersMax), 1) AS "Workers Max",
                                   round(avg(workersUsed) * 100.0 / nullif(avg(workersMax), 0), 1) AS "Utilisation %",
                                   min(workersUsed) AS "Min Used",
                                   max(workersUsed) AS "Max Used"
                            FROM jvmlog_gc_workers
                            GROUP BY taskName
                            ORDER BY "Count" DESC
                            """,
                        "jvmlog_gc_workers")
                    .description("Average worker thread utilisation per GC task — reveals phases not using all available threads."),
                new View(
                        "jvmlog-gc-worker-timeline",
                        "jvmlog",
                        "GC Log: GC Worker Usage Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-worker-timeline" AS
                            SELECT gcId AS "GC ID",
                                   taskName AS "Task",
                                   workersUsed AS "Workers Used",
                                   workersMax AS "Workers Max",
                                   round(workersUsed * 100.0 / nullif(workersMax, 0), 1) AS "Utilisation %"
                            FROM jvmlog_gc_workers
                            ORDER BY gcId, taskName
                            """,
                        "jvmlog_gc_workers")
                    .description("Per-GC worker thread usage per task — useful for spotting individual GC events where parallelism was reduced."),
                new View(
                        "jvmlog-throughput-summary",
                        "jvmlog",
                        "GC Log: Application Throughput Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-throughput-summary" AS
                            WITH stats AS (
                                SELECT max(uptimeSecs) - min(uptimeSecs) AS totalUptimeSecs,
                                       sum(pauseMs) / 1000.0 AS gcTimeSecs,
                                       count(*) AS gcEventCount,
                                       avg(pauseMs) AS avgPauseMs,
                                       max(pauseMs) AS maxPauseMs
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            )
                            SELECT round(totalUptimeSecs, 3) AS "Total Uptime (s)",
                                   round(gcTimeSecs, 3) AS "GC Time (s)",
                                   round((1.0 - gcTimeSecs / nullif(totalUptimeSecs, 0)) * 100.0, 2) AS "Throughput %",
                                   gcEventCount AS "GC Event Count",
                                   round(avgPauseMs, 2) AS "Avg Pause (ms)",
                                   round(maxPauseMs, 2) AS "Max Pause (ms)"
                            FROM stats
                            """,
                        "jvmlog_gc_event")
                    .description("Overall application throughput — time NOT spent in GC as a percentage of total JVM uptime."),
                new View(
                        "jvmlog-gc-interval",
                        "jvmlog",
                        "GC Log: GC Event Intervals",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-interval" AS
                            SELECT gcId AS "GC ID",
                                   uptimeSecs AS "Uptime (s)",
                                   round(uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs), 3) AS "Interval (s)",
                                   pauseMs AS "Pause (ms)",
                                   gcType AS "Type",
                                   cause AS "Cause"
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL
                            ORDER BY uptimeSecs
                            """,
                        "jvmlog_gc_event")
                    .description("Time between consecutive GC events — short intervals indicate high allocation pressure."),
                new View(
                        "jvmlog-gc-interval-stats",
                        "jvmlog",
                        "GC Log: GC Interval Statistics",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-interval-stats" AS
                            WITH intervals AS (
                                SELECT uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS intervalSecs
                                FROM jvmlog_gc_event
                                WHERE uptimeSecs IS NOT NULL
                            )
                            SELECT round(min(intervalSecs), 3) AS "Min Interval (s)",
                                   round(avg(intervalSecs), 3) AS "Avg Interval (s)",
                                   round(max(intervalSecs), 3) AS "Max Interval (s)",
                                   round(approx_quantile(intervalSecs, 0.50), 3) AS "P50 Interval (s)",
                                   round(approx_quantile(intervalSecs, 0.99), 3) AS "P99 Interval (s)"
                            FROM intervals
                            WHERE intervalSecs IS NOT NULL
                            """,
                        "jvmlog_gc_event")
                    .description("Summary statistics for time between GC events — P99 interval helps size allocation rate targets."),
                new View(
                        "jvmlog-pause-sla",
                        "jvmlog",
                        "GC Log: Pause SLA Compliance",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-sla" AS
                            WITH total AS (SELECT count(*) AS n FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL)
                            SELECT 1 AS "SLA Threshold (ms)",
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1) AS "Pauses Within (%)",
                                   count(*) AS "Pauses Within (count)",
                                   (SELECT n FROM total) AS "Total Pauses"
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 1
                            UNION ALL
                            SELECT 5,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 5
                            UNION ALL
                            SELECT 10,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 10
                            UNION ALL
                            SELECT 25,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 25
                            UNION ALL
                            SELECT 50,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 50
                            UNION ALL
                            SELECT 100,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 100
                            UNION ALL
                            SELECT 200,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 200
                            UNION ALL
                            SELECT 500,
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1),
                                   count(*),
                                   (SELECT n FROM total)
                            FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL AND pauseMs < 500
                            ORDER BY "SLA Threshold (ms)"
                            """,
                        "jvmlog_gc_event")
                    .description("Fraction of GC pauses within common latency SLA thresholds."),
                new View(
                        "jvmlog-cause-distribution",
                        "jvmlog",
                        "GC Log: GC Cause Distribution",
                        null,
                        """
                            CREATE VIEW "jvmlog-cause-distribution" AS
                            WITH total AS (SELECT count(*) AS n FROM jvmlog_gc_event WHERE pauseMs IS NOT NULL)
                            SELECT cause AS "Cause",
                                   count(*) AS "Count",
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1) AS "% of Events",
                                   round(sum(pauseMs), 2) AS "Total Pause (ms)",
                                   round(avg(pauseMs), 2) AS "Avg Pause (ms)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY cause
                            ORDER BY count(*) DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Distribution of GC triggers by cause — shows which causes dominate GC activity."),
                new View(
                        "jvmlog-throughput-timeline",
                        "jvmlog",
                        "GC Log: Throughput Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-throughput-timeline" AS
                            SELECT floor(uptimeSecs / 10) * 10 AS "Window Start (s)",
                                   round(sum(pauseMs), 2) AS "GC Pause (ms)",
                                   round((1.0 - sum(pauseMs) / 10000.0) * 100.0, 2) AS "Throughput %",
                                   count(*) AS "GC Count"
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 10) * 10
                            ORDER BY "Window Start (s)"
                            """,
                        "jvmlog_gc_event")
                    .description("Application throughput per 10-second window — reveals if throughput degrades over time."),
                new View(
                        "jvmlog-heap-growth-trend",
                        "jvmlog",
                        "GC Log: Heap Growth Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-growth-trend" AS
                            WITH deduped AS (
                                SELECT gcId, heapAfter, heapCommittedBefore
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ),
                            joined AS (
                                SELECT e.uptimeSecs,
                                       d.heapAfter / 1048576.0 AS heapAfterMB,
                                       floor(e.uptimeSecs / 10) * 10 AS windowStart
                                FROM jvmlog_gc_event e
                                JOIN deduped d ON e.gcId = d.gcId
                                WHERE e.uptimeSecs IS NOT NULL AND d.heapAfter IS NOT NULL
                            ),
                            slope AS (
                                SELECT regr_slope(heapAfterMB, uptimeSecs) AS slopeMBperSec
                                FROM joined
                            )
                            SELECT j.windowStart AS "Window Start (s)",
                                   round(max(j.heapAfterMB), 2) AS "Max Heap After (MB)",
                                   round(s.slopeMBperSec, 4) AS "Heap Trend (MB/s)"
                            FROM joined j
                            CROSS JOIN slope s
                            GROUP BY j.windowStart, s.slopeMBperSec
                            ORDER BY j.windowStart
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Heap usage after GC over time with linear growth trend — positive slope may indicate a memory leak."),
                new View(
                        "jvmlog-heap-growth-summary",
                        "jvmlog",
                        "GC Log: Heap Growth Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-growth-summary" AS
                            WITH deduped AS (
                                SELECT gcId, heapAfter, heapCommittedBefore
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                            ),
                            joined AS (
                                SELECT e.uptimeSecs,
                                       d.heapAfter / 1048576.0 AS heapAfterMB,
                                       d.heapCommittedBefore / 1048576.0 AS committedMB
                                FROM jvmlog_gc_event e
                                JOIN deduped d ON e.gcId = d.gcId
                                WHERE e.uptimeSecs IS NOT NULL AND d.heapAfter IS NOT NULL
                            )
                            SELECT round(min(heapAfterMB), 2) AS "Min Heap After (MB)",
                                   round(max(heapAfterMB), 2) AS "Max Heap After (MB)",
                                   round(max(committedMB), 2) AS "Committed (MB)",
                                   round(regr_slope(heapAfterMB, uptimeSecs), 4) AS "Growth Rate (MB/s)",
                                   round(regr_r2(heapAfterMB, uptimeSecs), 4) AS "R² (fit quality)",
                                   CASE WHEN regr_slope(heapAfterMB, uptimeSecs) > 0
                                        THEN round((max(committedMB) - last(heapAfterMB ORDER BY uptimeSecs)) / regr_slope(heapAfterMB, uptimeSecs), 2)
                                        ELSE NULL
                                   END AS "Est. Time to OOM (s)"
                            FROM joined
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-heap-growth-summary" AS
                            WITH deduped AS (
                                SELECT gcId, heapAfter, heapCommittedBefore,
                                       row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) AS rn
                                FROM jvmlog_heap_snapshot
                            )
                            SELECT round(min(heapAfter) / 1048576.0, 2) AS "Min Heap After (MB)",
                                   round(max(heapAfter) / 1048576.0, 2) AS "Max Heap After (MB)",
                                   round(max(heapCommittedBefore) / 1048576.0, 2) AS "Committed (MB)",
                                   NULL AS "Growth Rate (MB/s)",
                                   NULL AS "R² (fit quality)",
                                   NULL AS "Est. Time to OOM (s)"
                            FROM deduped
                            WHERE rn = 1 AND heapAfter IS NOT NULL
                            """,
                        "jvmlog_heap_snapshot")
                    .description("Heap growth trend summary — positive growth rate with high R² suggests a memory leak."),
                new View(
                        "jvmlog-allocation-rate",
                        "jvmlog",
                        "GC Log: Allocation Rate",
                        null,
                        """
                            CREATE VIEW "jvmlog-allocation-rate" AS
                            WITH snapshots AS (
                                SELECT gcId,
                                       heapBefore / 1048576.0 AS heapBeforeMB,
                                       heapAfter / 1048576.0 AS heapAfterMB
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapBefore DESC NULLS LAST) = 1
                            ),
                            events AS (
                                SELECT gcId, uptimeSecs, pauseMs, gcType, cause
                                FROM jvmlog_gc_event
                                WHERE uptimeSecs IS NOT NULL
                            ),
                            joined AS (
                                SELECT e.gcId,
                                       e.uptimeSecs,
                                       e.pauseMs,
                                       e.gcType AS "Type",
                                       e.cause AS "Cause",
                                       s.heapBeforeMB AS "Heap Before (MB)",
                                       s.heapAfterMB AS "Heap After (MB)",
                                       s.heapBeforeMB - LAG(s.heapAfterMB) OVER (ORDER BY e.uptimeSecs) AS allocatedMB,
                                       e.uptimeSecs - LAG(e.uptimeSecs) OVER (ORDER BY e.uptimeSecs) AS intervalSecs
                                FROM events e
                                JOIN snapshots s ON e.gcId = s.gcId
                            )
                            SELECT gcId AS "GC ID",
                                   round(uptimeSecs, 3) AS "Uptime (s)",
                                   "Type",
                                   "Cause",
                                   round("Heap Before (MB)", 2) AS "Heap Before (MB)",
                                   round("Heap After (MB)", 2) AS "Heap After (MB)",
                                   round(allocatedMB, 2) AS "Allocated Since Last GC (MB)",
                                   round(intervalSecs, 3) AS "Interval (s)",
                                   round(allocatedMB / nullif(intervalSecs, 0), 2) AS "Allocation Rate (MB/s)"
                            FROM joined
                            WHERE allocatedMB IS NOT NULL
                            ORDER BY uptimeSecs
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Heap allocation rate between GC events — high rates cause frequent GC cycles."),
                new View(
                        "jvmlog-gc-type-breakdown",
                        "jvmlog",
                        "GC Log: GC Type Breakdown",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-type-breakdown" AS
                            WITH categorized AS (
                                SELECT gcId, pauseMs, gcType,
                                       CASE
                                           WHEN lower(gcType) LIKE '%full%' THEN 'Full GC'
                                           WHEN lower(gcType) LIKE '%young%' OR lower(gcType) LIKE '%minor%' THEN 'Young GC'
                                           WHEN lower(gcType) LIKE '%old%' OR lower(gcType) LIKE '%major%' THEN 'Old GC'
                                           WHEN lower(gcType) IN ('remark', 'cleanup') THEN 'Concurrent STW'
                                           WHEN lower(gcType) LIKE '%garbage collection%' OR gcType = 'Garbage Collection' THEN 'Garbage Collection'
                                           ELSE 'Other'
                                       END AS category
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL
                            ),
                            total AS (SELECT count(*) AS n, sum(pauseMs) AS totalMs FROM categorized)
                            SELECT category AS "GC Category",
                                   count(*) AS "Count",
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1) AS "% of Events",
                                   round(sum(pauseMs), 2) AS "Total Pause (ms)",
                                   round(sum(pauseMs) * 100.0 / nullif((SELECT totalMs FROM total), 0), 1) AS "% of Pause Time",
                                   round(avg(pauseMs), 2) AS "Avg Pause (ms)",
                                   round(max(pauseMs), 2) AS "Max Pause (ms)",
                                   round(approx_quantile(pauseMs, 0.99), 2) AS "P99 Pause (ms)"
                            FROM categorized
                            GROUP BY category
                            ORDER BY count(*) DESC
                            """,
                        "jvmlog_gc_event")
                    .description("GC events broken down by collection type — Full GC counts and pause share reveal GC health at a glance."),
                new View(
                        "jvmlog-full-gc-analysis",
                        "jvmlog",
                        "GC Log: Full GC Analysis",
                        null,
                        """
                            CREATE VIEW "jvmlog-full-gc-analysis" AS
                            WITH fullgc AS (
                                SELECT gcId, uptimeSecs, pauseMs, cause
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL
                                  AND (lower(gcType) LIKE '%full%'
                                       OR lower(cause) LIKE '%ergonomics%'
                                       OR cause = 'System.gc()'
                                       OR cause = 'Heap Dump Initiated GC'
                                       OR cause = 'Diagnostic Command')
                            )
                            SELECT gcId AS "GC ID",
                                   round(uptimeSecs, 3) AS "Uptime (s)",
                                   round(pauseMs, 2) AS "Pause (ms)",
                                   cause AS "Cause"
                            FROM fullgc
                            ORDER BY pauseMs DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Full GC and forced-collection events sorted by pause — the highest-latency events in a GC log."),
                new View(
                        "jvmlog-g1-humongous",
                        "jvmlog",
                        "GC Log: G1 Humongous Object Analysis",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-humongous" AS
                            WITH deduped AS (
                                SELECT gcId,
                                       max(humongousBefore) AS humongousBefore,
                                       max(humongousAfter) AS humongousAfter
                                FROM jvmlog_g1_regions
                                GROUP BY gcId
                            )
                            SELECT d.gcId AS "GC ID",
                                   round(e.uptimeSecs, 3) AS "Uptime (s)",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   d.humongousBefore AS "Humongous Before",
                                   d.humongousAfter AS "Humongous After",
                                   d.humongousBefore - d.humongousAfter AS "Humongous Freed",
                                   round(e.pauseMs, 2) AS "Pause (ms)"
                            FROM deduped d
                            JOIN jvmlog_gc_event e ON d.gcId = e.gcId
                            WHERE d.humongousBefore > 0 OR d.humongousAfter > 0
                            ORDER BY d.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_g1_regions")
                    .description("G1 humongous object region counts per GC cycle — non-zero humongous-after values may indicate allocation of large objects that bypass the normal Eden path."),
                new View(
                        "jvmlog-parallel-gc-detail",
                        "jvmlog",
                        "GC Log: Parallel GC Cycle Detail",
                        null,
                        """
                            CREATE VIEW "jvmlog-parallel-gc-detail" AS
                            WITH sizing AS (
                                SELECT gcId,
                                       max(youngGenBytes) AS youngGenBytes,
                                       max(oldGenBytes) AS oldGenBytes,
                                       max(youngGenCapacity) AS youngGenCapacity,
                                       max(oldGenCapacity) AS oldGenCapacity,
                                       max(throughputPct) AS throughputPct
                                FROM jvmlog_parallel_sizing
                                GROUP BY gcId
                            )
                            SELECT e.gcId AS "GC ID",
                                   round(e.uptimeSecs, 3) AS "Uptime (s)",
                                   e.gcType AS "Type",
                                   e.cause AS "Cause",
                                   round(e.pauseMs, 2) AS "Pause (ms)",
                                   round(s.youngGenBytes / 1048576.0, 2) AS "Young Gen (MB)",
                                   round(s.youngGenCapacity / 1048576.0, 2) AS "Young Capacity (MB)",
                                   round(s.oldGenBytes / 1048576.0, 2) AS "Old Gen (MB)",
                                   round(s.oldGenCapacity / 1048576.0, 2) AS "Old Capacity (MB)",
                                   round(s.throughputPct, 2) AS "Throughput %"
                            FROM jvmlog_gc_event e
                            JOIN sizing s ON e.gcId = s.gcId
                            WHERE e.pauseMs IS NOT NULL
                            ORDER BY e.gcId
                            """,
                        "jvmlog_gc_event", "jvmlog_parallel_sizing")
                    .description("Parallel/CMS GC per-cycle detail combining event pauses with generation sizing data."),
                new View(
                        "jvmlog-gc-health-score",
                        "jvmlog",
                        "GC Log: GC Health Score",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-health-score" AS
                            WITH stats AS (
                                SELECT max(uptimeSecs) - min(uptimeSecs) AS totalUptimeSecs,
                                       sum(pauseMs) / 1000.0 AS gcTimeSecs,
                                       count(*) AS gcEventCount,
                                       approx_quantile(pauseMs, 0.99) AS p99PauseMs,
                                       max(pauseMs) AS maxPauseMs,
                                       count(*) FILTER (WHERE lower(gcType) LIKE '%full%'
                                                           OR cause = 'System.gc()'
                                                           OR cause = 'Ergonomics') AS fullGcCount
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            ),
                            derived AS (
                                SELECT totalUptimeSecs,
                                       gcTimeSecs,
                                       gcEventCount,
                                       p99PauseMs,
                                       maxPauseMs,
                                       fullGcCount,
                                       round((1.0 - gcTimeSecs / nullif(totalUptimeSecs, 0)) * 100.0, 2) AS throughputPct,
                                       round(gcEventCount * 1.0 / nullif(totalUptimeSecs, 0), 3) AS gcFreqHz
                                FROM stats
                            )
                            SELECT round(throughputPct, 2) AS "Throughput %",
                                   round(p99PauseMs, 2) AS "P99 Pause (ms)",
                                   round(maxPauseMs, 2) AS "Max Pause (ms)",
                                   gcEventCount AS "GC Events",
                                   fullGcCount AS "Full GC Count",
                                   round(gcFreqHz, 3) AS "GC Frequency (Hz)",
                                   round(totalUptimeSecs, 1) AS "Uptime (s)",
                                   CASE
                                       WHEN throughputPct >= 99.0 AND p99PauseMs < 100 AND fullGcCount = 0 THEN 'Good'
                                       WHEN throughputPct >= 95.0 AND p99PauseMs < 500 AND fullGcCount <= 2 THEN 'Warning'
                                       ELSE 'Critical'
                                   END AS "Health",
                                   CASE
                                       WHEN throughputPct < 95.0 THEN 'Low throughput — GC consuming > 5% of JVM time'
                                       WHEN fullGcCount > 2 THEN 'Multiple Full GC events detected'
                                       WHEN p99PauseMs >= 500 THEN 'P99 pause exceeds 500ms — check for Full GC or allocation spikes'
                                       WHEN p99PauseMs >= 100 THEN 'P99 pause exceeds 100ms latency target'
                                       ELSE 'No major GC issues detected'
                                   END AS "Primary Concern"
                            FROM derived
                            """,
                        "jvmlog_gc_event")
                    .description("GC health score — composite diagnostic inspired by GCeasy. Throughput, P99, Full GC count, and a traffic-light rating with primary concern."),
                new View(
                        "jvmlog-gc-recommendations",
                        "jvmlog",
                        "GC Log: Tuning Recommendations",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-recommendations" AS
                            WITH stats AS (
                                SELECT max(uptimeSecs) - min(uptimeSecs) AS totalUptimeSecs,
                                       sum(pauseMs) / 1000.0 AS gcTimeSecs,
                                       count(*) AS gcEventCount,
                                       approx_quantile(pauseMs, 0.99) AS p99PauseMs,
                                       max(pauseMs) AS maxPauseMs,
                                       avg(pauseMs) AS avgPauseMs,
                                       count(*) FILTER (WHERE lower(gcType) LIKE '%full%'
                                                           OR cause = 'System.gc()') AS fullGcCount,
                                       count(*) FILTER (WHERE cause = 'System.gc()') AS systemGcCount,
                                       count(*) FILTER (WHERE cause = 'Allocation Failure'
                                                           OR cause = 'G1 Humongous Allocation') AS allocFailures
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            ),
                            derived AS (
                                SELECT *,
                                       round((1.0 - gcTimeSecs / nullif(totalUptimeSecs, 0)) * 100.0, 2) AS throughputPct,
                                       round(gcEventCount * 1.0 / nullif(totalUptimeSecs, 0), 3) AS gcFreqHz
                                FROM stats
                            ),
                            recs AS (
                                SELECT 'Throughput' AS category,
                                       CASE WHEN throughputPct < 95 THEN 'Critical'
                                            WHEN throughputPct < 99 THEN 'Warning'
                                            ELSE 'OK' END AS severity,
                                       round(throughputPct, 2) || '%' AS observed,
                                       CASE WHEN throughputPct < 95 THEN 'Increase -Xmx / -Xms or switch to ZGC/Shenandoah for lower STW overhead'
                                            WHEN throughputPct < 99 THEN 'Consider tuning GC thread count (-XX:ParallelGCThreads) or increasing heap'
                                            ELSE 'Throughput is healthy (≥ 99%)' END AS recommendation
                                FROM derived
                                UNION ALL
                                SELECT 'P99 Pause',
                                       CASE WHEN p99PauseMs >= 500 THEN 'Critical'
                                            WHEN p99PauseMs >= 100 THEN 'Warning'
                                            ELSE 'OK' END,
                                       round(p99PauseMs, 1) || 'ms',
                                       CASE WHEN p99PauseMs >= 500 THEN 'P99 ≥ 500ms: switch to ZGC or Shenandoah for sub-millisecond STW; investigate Full GC triggers'
                                            WHEN p99PauseMs >= 100 THEN 'P99 ≥ 100ms: tune -XX:MaxGCPauseMillis or increase heap to reduce evacuation pause frequency'
                                            ELSE 'P99 pause is within typical latency targets' END
                                FROM derived
                                UNION ALL
                                SELECT 'Full GC Events',
                                       CASE WHEN fullGcCount > 5 THEN 'Critical'
                                            WHEN fullGcCount > 0 THEN 'Warning'
                                            ELSE 'OK' END,
                                       fullGcCount::VARCHAR || ' events',
                                       CASE WHEN fullGcCount > 5 THEN 'Severe Full GC activity: profile heap allocation, check for memory leaks, increase -Xmx'
                                            WHEN fullGcCount > 0 THEN 'Full GC occurred: review heap sizing and allocation patterns; add -XX:+PrintGCDetails for more context'
                                            ELSE 'No Full GC events — good' END
                                FROM derived
                                UNION ALL
                                SELECT 'System.gc() Calls',
                                       CASE WHEN systemGcCount > 0 THEN 'Warning' ELSE 'OK' END,
                                       systemGcCount::VARCHAR || ' calls',
                                       CASE WHEN systemGcCount > 0 THEN 'Application or library calling System.gc() — add -XX:+DisableExplicitGC to suppress; investigate callers'
                                            ELSE 'No explicit System.gc() calls detected' END
                                FROM derived
                                UNION ALL
                                SELECT 'Allocation Failures',
                                       CASE WHEN allocFailures > 10 THEN 'Critical'
                                            WHEN allocFailures > 0 THEN 'Warning'
                                            ELSE 'OK' END,
                                       allocFailures::VARCHAR || ' events',
                                       CASE WHEN allocFailures > 10 THEN 'Frequent allocation failures: young gen too small (-XX:NewSize/-XX:NewRatio) or allocation rate too high'
                                            WHEN allocFailures > 0 THEN 'Allocation failures present: monitor with -Xlog:gc*:file to check allocation hotspots'
                                            ELSE 'No allocation failures detected' END
                                FROM derived
                                UNION ALL
                                SELECT 'GC Frequency',
                                       CASE WHEN gcFreqHz > 10 THEN 'Warning'
                                            WHEN gcFreqHz > 5 THEN 'Info'
                                            ELSE 'OK' END,
                                       round(gcFreqHz, 2) || ' Hz',
                                       CASE WHEN gcFreqHz > 10 THEN 'Very high GC frequency (> 10/s): increase young gen size or reduce allocation rate'
                                            WHEN gcFreqHz > 5 THEN 'Elevated GC frequency (> 5/s): consider -XX:NewRatio or heap expansion'
                                            ELSE 'GC frequency within normal range' END
                                FROM derived
                            )
                            SELECT category AS "Category",
                                   severity AS "Severity",
                                   observed AS "Observed",
                                   recommendation AS "Recommendation"
                            FROM recs
                            ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 WHEN 'Info' THEN 3 ELSE 4 END, category
                            """,
                        "jvmlog_gc_event")
                    .description("SQL-driven tuning recommendations — analyses throughput, P99, Full GC, System.gc(), allocation failures, and GC frequency to suggest configuration changes."),
                new View(
                        "jvmlog-zgc-generational",
                        "jvmlog",
                        "GC Log: ZGC Generational Breakdown",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-generational" AS
                            WITH gen_stats AS (
                                SELECT generation,
                                       count(DISTINCT gcId) AS cycleCount,
                                       sum(CASE WHEN concurrent THEN durationMs ELSE 0 END) AS totalConcurrentMs,
                                       sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS totalPauseMs,
                                       avg(CASE WHEN concurrent THEN durationMs ELSE NULL END) AS avgConcurrentMs,
                                       avg(CASE WHEN NOT concurrent THEN durationMs ELSE NULL END) AS avgPauseMs,
                                       max(CASE WHEN NOT concurrent THEN durationMs ELSE NULL END) AS maxPauseMs
                                FROM jvmlog_zgc_phases
                                WHERE generation IS NOT NULL AND generation != 'N/A'
                                GROUP BY generation
                            )
                            SELECT generation AS "Generation",
                                   cycleCount AS "Cycles",
                                   round(totalConcurrentMs, 2) AS "Total Concurrent (ms)",
                                   round(totalPauseMs, 2) AS "Total Pause (ms)",
                                   round(avgConcurrentMs, 2) AS "Avg Concurrent (ms)",
                                   round(avgPauseMs, 2) AS "Avg Pause (ms)",
                                   round(maxPauseMs, 2) AS "Max Pause (ms)"
                            FROM gen_stats
                            ORDER BY generation
                            """,
                        "jvmlog_zgc_phases")
                    .description("ZGC generational collection breakdown (JDK 21+) — Young vs Old generation cycle counts, concurrent time, and pause time."),
                new View(
                        "jvmlog-concurrent-overhead",
                        "jvmlog",
                        "GC Log: Concurrent GC Overhead",
                        null,
                        """
                            CREATE VIEW "jvmlog-concurrent-overhead" AS
                            WITH phase_totals AS (
                                SELECT sum(durationMs) AS totalConcurrentMs,
                                       count(DISTINCT gcId) AS cycleCount
                                FROM jvmlog_gc_phase
                                WHERE durationMs IS NOT NULL
                            ),
                            uptime AS (
                                SELECT max(uptimeSecs) - min(uptimeSecs) AS totalUptimeSecs
                                FROM jvmlog_gc_event
                                WHERE uptimeSecs IS NOT NULL
                            )
                            SELECT round(p.totalConcurrentMs, 2) AS "Total Concurrent Phase Time (ms)",
                                   round(u.totalUptimeSecs * 1000, 2) AS "Total Uptime (ms)",
                                   round(p.totalConcurrentMs / nullif(u.totalUptimeSecs * 1000, 0) * 100.0, 2) AS "Concurrent Overhead %",
                                   p.cycleCount AS "Cycles with Phase Data"
                            FROM phase_totals p
                            CROSS JOIN uptime u
                            """,
                        "jvmlog_gc_event", "jvmlog_gc_phase")
                    .description("Total concurrent GC phase time as a percentage of JVM uptime — measures the background GC work overhead for concurrent collectors (G1, ZGC, Shenandoah)."),
                new View(
                        "jvmlog-gc-log-quality",
                        "jvmlog",
                        "GC Log: Log Quality Diagnostic",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-log-quality" AS
                            WITH events AS (
                                SELECT count(*) AS totalEvents,
                                       count(*) FILTER (WHERE pauseMs IS NOT NULL) AS eventsWithPause,
                                       count(*) FILTER (WHERE uptimeSecs IS NOT NULL) AS eventsWithUptime,
                                       min(gcId) AS minGcId,
                                       max(gcId) AS maxGcId,
                                       count(DISTINCT gcId) AS distinctGcIds,
                                       min(uptimeSecs) AS firstEventSecs,
                                       max(uptimeSecs) AS lastEventSecs
                                FROM jvmlog_gc_event
                            ),
                            unknown AS (
                                SELECT sum(count) AS unknownLineCount
                                FROM jvmlog_unknown_lines
                            )
                            SELECT e.totalEvents AS "Total GC Events",
                                   e.eventsWithPause AS "Events with Pause",
                                   e.eventsWithUptime AS "Events with Uptime",
                                   e.minGcId AS "First GC ID",
                                   e.maxGcId AS "Last GC ID",
                                   e.distinctGcIds AS "Distinct GC IDs",
                                   (e.maxGcId - e.minGcId + 1 - e.distinctGcIds) AS "Missing GC IDs",
                                   round(e.firstEventSecs, 3) AS "First Event Uptime (s)",
                                   round(e.lastEventSecs, 3) AS "Last Event Uptime (s)",
                                   round(e.lastEventSecs - e.firstEventSecs, 3) AS "Log Duration (s)",
                                   coalesce(u.unknownLineCount, 0) AS "Unmatched Lines"
                            FROM events e
                            CROSS JOIN unknown u
                            """,
                        "jvmlog_gc_event", "jvmlog_unknown_lines")
                    .description("GC log quality diagnostics — checks for missing GC IDs (truncated/rotated logs), uptime coverage, and unmatched lines."),
                new View(
                        "jvmlog-heap-resize-summary",
                        "jvmlog",
                        "GC Log: Heap Resize Summary",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-resize-summary" AS
                            SELECT decision AS "Decision",
                                   count(*) AS "Count",
                                   round(sum(actualExpansionBytes) / 1048576.0, 1) AS "Total (MB)",
                                   round(avg(actualExpansionBytes) / 1048576.0, 1) AS "Avg (MB)",
                                   round(max(actualExpansionBytes) / 1048576.0, 1) AS "Max (MB)"
                            FROM jvmlog_g1_ergonomics
                            GROUP BY decision
                            ORDER BY count(*) DESC
                            """,
                        "jvmlog_g1_ergonomics")
                    .description("Summary of G1 heap resize decisions — frequent expansions with no shrinks indicates the JVM needs a larger -Xms."),
                new View(
                        "jvmlog-allocation-rate-timeline",
                        "jvmlog",
                        "GC Log: Allocation Rate Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-allocation-rate-timeline" AS
                            WITH snapshots AS (
                                SELECT gcId,
                                       heapBefore / 1048576.0 AS heapBeforeMB,
                                       heapAfter / 1048576.0 AS heapAfterMB
                                FROM jvmlog_heap_snapshot
                                QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapBefore DESC NULLS LAST) = 1
                            ),
                            joined AS (
                                SELECT e.gcId,
                                       e.uptimeSecs,
                                       s.heapBeforeMB - LAG(s.heapAfterMB) OVER (ORDER BY e.uptimeSecs) AS allocatedMB,
                                       e.uptimeSecs - LAG(e.uptimeSecs) OVER (ORDER BY e.uptimeSecs) AS intervalSecs
                                FROM jvmlog_gc_event e
                                JOIN snapshots s ON e.gcId = s.gcId
                                WHERE e.uptimeSecs IS NOT NULL
                            ),
                            with_rate AS (
                                SELECT gcId,
                                       uptimeSecs,
                                       allocatedMB,
                                       intervalSecs,
                                       allocatedMB / nullif(intervalSecs, 0) AS allocRateMBperSec
                                FROM joined
                                WHERE allocatedMB IS NOT NULL AND intervalSecs > 0
                            )
                            SELECT floor(uptimeSecs / 10) * 10 AS "Window Start (s)",
                                   round(sum(allocatedMB), 2) AS "Total Allocated (MB)",
                                   round(avg(allocRateMBperSec), 2) AS "Avg Alloc Rate (MB/s)",
                                   round(max(allocRateMBperSec), 2) AS "Peak Alloc Rate (MB/s)",
                                   count(*) AS "GC Events"
                            FROM with_rate
                            GROUP BY floor(uptimeSecs / 10) * 10
                            ORDER BY "Window Start (s)"
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Windowed allocation rate — average and peak MB/s per 10-second window. Spikes correlate with allocation bursts that cause GC pressure."),
                new View(
                        "jvmlog-pause-regression",
                        "jvmlog",
                        "GC Log: Pause Time Regression",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-regression" AS
                            WITH windowed AS (
                                SELECT gcId,
                                       uptimeSecs,
                                       pauseMs,
                                       floor(uptimeSecs / 30) * 30 AS windowStart
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            )
                            SELECT round(windowStart, 1) AS "Window Start (s)",
                                   count(*) AS "GC Count",
                                   round(avg(pauseMs), 2) AS "Avg Pause (ms)",
                                   round(approx_quantile(pauseMs, 0.95), 2) AS "P95 Pause (ms)",
                                   round(approx_quantile(pauseMs, 0.99), 2) AS "P99 Pause (ms)",
                                   round(max(pauseMs), 2) AS "Max Pause (ms)"
                            FROM windowed
                            GROUP BY windowStart
                            ORDER BY windowStart
                            """,
                        "jvmlog_gc_event")
                    .description("P95 and P99 pause time per 30-second window — rising P99 over time indicates GC regression (memory pressure, fragmentation, or heap leak)."),
                new View(
                        "jvmlog-zgc-allocation-rate",
                        "jvmlog",
                        "GC Log: ZGC Allocation Rate",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-allocation-rate" AS
                            SELECT gcId AS "GC ID",
                                   round(allocRateMbps, 2) AS "Alloc Rate (MB/s)",
                                   load1s AS "Load (1s)",
                                   load5s AS "Load (5s)",
                                   allocStalls AS "Alloc Stalls"
                            FROM jvmlog_zgc_load
                            WHERE allocRateMbps IS NOT NULL
                            ORDER BY gcId
                            """,
                        "jvmlog_zgc_load")
                    .description("ZGC allocation rate per cycle from [gc,load] tag — high allocation rates with stalls indicate the application is outpacing the GC."),
                new View(
                        "jvmlog-top-pauses-by-cause",
                        "jvmlog",
                        "GC Log: Top Pauses by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-top-pauses-by-cause" AS
                            SELECT cause AS "Cause",
                                   gcId AS "GC ID",
                                   round(uptimeSecs, 3) AS "Uptime (s)",
                                   gcType AS "Type",
                                   round(pauseMs, 2) AS "Pause (ms)"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            QUALIFY row_number() OVER (PARTITION BY cause ORDER BY pauseMs DESC) <= 10
                            ORDER BY cause, pauseMs DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Top 10 longest pause events per GC cause — useful for identifying whether worst-case latency concentrates in one cause."),
                new View(
                        "jvmlog-shenandoah-mode-analysis",
                        "jvmlog",
                        "GC Log: Shenandoah Mode Analysis",
                        null,
                        """
                            CREATE VIEW "jvmlog-shenandoah-mode-analysis" AS
                            WITH modes AS (
                                SELECT CASE
                                           WHEN lower(gcType) LIKE '%full%' THEN 'Full GC'
                                           WHEN lower(gcType) LIKE '%degenerat%' THEN 'Degenerated GC'
                                           WHEN gcType IN ('Init Mark', 'Final Mark', 'Init Update Refs', 'Final Update Refs') THEN 'Normal Cycle'
                                           WHEN gcType IN ('Final Evac') THEN 'Normal Cycle'
                                           ELSE 'Other'
                                       END AS mode,
                                       pauseMs,
                                       uptimeSecs
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL
                            ),
                            total AS (SELECT count(*) AS n, sum(pauseMs) AS totalMs FROM modes)
                            SELECT mode AS "Mode",
                                   count(*) AS "Events",
                                   round(count(*) * 100.0 / nullif((SELECT n FROM total), 0), 1) AS "% of Events",
                                   round(sum(pauseMs), 2) AS "Total Pause (ms)",
                                   round(sum(pauseMs) * 100.0 / nullif((SELECT totalMs FROM total), 0), 1) AS "% of Pause",
                                   round(avg(pauseMs), 2) AS "Avg Pause (ms)",
                                   round(max(pauseMs), 2) AS "Max Pause (ms)"
                            FROM modes
                            GROUP BY mode
                            ORDER BY "Total Pause (ms)" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Shenandoah GC mode breakdown — Degenerated and Full GC modes indicate the JVM could not keep up with allocation pressure."),
                new View(
                        "jvmlog-phase-top-slow",
                        "jvmlog",
                        "GC Log: Slowest Phase Executions",
                        null,
                        """
                            CREATE VIEW "jvmlog-phase-top-slow" AS
                            SELECT phaseName AS "Phase",
                                   gcId AS "GC ID",
                                   round(uptimeSecs, 3) AS "Uptime (s)",
                                   round(durationMs, 3) AS "Duration (ms)"
                            FROM jvmlog_gc_phase
                            WHERE durationMs IS NOT NULL
                            QUALIFY row_number() OVER (PARTITION BY phaseName ORDER BY durationMs DESC) <= 5
                            ORDER BY phaseName, durationMs DESC
                            """,
                        "jvmlog_gc_phase")
                    .description("Top 5 slowest executions per GC phase — identifies outlier phase durations that cause the occasional long pause."),

                // ---------------------------------------------------------------
                // GC efficiency by cause: heap reclaimed per ms of pause
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-gc-efficiency-by-cause",
                        "jvmlog",
                        "GC Log: GC Efficiency by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-efficiency-by-cause" AS
                            SELECT e.cause AS "Cause",
                                   count(*)                                         AS "Events",
                                   round(sum(h.heapBefore - h.heapAfter) / 1048576.0, 1)    AS "Total Reclaimed (MB)",
                                   round(sum(e.pauseMs), 1)                         AS "Total Pause (ms)",
                                   round(
                                       CASE WHEN sum(e.pauseMs) > 0
                                            THEN sum(h.heapBefore - h.heapAfter) / 1048576.0 / sum(e.pauseMs)
                                            ELSE NULL END,
                                       4)                                            AS "MB Reclaimed/ms",
                                   round(avg(h.heapBefore - h.heapAfter) / 1048576.0, 2) AS "Avg Reclaimed/GC (MB)"
                            FROM jvmlog_gc_event e
                            JOIN jvmlog_heap_snapshot h USING (gcId)
                            WHERE e.pauseMs IS NOT NULL
                              AND h.heapBefore IS NOT NULL AND h.heapAfter IS NOT NULL
                            GROUP BY e.cause
                            ORDER BY "MB Reclaimed/ms" DESC NULLS LAST
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Heap reclaimed per millisecond of pause per GC cause — low efficiency causes are wasting stop-the-world budget."),

                // ---------------------------------------------------------------
                // Metaspace growth trend: linear regression to detect class loader leaks
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-metaspace-growth-trend",
                        "jvmlog",
                        "GC Log: Metaspace Growth Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-metaspace-growth-trend" AS
                            WITH ms AS (
                                SELECT m.gcId,
                                       e.uptimeSecs                                  AS uptimeSecs,
                                       m.metaspaceAfter / 1048576.0                  AS metaspaceAfterMB,
                                       m.classSpaceAfter / 1048576.0                 AS classSpaceAfterMB
                                FROM jvmlog_metaspace m
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE m.metaspaceAfter IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT count(*)                                                         AS "Samples",
                                   round(min(metaspaceAfterMB), 2)                                 AS "Min Metaspace (MB)",
                                   round(max(metaspaceAfterMB), 2)                                 AS "Max Metaspace (MB)",
                                   round(regr_slope(metaspaceAfterMB, uptimeSecs), 6)              AS "Metaspace Growth (MB/s)",
                                   round(regr_r2(metaspaceAfterMB, uptimeSecs), 4)                 AS "R²",
                                   round(regr_slope(classSpaceAfterMB, uptimeSecs), 6)             AS "Class Space Growth (MB/s)",
                                   CASE
                                     WHEN regr_r2(metaspaceAfterMB, uptimeSecs) > 0.8
                                          AND regr_slope(metaspaceAfterMB, uptimeSecs) > 0.001
                                     THEN 'Likely class loader leak'
                                     WHEN regr_slope(metaspaceAfterMB, uptimeSecs) > 0
                                     THEN 'Slow growth — monitor'
                                     ELSE 'Stable'
                                   END                                                             AS "Assessment"
                            FROM ms
                            """,
                        "jvmlog_metaspace", "jvmlog_gc_event")
                    .description("Linear regression on metaspace-after-GC values — high R² with positive slope indicates a class loader leak.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-metaspace-growth-trend" AS
                            WITH ms AS (
                                SELECT gcId * 1.0                      AS uptimeSecs,
                                       metaspaceAfter / 1048576.0      AS metaspaceAfterMB,
                                       classSpaceAfter / 1048576.0     AS classSpaceAfterMB
                                FROM jvmlog_metaspace
                                WHERE metaspaceAfter IS NOT NULL
                            )
                            SELECT count(*)                                                         AS "Samples",
                                   round(min(metaspaceAfterMB), 2)                                 AS "Min Metaspace (MB)",
                                   round(max(metaspaceAfterMB), 2)                                 AS "Max Metaspace (MB)",
                                   round(regr_slope(metaspaceAfterMB, uptimeSecs), 6)              AS "Metaspace Growth (MB/s)",
                                   round(regr_r2(metaspaceAfterMB, uptimeSecs), 4)                 AS "R²",
                                   round(regr_slope(classSpaceAfterMB, uptimeSecs), 6)             AS "Class Space Growth (MB/s)",
                                   CASE
                                     WHEN regr_r2(metaspaceAfterMB, uptimeSecs) > 0.8
                                          AND regr_slope(metaspaceAfterMB, uptimeSecs) > 0.001
                                     THEN 'Likely class loader leak'
                                     WHEN regr_slope(metaspaceAfterMB, uptimeSecs) > 0
                                     THEN 'Slow growth — monitor'
                                     ELSE 'Stable'
                                   END                                                             AS "Assessment"
                            FROM ms
                            """,
                        "jvmlog_metaspace"),

                // ---------------------------------------------------------------
                // OOM risk estimate: extrapolate heap growth rate to time-to-OOM
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-oom-risk-estimate",
                        "jvmlog",
                        "GC Log: OOM Risk Estimate",
                        null,
                        """
                            CREATE VIEW "jvmlog-oom-risk-estimate" AS
                            WITH snap AS (
                                SELECT h.gcId,
                                       e.uptimeSecs                      AS uptimeSecs,
                                       h.heapAfter  / 1048576.0          AS heapAfterMB,
                                       h.heapCommittedAfter / 1048576.0  AS heapCommittedMB
                                FROM jvmlog_heap_snapshot h
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE h.heapAfter IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            ),
                            stats AS (
                                SELECT count(*)                                               AS n,
                                       max(uptimeSecs)                                        AS lastUptimeSecs,
                                       max(heapCommittedMB)                                   AS maxCommittedMB,
                                       regr_slope(heapAfterMB, uptimeSecs)                    AS slopeMBperSec,
                                       regr_r2(heapAfterMB, uptimeSecs)                       AS r2,
                                       regr_intercept(heapAfterMB, uptimeSecs)                AS intercept,
                                       max(heapAfterMB)                                       AS currentHeapMB
                                FROM snap
                            )
                            SELECT n                                                            AS "Samples",
                                   round(currentHeapMB, 1)                                     AS "Current Live Heap (MB)",
                                   round(maxCommittedMB, 1)                                    AS "Max Heap (MB)",
                                   round(maxCommittedMB - currentHeapMB, 1)                    AS "Headroom (MB)",
                                   round(slopeMBperSec * 1000, 4)                              AS "Growth Rate (MB/s)",
                                   round(r2, 4)                                                AS "R²",
                                   CASE
                                     WHEN slopeMBperSec <= 0 OR r2 < 0.5
                                     THEN 'No clear growth trend'
                                     ELSE round(
                                             (maxCommittedMB - (intercept + slopeMBperSec * lastUptimeSecs))
                                             / slopeMBperSec / 60.0,
                                             1)
                                   END                                                         AS "Est. Time-to-OOM (min)",
                                   CASE
                                     WHEN slopeMBperSec <= 0 OR r2 < 0.5 THEN 'Low — no significant growth'
                                     WHEN (maxCommittedMB - currentHeapMB) / slopeMBperSec < 300 THEN 'Critical — OOM imminent'
                                     WHEN (maxCommittedMB - currentHeapMB) / slopeMBperSec < 3600 THEN 'High — hours until OOM'
                                     ELSE 'Moderate — days until potential OOM'
                                   END                                                         AS "Risk Level"
                            FROM stats
                            """,
                        "jvmlog_heap_snapshot", "jvmlog_gc_event")
                    .description("Extrapolates current heap growth rate (linear regression) to estimate time-to-OOM — only meaningful when R² > 0.5 indicating consistent leak.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-oom-risk-estimate" AS
                            WITH snap AS (
                                SELECT gcId * 1.0 AS uptimeSecs,
                                       heapAfter  / 1048576.0 AS heapAfterMB,
                                       heapCommittedAfter / 1048576.0 AS heapCommittedMB
                                FROM jvmlog_heap_snapshot
                                WHERE heapAfter IS NOT NULL
                            ),
                            stats AS (
                                SELECT count(*) AS n,
                                       max(uptimeSecs) AS lastUptimeSecs,
                                       max(heapCommittedMB) AS maxCommittedMB,
                                       regr_slope(heapAfterMB, uptimeSecs) AS slopeMBperSec,
                                       regr_r2(heapAfterMB, uptimeSecs) AS r2,
                                       regr_intercept(heapAfterMB, uptimeSecs) AS intercept,
                                       max(heapAfterMB) AS currentHeapMB
                                FROM snap
                            )
                            SELECT n AS "Samples",
                                   round(currentHeapMB, 1) AS "Current Live Heap (MB)",
                                   round(maxCommittedMB, 1) AS "Max Heap (MB)",
                                   round(maxCommittedMB - currentHeapMB, 1) AS "Headroom (MB)",
                                   round(slopeMBperSec * 1000, 4) AS "Growth Rate (MB/s)",
                                   round(r2, 4) AS "R²",
                                   CASE
                                     WHEN slopeMBperSec <= 0 OR r2 < 0.5 THEN 'No clear growth trend'
                                     ELSE round((maxCommittedMB - (intercept + slopeMBperSec * lastUptimeSecs)) / slopeMBperSec / 60.0, 1)
                                   END AS "Est. Time-to-OOM (min)",
                                   CASE
                                     WHEN slopeMBperSec <= 0 OR r2 < 0.5 THEN 'Low — no significant growth'
                                     WHEN (maxCommittedMB - currentHeapMB) / slopeMBperSec < 300 THEN 'Critical — OOM imminent'
                                     WHEN (maxCommittedMB - currentHeapMB) / slopeMBperSec < 3600 THEN 'High — hours until OOM'
                                     ELSE 'Moderate — days until potential OOM'
                                   END AS "Risk Level"
                            FROM stats
                            """,
                        "jvmlog_heap_snapshot"),

                // ---------------------------------------------------------------
                // G1 concurrent mark duration trend: is marking getting slower?
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-g1-mark-trend",
                        "jvmlog",
                        "GC Log: G1 Concurrent Mark Duration Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-mark-trend" AS
                            WITH marks AS (
                                SELECT p.gcId,
                                       e.uptimeSecs     AS uptimeSecs,
                                       p.durationMs
                                FROM jvmlog_gc_phase p
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE lower(p.phaseName) LIKE '%concurrent mark%'
                                  AND p.durationMs IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT count(*)                                           AS "Mark Events",
                                   round(min(durationMs), 1)                         AS "Min (ms)",
                                   round(avg(durationMs), 1)                         AS "Avg (ms)",
                                   round(max(durationMs), 1)                         AS "Max (ms)",
                                   round(approx_quantile(durationMs, 0.99), 1)       AS "P99 (ms)",
                                   round(regr_slope(durationMs, uptimeSecs), 4)      AS "Trend (ms/s)",
                                   round(regr_r2(durationMs, uptimeSecs), 4)         AS "R²",
                                   CASE
                                     WHEN regr_r2(durationMs, uptimeSecs) > 0.6
                                          AND regr_slope(durationMs, uptimeSecs) > 0
                                     THEN 'Degrading — concurrent mark getting slower'
                                     WHEN regr_r2(durationMs, uptimeSecs) > 0.6
                                          AND regr_slope(durationMs, uptimeSecs) < 0
                                     THEN 'Improving — concurrent mark getting faster'
                                     ELSE 'Stable'
                                   END                                               AS "Trend Assessment"
                            FROM marks
                            """,
                        "jvmlog_gc_phase", "jvmlog_gc_event")
                    .description("Linear regression on G1 concurrent mark durations — a degrading trend (positive slope, high R²) indicates increasing live set or reduced CPU for marking.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-g1-mark-trend" AS
                            WITH marks AS (
                                SELECT gcId * 1.0 AS uptimeSecs,
                                       durationMs
                                FROM jvmlog_gc_phase
                                WHERE lower(phaseName) LIKE '%concurrent mark%'
                                  AND durationMs IS NOT NULL
                            )
                            SELECT count(*)                                           AS "Mark Events",
                                   round(min(durationMs), 1)                         AS "Min (ms)",
                                   round(avg(durationMs), 1)                         AS "Avg (ms)",
                                   round(max(durationMs), 1)                         AS "Max (ms)",
                                   round(approx_quantile(durationMs, 0.99), 1)       AS "P99 (ms)",
                                   round(regr_slope(durationMs, uptimeSecs), 4)      AS "Trend (ms/s)",
                                   round(regr_r2(durationMs, uptimeSecs), 4)         AS "R²",
                                   CASE
                                     WHEN regr_r2(durationMs, uptimeSecs) > 0.6
                                          AND regr_slope(durationMs, uptimeSecs) > 0
                                     THEN 'Degrading — concurrent mark getting slower'
                                     WHEN regr_r2(durationMs, uptimeSecs) > 0.6
                                          AND regr_slope(durationMs, uptimeSecs) < 0
                                     THEN 'Improving — concurrent mark getting faster'
                                     ELSE 'Stable'
                                   END                                               AS "Trend Assessment"
                            FROM marks
                            """,
                        "jvmlog_gc_phase"),
            };

    public static List<View> getViews() {
        return Arrays.stream(views)
                .takeWhile(v -> !v.name().equals("break"))
                .filter(v -> !v.name().equals("break"))
                .toList();
    }

    public static void addToDatabase(DuckDBConnection connection) throws SQLException {
        Set<String> existingTables = getTableNames(connection);
        // Remove existing views
        try (ResultSet rs =
                connection.createStatement().executeQuery("SELECT view_name FROM duckdb_views;")) {
            while (rs.next()) {
                String viewName = rs.getString(1);
                connection.createStatement().execute("DROP VIEW IF EXISTS \"" + viewName + "\"");
            }
        }
        for (View view : getViews()) {
            if (!view.isValid(existingTables)) {
                String alternative = view.getBestMatchingQuery(existingTables);
                if (alternative != null) {
                    try {
                        Statement stmt = connection.createStatement();
                        stmt.execute(alternative);
                        if (view.description() != null) {
                            stmt.execute(
                                    "COMMENT ON VIEW \""
                                            + view.name()
                                            + "\" IS "
                                            + stmt.enquoteLiteral(view.description())
                                            + ";");
                        }
                    } catch (SQLException e) {
                        if (isPartialSchemaError(e)) {
                            System.err.println(
                                    "[ViewCollection] Skipping view '"
                                            + view.name()
                                            + "' (alternative): "
                                            + e.getMessage().lines().findFirst().orElse(e.getMessage()));
                        } else {
                            throw new RuntimeSQLException(alternative, e);
                        }
                    }
                }
            } else {
                try {
                    connection.createStatement().execute(view.definition());
                } catch (SQLException e) {
                    // Partial event schemas (e.g. CJFR recordings) may have tables with fewer
                    // columns than expected, or JOIN targets that weren't imported. Skip views
                    // that can't be created rather than aborting the entire import.
                    if (isPartialSchemaError(e)) {
                        System.err.println(
                                "[ViewCollection] Skipping view '"
                                        + view.name()
                                        + "': "
                                        + e.getMessage().lines().findFirst().orElse(e.getMessage()));
                    } else {
                        throw new RuntimeSQLException(
                                "Error creating view " + view.name() + "   " + view.referencedTables(),
                                e);
                    }
                }
            }
        }
        connection
                .createStatement()
                .execute(
                        """
                CREATE TABLE IF NOT EXISTS jfr$views (
                    name VARCHAR PRIMARY KEY,
                    category VARCHAR,
                    label VARCHAR,
                    definition VARCHAR
                )
                """);
        try (var appender = connection.createAppender("", "jfr$views")) {
            for (View view : getViews()) {
                appender.beginRow();
                appender.append(view.name());
                appender.append(view.category());
                appender.append(view.label());
                appender.append(view.definition());
                appender.endRow();
            }
        }
    }

    /**
     * Returns true when a view-creation failure is caused by a partial event schema — e.g. a CJFR
     * recording that has the primary table but is missing columns or JOIN targets. These failures
     * are acceptable: the view is simply skipped.
     */
    private static boolean isPartialSchemaError(SQLException e) {
        String msg = e.getMessage();
        if (msg == null) return false;
        // Column referenced in SELECT not present in the imported table
        if (msg.contains("not found in FROM clause")) return true;
        // JOIN target table was not imported (not in the recording)
        if (msg.contains("does not exist") || msg.contains("Catalog Error")) return true;
        // A column that should be numeric is VARCHAR because its JFR type was not mapped
        if (msg.contains("No function matches the given name and argument types")) return true;
        return false;
    }

    public static Map<String, List<View>> getViewsByCategory() {
        return Arrays.stream(views).collect(Collectors.groupingBy(View::category));
    }

    public static View getView(String name) {
        return Arrays.stream(views)
                .filter(v -> v.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No such view: " + name));
    }
}
