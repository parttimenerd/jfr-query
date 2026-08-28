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

                // ---------------------------------------------------------------
                // Heap fragmentation / over-reservation indicator
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-heap-fragmentation",
                        "jvmlog",
                        "GC Log: Heap Fragmentation / Over-Reservation",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-fragmentation" AS
                            WITH snap AS (
                                SELECT h.gcId,
                                       h.heapAfter         / 1048576.0  AS usedMB,
                                       h.heapCommittedAfter / 1048576.0 AS committedMB
                                FROM jvmlog_heap_snapshot h
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE h.heapAfter IS NOT NULL
                                  AND h.heapCommittedAfter IS NOT NULL
                            )
                            SELECT count(*)                                                           AS "Samples",
                                   round(min(committedMB), 1)                                        AS "Min Committed (MB)",
                                   round(max(committedMB), 1)                                        AS "Max Committed (MB)",
                                   round(avg(committedMB - usedMB), 1)                               AS "Avg Unused Committed (MB)",
                                   round(max(committedMB - usedMB), 1)                               AS "Max Unused Committed (MB)",
                                   round(avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)), 1) AS "Avg Unused %",
                                   round(max(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)), 1) AS "Max Unused %",
                                   CASE
                                     WHEN avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)) > 50
                                     THEN 'High — large reserved-but-unused headroom, consider -Xmx reduction'
                                     WHEN avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)) > 25
                                     THEN 'Moderate — heap headroom normal for concurrent collectors'
                                     ELSE 'Low — heap is densely used'
                                   END                                                               AS "Assessment"
                            FROM snap
                            """,
                        "jvmlog_heap_snapshot", "jvmlog_gc_event")
                    .description("Tracks committed-but-unused heap headroom — large persistent headroom (> 50%) indicates the JVM is reserving far more heap than it needs.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-heap-fragmentation" AS
                            WITH snap AS (
                                SELECT heapAfter         / 1048576.0  AS usedMB,
                                       heapCommittedAfter / 1048576.0 AS committedMB
                                FROM jvmlog_heap_snapshot
                                WHERE heapAfter IS NOT NULL
                                  AND heapCommittedAfter IS NOT NULL
                            )
                            SELECT count(*)                                                           AS "Samples",
                                   round(min(committedMB), 1)                                        AS "Min Committed (MB)",
                                   round(max(committedMB), 1)                                        AS "Max Committed (MB)",
                                   round(avg(committedMB - usedMB), 1)                               AS "Avg Unused Committed (MB)",
                                   round(max(committedMB - usedMB), 1)                               AS "Max Unused Committed (MB)",
                                   round(avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)), 1) AS "Avg Unused %",
                                   round(max(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)), 1) AS "Max Unused %",
                                   CASE
                                     WHEN avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)) > 50
                                     THEN 'High — large reserved-but-unused headroom, consider -Xmx reduction'
                                     WHEN avg(100.0 * (committedMB - usedMB) / NULLIF(committedMB, 0)) > 25
                                     THEN 'Moderate — heap headroom normal for concurrent collectors'
                                     ELSE 'Low — heap is densely used'
                                   END                                                               AS "Assessment"
                            FROM snap
                            """,
                        "jvmlog_heap_snapshot"),

                // ---------------------------------------------------------------
                // Before/after heap ratio per cause
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-heap-reclaim-ratio",
                        "jvmlog",
                        "GC Log: Heap Reclaim Ratio by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-reclaim-ratio" AS
                            SELECT e.cause AS "Cause",
                                   count(*)                                                    AS "Events",
                                   round(avg(h.heapBefore / 1048576.0), 1)                    AS "Avg Heap Before (MB)",
                                   round(avg(h.heapAfter  / 1048576.0), 1)                    AS "Avg Heap After (MB)",
                                   round(avg(100.0 * (h.heapBefore - h.heapAfter)
                                             / NULLIF(h.heapBefore, 0)), 1)                   AS "Avg Reclaim %",
                                   round(min(100.0 * (h.heapBefore - h.heapAfter)
                                             / NULLIF(h.heapBefore, 0)), 1)                   AS "Min Reclaim %",
                                   round(max(100.0 * (h.heapBefore - h.heapAfter)
                                             / NULLIF(h.heapBefore, 0)), 1)                   AS "Max Reclaim %"
                            FROM jvmlog_gc_event e
                            JOIN jvmlog_heap_snapshot h USING (gcId)
                            WHERE h.heapBefore IS NOT NULL AND h.heapAfter IS NOT NULL
                            GROUP BY e.cause
                            ORDER BY "Avg Reclaim %" DESC NULLS LAST
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Average heap reclaim ratio per GC cause — low reclaim % for Allocation Failure indicates GC cannot keep up with allocation pressure."),

                // ---------------------------------------------------------------
                // Throughput degradation trend
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-throughput-degradation",
                        "jvmlog",
                        "GC Log: Throughput Degradation Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-throughput-degradation" AS
                            WITH windows AS (
                                SELECT floor(uptimeSecs / 30.0) * 30 AS windowStart,
                                       sum(pauseMs) AS totalPauseMs,
                                       count(*) AS gcCount
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                                GROUP BY floor(uptimeSecs / 30.0) * 30
                            ),
                            throughput AS (
                                SELECT windowStart,
                                       gcCount,
                                       CASE WHEN totalPauseMs < 30000
                                            THEN round(100.0 * (30000.0 - totalPauseMs) / 30000.0, 2)
                                            ELSE 0.0 END AS throughputPct
                                FROM windows
                            )
                            SELECT count(*)                                                    AS "Windows",
                                   round(min(throughputPct), 1)                               AS "Min Throughput %",
                                   round(avg(throughputPct), 1)                               AS "Avg Throughput %",
                                   round(max(throughputPct), 1)                               AS "Max Throughput %",
                                   round(regr_slope(throughputPct, windowStart), 6)           AS "Trend (%/s)",
                                   round(regr_r2(throughputPct, windowStart), 4)              AS "R²",
                                   CASE
                                     WHEN regr_r2(throughputPct, windowStart) > 0.5
                                          AND regr_slope(throughputPct, windowStart) < 0
                                     THEN 'Degrading — throughput declining over time'
                                     WHEN regr_r2(throughputPct, windowStart) > 0.5
                                          AND regr_slope(throughputPct, windowStart) > 0
                                     THEN 'Improving — throughput increasing over time'
                                     ELSE 'Stable — no significant throughput trend'
                                   END                                                        AS "Trend Assessment"
                            FROM throughput
                            """,
                        "jvmlog_gc_event")
                    .description("Linear regression on windowed application throughput — a declining trend with high R² indicates accumulating GC pressure over the JVM run."),

                // ---------------------------------------------------------------
                // G1 Old region growth trend
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-g1-old-region-trend",
                        "jvmlog",
                        "GC Log: G1 Old Region Growth Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-old-region-trend" AS
                            WITH old AS (
                                SELECT r.gcId,
                                       e.uptimeSecs,
                                       r.oldAfter
                                FROM jvmlog_g1_regions r
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE r.oldAfter IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT count(*)                                              AS "Cycles",
                                   round(min(oldAfter), 0)                              AS "Min Old Regions",
                                   round(max(oldAfter), 0)                              AS "Max Old Regions",
                                   round(avg(oldAfter), 1)                              AS "Avg Old Regions",
                                   round(regr_slope(oldAfter, uptimeSecs), 4)           AS "Trend (regions/s)",
                                   round(regr_r2(oldAfter, uptimeSecs), 4)              AS "R²",
                                   CASE
                                     WHEN regr_r2(oldAfter, uptimeSecs) > 0.6
                                          AND regr_slope(oldAfter, uptimeSecs) > 0
                                     THEN 'Growing — Old generation expanding; watch for mixed GC pressure'
                                     WHEN regr_r2(oldAfter, uptimeSecs) > 0.6
                                          AND regr_slope(oldAfter, uptimeSecs) < 0
                                     THEN 'Shrinking — Old generation being reclaimed'
                                     ELSE 'Stable'
                                   END                                                  AS "Trend Assessment"
                            FROM old
                            """,
                        "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("Linear regression on G1 Old region count after each GC — a growing Old generation with high R² indicates promotion rate exceeds reclaim rate.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-g1-old-region-trend" AS
                            WITH old AS (
                                SELECT gcId * 1.0 AS uptimeSecs,
                                       oldAfter
                                FROM jvmlog_g1_regions
                                WHERE oldAfter IS NOT NULL
                            )
                            SELECT count(*)                                              AS "Cycles",
                                   round(min(oldAfter), 0)                              AS "Min Old Regions",
                                   round(max(oldAfter), 0)                              AS "Max Old Regions",
                                   round(avg(oldAfter), 1)                              AS "Avg Old Regions",
                                   round(regr_slope(oldAfter, uptimeSecs), 4)           AS "Trend (regions/s)",
                                   round(regr_r2(oldAfter, uptimeSecs), 4)              AS "R²",
                                   CASE
                                     WHEN regr_r2(oldAfter, uptimeSecs) > 0.6
                                          AND regr_slope(oldAfter, uptimeSecs) > 0
                                     THEN 'Growing — Old generation expanding; watch for mixed GC pressure'
                                     WHEN regr_r2(oldAfter, uptimeSecs) > 0.6
                                          AND regr_slope(oldAfter, uptimeSecs) < 0
                                     THEN 'Shrinking — Old generation being reclaimed'
                                     ELSE 'Stable'
                                   END                                                  AS "Trend Assessment"
                            FROM old
                            """,
                        "jvmlog_g1_regions"),

                // ---------------------------------------------------------------
                // Safepoint time-to-reach (TTR) statistics: syncMs analysis
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-safepoint-ttr-stats",
                        "jvmlog",
                        "GC Log: Safepoint Time-to-Reach Statistics",
                        null,
                        """
                            CREATE VIEW "jvmlog-safepoint-ttr-stats" AS
                            SELECT operation AS "Operation",
                                   count(*)                                          AS "Events",
                                   round(sum(syncMs), 1)                             AS "Total TTR (ms)",
                                   round(avg(syncMs), 2)                             AS "Avg TTR (ms)",
                                   round(approx_quantile(syncMs, 0.99), 2)           AS "P99 TTR (ms)",
                                   round(max(syncMs), 2)                             AS "Max TTR (ms)",
                                   round(sum(totalMs), 1)                            AS "Total STW (ms)",
                                   round(avg(syncMs) / NULLIF(avg(totalMs), 0) * 100, 1) AS "Avg TTR % of STW"
                            FROM jvmlog_safepoint
                            WHERE syncMs IS NOT NULL
                            GROUP BY operation
                            ORDER BY "Total TTR (ms)" DESC
                            """,
                        "jvmlog_safepoint")
                    .description("Time-to-reach (TTR) safepoint statistics per operation — high TTR % of STW indicates threads are slow to reach the safepoint, pointing to long JNI calls, loops without safepoint polls, or JIT-compiled code without polls."),

                // ---------------------------------------------------------------
                // G1 survivor region trend
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-g1-survivor-trend",
                        "jvmlog",
                        "GC Log: G1 Survivor Region Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-g1-survivor-trend" AS
                            WITH surv AS (
                                SELECT r.gcId,
                                       e.uptimeSecs,
                                       r.survivorAfter,
                                       r.survivorMax
                                FROM jvmlog_g1_regions r
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE r.survivorAfter IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT count(*)                                               AS "Cycles",
                                   round(min(survivorAfter), 0)                          AS "Min Survivor Regions",
                                   round(max(survivorAfter), 0)                          AS "Max Survivor Regions",
                                   round(avg(survivorAfter), 1)                          AS "Avg Survivor Regions",
                                   round(max(survivorMax), 0)                            AS "Survivor Max (regions)",
                                   round(regr_slope(survivorAfter, uptimeSecs), 4)       AS "Trend (regions/s)",
                                   round(regr_r2(survivorAfter, uptimeSecs), 4)          AS "R²",
                                   CASE
                                     WHEN max(survivorAfter) >= max(survivorMax) * 0.9
                                     THEN 'Survivor space at capacity — objects promoting early to Old'
                                     WHEN regr_r2(survivorAfter, uptimeSecs) > 0.6
                                          AND regr_slope(survivorAfter, uptimeSecs) > 0
                                     THEN 'Growing — increasing survivor pressure'
                                     ELSE 'Normal'
                                   END                                                   AS "Assessment"
                            FROM surv
                            """,
                        "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("G1 survivor region stats and trend — survivor space at capacity causes premature promotion to Old gen, accelerating Old gen growth.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-g1-survivor-trend" AS
                            WITH surv AS (
                                SELECT gcId * 1.0 AS uptimeSecs,
                                       survivorAfter,
                                       survivorMax
                                FROM jvmlog_g1_regions
                                WHERE survivorAfter IS NOT NULL
                            )
                            SELECT count(*)                                               AS "Cycles",
                                   round(min(survivorAfter), 0)                          AS "Min Survivor Regions",
                                   round(max(survivorAfter), 0)                          AS "Max Survivor Regions",
                                   round(avg(survivorAfter), 1)                          AS "Avg Survivor Regions",
                                   round(max(survivorMax), 0)                            AS "Survivor Max (regions)",
                                   round(regr_slope(survivorAfter, uptimeSecs), 4)       AS "Trend (regions/s)",
                                   round(regr_r2(survivorAfter, uptimeSecs), 4)          AS "R²",
                                   CASE
                                     WHEN max(survivorAfter) >= max(survivorMax) * 0.9
                                     THEN 'Survivor space at capacity — objects promoting early to Old'
                                     WHEN regr_r2(survivorAfter, uptimeSecs) > 0.6
                                          AND regr_slope(survivorAfter, uptimeSecs) > 0
                                     THEN 'Growing — increasing survivor pressure'
                                     ELSE 'Normal'
                                   END                                                   AS "Assessment"
                            FROM surv
                            """,
                        "jvmlog_g1_regions"),

                // ---------------------------------------------------------------
                // ZGC phase breakdown by type (concurrent vs STW, mark vs relocation)
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-zgc-phase-breakdown",
                        "jvmlog",
                        "GC Log: ZGC Phase Type Breakdown",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-phase-breakdown" AS
                            WITH phases AS (
                                SELECT phaseName,
                                       CASE
                                         WHEN lower(phaseName) LIKE '%pause%' THEN 'STW'
                                         ELSE 'Concurrent'
                                       END AS phaseType,
                                       CASE
                                         WHEN lower(phaseName) LIKE '%mark%'    THEN 'Mark'
                                         WHEN lower(phaseName) LIKE '%relocat%' THEN 'Relocate'
                                         WHEN lower(phaseName) LIKE '%refer%'   THEN 'Reference Processing'
                                         WHEN lower(phaseName) LIKE '%weak%'    THEN 'Weak Processing'
                                         ELSE 'Other'
                                       END AS category,
                                       durationMs
                                FROM jvmlog_zgc_phases
                                WHERE durationMs IS NOT NULL
                            )
                            SELECT phaseName AS "Phase",
                                   phaseType  AS "Type",
                                   category   AS "Category",
                                   count(*)   AS "Executions",
                                   round(sum(durationMs), 1)                   AS "Total (ms)",
                                   round(avg(durationMs), 2)                   AS "Avg (ms)",
                                   round(approx_quantile(durationMs, 0.99), 2) AS "P99 (ms)",
                                   round(max(durationMs), 2)                   AS "Max (ms)"
                            FROM phases
                            GROUP BY phaseName, phaseType, category
                            ORDER BY phaseType, "Total (ms)" DESC
                            """,
                        "jvmlog_zgc_phases")
                    .description("ZGC phase breakdown by STW vs concurrent and by work category (mark/relocate/reference) — shows which phase categories dominate cycle time."),

                // ---------------------------------------------------------------
                // GC pause variance per cause: high stddev = unpredictable latency
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-pause-variance",
                        "jvmlog",
                        "GC Log: Pause Time Variance by Cause",
                        null,
                        """
                            CREATE VIEW "jvmlog-pause-variance" AS
                            SELECT cause AS "Cause",
                                   count(*)                                           AS "Events",
                                   round(avg(pauseMs), 2)                             AS "Avg (ms)",
                                   round(stddev_pop(pauseMs), 2)                      AS "StdDev (ms)",
                                   round(approx_quantile(pauseMs, 0.99), 2)           AS "P99 (ms)",
                                   round(max(pauseMs), 2)                             AS "Max (ms)",
                                   round(stddev_pop(pauseMs) / NULLIF(avg(pauseMs), 0) * 100, 1) AS "CV %",
                                   CASE
                                     WHEN stddev_pop(pauseMs) / NULLIF(avg(pauseMs), 0) > 1.0
                                     THEN 'High variance — very unpredictable pause times'
                                     WHEN stddev_pop(pauseMs) / NULLIF(avg(pauseMs), 0) > 0.5
                                     THEN 'Moderate variance — some latency unpredictability'
                                     ELSE 'Low variance — consistent pause times'
                                   END                                                AS "Assessment"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY cause
                            ORDER BY "CV %" DESC NULLS LAST
                            """,
                        "jvmlog_gc_event")
                    .description("Coefficient of variation (StdDev/Mean) for pause times per GC cause — high CV indicates unpredictable latency spikes even if average is low."),

                // ---------------------------------------------------------------
                // GC cause first occurrence timeline: when did each cause first appear?
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-cause-first-occurrence",
                        "jvmlog",
                        "GC Log: GC Cause First Occurrence",
                        null,
                        """
                            CREATE VIEW "jvmlog-cause-first-occurrence" AS
                            SELECT cause AS "Cause",
                                   round(min(uptimeSecs), 3)    AS "First Occurrence (s)",
                                   round(max(uptimeSecs), 3)    AS "Last Occurrence (s)",
                                   count(*)                     AS "Total Events",
                                   round(min(pauseMs), 2)       AS "Min Pause (ms)",
                                   round(max(pauseMs), 2)       AS "Max Pause (ms)"
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL
                            GROUP BY cause
                            ORDER BY "First Occurrence (s)"
                            """,
                        "jvmlog_gc_event")
                    .description("When each GC cause first appeared during the JVM run — late-appearing causes (e.g., Metadata GCThreshold, Heap Dump Initiated) indicate evolving class loading or triggered operations."),

                // ---------------------------------------------------------------
                // Young vs Old generation GC time split
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-young-vs-old-time",
                        "jvmlog",
                        "GC Log: Young vs Old Generation GC Time",
                        null,
                        """
                            CREATE VIEW "jvmlog-young-vs-old-time" AS
                            WITH classified AS (
                                SELECT CASE
                                         WHEN lower(gcType) LIKE '%young%'
                                              OR lower(gcType) LIKE '%minor%'
                                              OR lower(cause)  LIKE '%allocation%'
                                              AND lower(gcType) NOT LIKE '%full%'
                                              AND lower(gcType) NOT LIKE '%mixed%'
                                         THEN 'Young GC'
                                         WHEN lower(gcType) LIKE '%full%'
                                              OR lower(gcType) LIKE '%major%'
                                              OR lower(cause)  IN ('System.gc()', 'Heap Inspection Initiated GC',
                                                                    'Heap Dump Initiated GC')
                                         THEN 'Full / Major GC'
                                         WHEN lower(gcType) LIKE '%mixed%'
                                         THEN 'Mixed GC'
                                         WHEN lower(gcType) LIKE '%concurrent%'
                                         THEN 'Concurrent STW'
                                         ELSE 'Other'
                                       END AS generationType,
                                       pauseMs
                                FROM jvmlog_gc_event
                                WHERE pauseMs IS NOT NULL
                            )
                            SELECT generationType AS "Generation Type",
                                   count(*)                               AS "Events",
                                   round(sum(pauseMs), 1)                 AS "Total Pause (ms)",
                                   round(avg(pauseMs), 2)                 AS "Avg Pause (ms)",
                                   round(max(pauseMs), 2)                 AS "Max Pause (ms)",
                                   round(100.0 * sum(pauseMs) / sum(sum(pauseMs)) OVER (), 1) AS "% of Total Pause"
                            FROM classified
                            GROUP BY generationType
                            ORDER BY "Total Pause (ms)" DESC
                            """,
                        "jvmlog_gc_event")
                    .description("Stop-the-world time split between Young GC, Mixed GC, Full GC, and concurrent STW phases — shows which generation is responsible for the most pause time."),

                // ---------------------------------------------------------------
                // Heap fill level at GC trigger: how full is the heap when GC fires?
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-heap-fill-at-trigger",
                        "jvmlog",
                        "GC Log: Heap Fill Level at GC Trigger",
                        null,
                        """
                            CREATE VIEW "jvmlog-heap-fill-at-trigger" AS
                            SELECT e.cause AS "Cause",
                                   count(*)                                                                   AS "Events",
                                   round(avg(h.heapBefore / 1048576.0), 1)                                   AS "Avg Heap Before (MB)",
                                   round(avg(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0)), 1)    AS "Avg Fill % Before",
                                   round(max(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0)), 1)    AS "Max Fill % Before",
                                   round(avg(100.0 * h.heapAfter  / NULLIF(h.heapCommittedAfter, 0)), 1)     AS "Avg Fill % After",
                                   CASE
                                     WHEN avg(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0)) > 90
                                     THEN 'Near full — GC triggered very late, high OOM risk'
                                     WHEN avg(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0)) > 70
                                     THEN 'High fill — limited headroom between GC cycles'
                                     ELSE 'Normal'
                                   END                                                                       AS "Assessment"
                            FROM jvmlog_gc_event e
                            JOIN jvmlog_heap_snapshot h USING (gcId)
                            WHERE h.heapBefore IS NOT NULL
                              AND h.heapCommittedBefore IS NOT NULL
                            GROUP BY e.cause
                            ORDER BY "Avg Fill % Before" DESC NULLS LAST
                            """,
                        "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Average heap fill level when each GC cause fires — near-full triggers (> 90%) indicate the GC is barely keeping up and a pause spike or OOM is likely."),

                // ---------------------------------------------------------------
                // Allocation stall rate timeline: stalls per 30s window
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-alloc-stall-rate-timeline",
                        "jvmlog",
                        "GC Log: Allocation Stall Rate Timeline",
                        null,
                        """
                            CREATE VIEW "jvmlog-alloc-stall-rate-timeline" AS
                            WITH stalls AS (
                                SELECT a.stallMs,
                                       coalesce(e.uptimeSecs, a.gcId * 1.0) AS uptimeSecs
                                FROM jvmlog_alloc_stall a
                                LEFT JOIN jvmlog_gc_event e USING (gcId)
                            )
                            SELECT floor(uptimeSecs / 30.0) * 30       AS "Window Start (s)",
                                   count(*)                             AS "Stalls",
                                   round(sum(stallMs), 1)              AS "Total Stall (ms)",
                                   round(avg(stallMs), 2)              AS "Avg Stall (ms)",
                                   round(max(stallMs), 2)              AS "Max Stall (ms)"
                            FROM stalls
                            WHERE uptimeSecs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 30.0) * 30
                            ORDER BY 1
                            """,
                        "jvmlog_alloc_stall")
                    .description("Allocation stall count and duration per 30-second window — stall bursts show when application threads were most affected by GC throughput failures."),

                // ---------------------------------------------------------------
                // Phase count per GC: how many phases execute per GC cycle?
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-phases-per-gc",
                        "jvmlog",
                        "GC Log: Phase Count per GC Cycle",
                        null,
                        """
                            CREATE VIEW "jvmlog-phases-per-gc" AS
                            WITH phase_counts AS (
                                SELECT gcId,
                                       count(*)         AS phaseCount,
                                       sum(durationMs)  AS totalPhaseDurationMs
                                FROM jvmlog_gc_phase
                                WHERE durationMs IS NOT NULL
                                GROUP BY gcId
                            )
                            SELECT count(*)                                                 AS "GC Cycles",
                                   round(min(phaseCount), 0)                               AS "Min Phases/GC",
                                   round(avg(phaseCount), 1)                               AS "Avg Phases/GC",
                                   round(max(phaseCount), 0)                               AS "Max Phases/GC",
                                   round(min(totalPhaseDurationMs), 2)                     AS "Min Phase Time/GC (ms)",
                                   round(avg(totalPhaseDurationMs), 2)                     AS "Avg Phase Time/GC (ms)",
                                   round(max(totalPhaseDurationMs), 2)                     AS "Max Phase Time/GC (ms)"
                            FROM phase_counts
                            """,
                        "jvmlog_gc_phase")
                    .description("Phase count and total phase time per GC cycle — GC cycles with unusually few phases (< average) may have been aborted; cycles with more phases indicate deeper work phases activated."),

                // ---------------------------------------------------------------
                // ZGC garbage ratio per cycle: live vs garbage from zgc_stats
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-zgc-garbage-ratio",
                        "jvmlog",
                        "GC Log: ZGC Garbage Ratio per Cycle",
                        null,
                        """
                            CREATE VIEW "jvmlog-zgc-garbage-ratio" AS
                            WITH rs AS (
                                SELECT gcId,
                                       max(CASE WHEN phase = 'Relocate Start' THEN liveBytes END)    AS liveBytes,
                                       max(CASE WHEN phase = 'Relocate Start' THEN garbageBytes END) AS garbageBytes,
                                       max(CASE WHEN phase = 'Mark Start'     THEN usedBytes END)    AS usedAtMarkStart,
                                       max(CASE WHEN phase = 'Relocate End'   THEN usedBytes END)    AS usedAtRelocEnd
                                FROM jvmlog_zgc_stats
                                GROUP BY gcId
                                HAVING max(CASE WHEN phase = 'Relocate Start' THEN liveBytes END) IS NOT NULL
                            )
                            SELECT count(*)                                                                 AS "Cycles",
                                   round(avg(liveBytes / 1048576.0), 1)                                    AS "Avg Live (MB)",
                                   round(avg(garbageBytes / 1048576.0), 1)                                 AS "Avg Garbage (MB)",
                                   round(avg(100.0 * garbageBytes / NULLIF(liveBytes + garbageBytes, 0)), 1) AS "Avg Garbage %",
                                   round(max(100.0 * garbageBytes / NULLIF(liveBytes + garbageBytes, 0)), 1) AS "Max Garbage %",
                                   round(min(100.0 * garbageBytes / NULLIF(liveBytes + garbageBytes, 0)), 1) AS "Min Garbage %",
                                   round(avg((usedAtMarkStart - usedAtRelocEnd) / 1048576.0), 1)            AS "Avg Reclaimed (MB)"
                            FROM rs
                            """,
                        "jvmlog_zgc_stats")
                    .description("ZGC live-vs-garbage ratio at Relocate Start — high average garbage % (> 60%) means effective GC; low garbage % means mostly live objects and GC is doing expensive work for little reclaim."),

                // ---------------------------------------------------------------
                // Shenandoah headroom trend: free headroom declining = degradation risk
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-shenandoah-headroom",
                        "jvmlog",
                        "GC Log: Shenandoah Free Headroom Analysis",
                        null,
                        """
                            CREATE VIEW "jvmlog-shenandoah-headroom" AS
                            WITH hdr AS (
                                SELECT s.gcId,
                                       e.uptimeSecs,
                                       s.freeBytes     / 1048576.0 AS freeMB,
                                       s.headroomBytes / 1048576.0 AS headroomMB,
                                       s.freeRegions
                                FROM jvmlog_shenandoah_free s
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE s.headroomBytes IS NOT NULL
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT count(*)                                                    AS "Cycles",
                                   round(min(headroomMB), 2)                                  AS "Min Headroom (MB)",
                                   round(avg(headroomMB), 2)                                  AS "Avg Headroom (MB)",
                                   round(max(headroomMB), 2)                                  AS "Max Headroom (MB)",
                                   round(regr_slope(headroomMB, uptimeSecs), 4)               AS "Headroom Trend (MB/s)",
                                   round(regr_r2(headroomMB, uptimeSecs), 4)                  AS "R²",
                                   CASE
                                     WHEN min(headroomMB) < 10
                                     THEN 'Critical — headroom near zero, Degenerated GC risk'
                                     WHEN regr_r2(headroomMB, uptimeSecs) > 0.5
                                          AND regr_slope(headroomMB, uptimeSecs) < 0
                                     THEN 'Declining — headroom shrinking, watch for degraded GC'
                                     ELSE 'OK'
                                   END                                                        AS "Assessment"
                            FROM hdr
                            """,
                        "jvmlog_shenandoah_free", "jvmlog_gc_event")
                    .description("Shenandoah free headroom trend — declining headroom with high R² indicates Shenandoah will soon exhaust its concurrency margin and trigger Degenerated GC.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-shenandoah-headroom" AS
                            WITH hdr AS (
                                SELECT gcId * 1.0          AS uptimeSecs,
                                       freeBytes    / 1048576.0 AS freeMB,
                                       headroomBytes / 1048576.0 AS headroomMB,
                                       freeRegions
                                FROM jvmlog_shenandoah_free
                                WHERE headroomBytes IS NOT NULL
                            )
                            SELECT count(*)                                                    AS "Cycles",
                                   round(min(headroomMB), 2)                                  AS "Min Headroom (MB)",
                                   round(avg(headroomMB), 2)                                  AS "Avg Headroom (MB)",
                                   round(max(headroomMB), 2)                                  AS "Max Headroom (MB)",
                                   round(regr_slope(headroomMB, uptimeSecs), 4)               AS "Headroom Trend (MB/s)",
                                   round(regr_r2(headroomMB, uptimeSecs), 4)                  AS "R²",
                                   CASE
                                     WHEN min(headroomMB) < 10
                                     THEN 'Critical — headroom near zero, Degenerated GC risk'
                                     WHEN regr_r2(headroomMB, uptimeSecs) > 0.5
                                          AND regr_slope(headroomMB, uptimeSecs) < 0
                                     THEN 'Declining — headroom shrinking, watch for degraded GC'
                                     ELSE 'OK'
                                   END                                                        AS "Assessment"
                            FROM hdr
                            """,
                        "jvmlog_shenandoah_free"),

                // ---------------------------------------------------------------
                // GC worker efficiency trend: are workers decreasing over time?
                // ---------------------------------------------------------------
                new View(
                        "jvmlog-gc-worker-efficiency-trend",
                        "jvmlog",
                        "GC Log: GC Worker Efficiency Trend",
                        null,
                        """
                            CREATE VIEW "jvmlog-gc-worker-efficiency-trend" AS
                            WITH wt AS (
                                SELECT w.gcId,
                                       w.taskName,
                                       w.workersUsed,
                                       w.workersMax,
                                       100.0 * w.workersUsed / NULLIF(w.workersMax, 0) AS utilPct,
                                       e.uptimeSecs
                                FROM jvmlog_gc_workers w
                                JOIN jvmlog_gc_event e USING (gcId)
                                WHERE w.workersMax > 0
                                  AND e.uptimeSecs IS NOT NULL
                            )
                            SELECT taskName AS "Task",
                                   count(*)                                              AS "Events",
                                   round(avg(workersUsed), 1)                           AS "Avg Workers Used",
                                   round(min(workersUsed), 0)                           AS "Min Workers Used",
                                   round(max(workersMax), 0)                            AS "Max Workers",
                                   round(avg(utilPct), 1)                               AS "Avg Utilisation %",
                                   round(regr_slope(utilPct, uptimeSecs), 6)            AS "Util Trend (%/s)",
                                   round(regr_r2(utilPct, uptimeSecs), 4)               AS "R²",
                                   CASE
                                     WHEN regr_r2(utilPct, uptimeSecs) > 0.5
                                          AND regr_slope(utilPct, uptimeSecs) < 0
                                     THEN 'Declining — adaptive parallelism reducing workers over time'
                                     WHEN avg(utilPct) < 80
                                     THEN 'Under-utilised — GC not using all available worker threads'
                                     ELSE 'Stable'
                                   END                                                  AS "Assessment"
                            FROM wt
                            GROUP BY taskName
                            ORDER BY "Avg Utilisation %" ASC
                            """,
                        "jvmlog_gc_workers", "jvmlog_gc_event")
                    .description("GC worker thread utilization trend per task — declining utilization over time indicates adaptive parallelism is reducing thread counts, possibly due to low GC pressure.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-gc-worker-efficiency-trend" AS
                            WITH wt AS (
                                SELECT gcId * 1.0 AS uptimeSecs,
                                       taskName,
                                       workersUsed,
                                       workersMax,
                                       100.0 * workersUsed / NULLIF(workersMax, 0) AS utilPct
                                FROM jvmlog_gc_workers
                                WHERE workersMax > 0
                            )
                            SELECT taskName AS "Task",
                                   count(*)                                              AS "Events",
                                   round(avg(workersUsed), 1)                           AS "Avg Workers Used",
                                   round(min(workersUsed), 0)                           AS "Min Workers Used",
                                   round(max(workersMax), 0)                            AS "Max Workers",
                                   round(avg(utilPct), 1)                               AS "Avg Utilisation %",
                                   round(regr_slope(utilPct, uptimeSecs), 6)            AS "Util Trend (%/s)",
                                   round(regr_r2(utilPct, uptimeSecs), 4)               AS "R²",
                                   CASE
                                     WHEN regr_r2(utilPct, uptimeSecs) > 0.5
                                          AND regr_slope(utilPct, uptimeSecs) < 0
                                     THEN 'Declining — adaptive parallelism reducing workers over time'
                                     WHEN avg(utilPct) < 80
                                     THEN 'Under-utilised — GC not using all available worker threads'
                                     ELSE 'Stable'
                                   END                                                  AS "Assessment"
                            FROM wt
                            GROUP BY taskName
                            ORDER BY "Avg Utilisation %" ASC
                            """,
                        "jvmlog_gc_workers"),

            // -----------------------------------------------------------------------
            // Evacuation Failure Detail (G1 to-space exhaustion analysis)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-evacuation-failure-detail", "jvmlog",
                    "GC Log: G1 Evacuation Failure Detail", null,
                    """
                        CREATE VIEW "jvmlog-evacuation-failure-detail" AS
                        WITH failures AS (
                            SELECT err.gcId,
                                   err.errorType,
                                   err.durationMs  AS failDurationMs,
                                   e.gcType,
                                   e.gcCause,
                                   e.heapBefore,
                                   e.heapAfter,
                                   e.heapMax,
                                   e.pauseMs,
                                   e.uptimeSecs,
                                   100.0 * e.heapBefore / NULLIF(e.heapMax, 0) AS heapFillPct
                            FROM jvmlog_gc_errors err
                            JOIN jvmlog_gc_event  e USING (gcId)
                            WHERE err.errorType IN ('To-space exhausted', 'Evacuation Failure',
                                                    'Humongous Allocation Failed')
                        )
                        SELECT gcId                                          AS "GC ID",
                               errorType                                     AS "Error Type",
                               gcType                                        AS "GC Type",
                               gcCause                                       AS "Cause",
                               round(uptimeSecs, 3)                         AS "Uptime (s)",
                               heapBefore                                   AS "Heap Before",
                               heapAfter                                    AS "Heap After",
                               heapMax                                      AS "Heap Max",
                               round(heapFillPct, 1)                        AS "Heap Fill %",
                               round(pauseMs, 2)                            AS "Pause (ms)",
                               round(failDurationMs, 2)                     AS "Fail Duration (ms)"
                        FROM failures
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_gc_errors", "jvmlog_gc_event")
                    .description("G1 evacuation failure and to-space exhaustion events joined with GC event context — shows heap fill level and pause overhead at each failure point.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-evacuation-failure-detail" AS
                            SELECT gcId                                      AS "GC ID",
                                   errorType                                 AS "Error Type",
                                   durationMs                               AS "Fail Duration (ms)"
                            FROM jvmlog_gc_errors
                            WHERE errorType IN ('To-space exhausted', 'Evacuation Failure',
                                                'Humongous Allocation Failed')
                            ORDER BY gcId
                            """,
                        "jvmlog_gc_errors"),

            // -----------------------------------------------------------------------
            // GC Log Time Range (coverage statistics)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-log-time-range", "jvmlog",
                    "GC Log: Log Coverage Statistics", null,
                    """
                        CREATE VIEW "jvmlog-log-time-range" AS
                        SELECT count(*)                                              AS "Total GC Events",
                               round(min(uptimeSecs), 3)                            AS "First GC (s)",
                               round(max(uptimeSecs), 3)                            AS "Last GC (s)",
                               round(max(uptimeSecs) - min(uptimeSecs), 3)          AS "Log Duration (s)",
                               round((max(uptimeSecs) - min(uptimeSecs)) / 60.0, 2) AS "Log Duration (min)",
                               round(count(*) / NULLIF(max(uptimeSecs) - min(uptimeSecs), 0), 3)
                                                                                    AS "GC Rate (events/s)",
                               round(sum(pauseMs), 1)                               AS "Total Pause (ms)",
                               round(100.0 * sum(pauseMs) / NULLIF((max(uptimeSecs) - min(uptimeSecs)) * 1000.0, 0), 2)
                                                                                    AS "Overhead %",
                               min(gcType)                                          AS "First GC Type",
                               max(gcType)                                          AS "Last GC Type"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL
                        """,
                    "jvmlog_gc_event")
                    .description("Log file coverage summary — first/last GC timestamps, total log duration, overall GC rate and pause overhead for the entire captured period."),

            // -----------------------------------------------------------------------
            // Concurrent GC Efficiency (what % of work happens concurrently vs STW)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-concurrent-gc-efficiency", "jvmlog",
                    "GC Log: Concurrent vs STW Phase Time Split", null,
                    """
                        CREATE VIEW "jvmlog-concurrent-gc-efficiency" AS
                        WITH phase_classified AS (
                            SELECT gcId,
                                   phaseName,
                                   durationMs,
                                   CASE
                                     WHEN lower(phaseName) LIKE '%concurrent%'
                                       OR lower(phaseName) LIKE '%parallel mark%'
                                     THEN 'Concurrent'
                                     ELSE 'STW'
                                   END AS phaseClass
                            FROM jvmlog_gc_phase
                            WHERE durationMs IS NOT NULL
                        ),
                        totals AS (
                            SELECT phaseClass,
                                   count(*)               AS "Phase Count",
                                   round(sum(durationMs), 1)  AS "Total (ms)",
                                   round(avg(durationMs), 2)  AS "Avg (ms)",
                                   round(max(durationMs), 2)  AS "Max (ms)"
                            FROM phase_classified
                            GROUP BY phaseClass
                        ),
                        grand AS (
                            SELECT sum("Total (ms)") AS grandTotal FROM totals
                        )
                        SELECT t.phaseClass                                           AS "Phase Class",
                               t."Phase Count",
                               t."Total (ms)",
                               t."Avg (ms)",
                               t."Max (ms)",
                               round(100.0 * t."Total (ms)" / NULLIF(g.grandTotal, 0), 1)
                                                                                     AS "% of All Phase Time"
                        FROM totals t, grand g
                        ORDER BY t."Total (ms)" DESC
                        """,
                    "jvmlog_gc_phase")
                    .description("Concurrent vs STW phase time split — shows what fraction of total GC phase work happens concurrently (off the application thread) vs as stop-the-world pauses."),

            // -----------------------------------------------------------------------
            // Per-cause pause statistics (GCeasy "GC Causes" panel)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-cause-pause-stats", "jvmlog",
                    "GC Log: Pause Statistics per GC Cause", null,
                    """
                        CREATE VIEW "jvmlog-cause-pause-stats" AS
                        SELECT gcCause                                             AS "GC Cause",
                               count(*)                                            AS "Count",
                               round(sum(pauseMs), 1)                             AS "Total Pause (ms)",
                               round(avg(pauseMs), 2)                             AS "Avg Pause (ms)",
                               round(min(pauseMs), 2)                             AS "Min Pause (ms)",
                               round(max(pauseMs), 2)                             AS "Max Pause (ms)",
                               round(approx_quantile(pauseMs, 0.50), 2)          AS "p50 (ms)",
                               round(approx_quantile(pauseMs, 0.95), 2)          AS "p95 (ms)",
                               round(approx_quantile(pauseMs, 0.99), 2)          AS "p99 (ms)",
                               round(stddev_pop(pauseMs), 2)                     AS "StdDev (ms)",
                               round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS "% of GCs"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND gcCause IS NOT NULL
                        GROUP BY gcCause
                        ORDER BY "Total Pause (ms)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Full pause stats per GC cause: count, total/avg/min/max/p50/p95/p99 pause times and standard deviation — mirrors GCeasy's GC Causes detail panel."),

            // -----------------------------------------------------------------------
            // Per-minute pause bucket summary (GCViewer "Pause time per minute")
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-by-minute", "jvmlog",
                    "GC Log: Pause Summary per Minute", null,
                    """
                        CREATE VIEW "jvmlog-pause-by-minute" AS
                        SELECT floor(uptimeSecs / 60.0)::BIGINT               AS "Minute",
                               round(min(uptimeSecs), 1)                       AS "Window Start (s)",
                               count(*)                                         AS "GC Count",
                               round(sum(pauseMs), 1)                          AS "Total Pause (ms)",
                               round(avg(pauseMs), 2)                          AS "Avg Pause (ms)",
                               round(min(pauseMs), 2)                          AS "Min Pause (ms)",
                               round(max(pauseMs), 2)                          AS "Max Pause (ms)",
                               round(100.0 * sum(pauseMs) / 60000.0, 2)       AS "Overhead %"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        ORDER BY 1
                        """,
                    "jvmlog_gc_event")
                    .description("GC pause summary per 1-minute uptime window: count, total/avg/min/max pause and overhead % — equivalent to GCViewer's pause-per-minute histogram."),

            // -----------------------------------------------------------------------
            // Allocation rate trend (GCeasy "Object Creation Rate" analysis)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-allocation-rate-trend", "jvmlog",
                    "GC Log: Allocation Rate Trend", null,
                    """
                        CREATE VIEW "jvmlog-allocation-rate-trend" AS
                        WITH intervals AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   heapBefore,
                                   heapAfter,
                                   LAG(heapAfter) OVER (ORDER BY uptimeSecs) AS prevHeapAfter,
                                   LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS prevUptime
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND heapBefore IS NOT NULL
                        ),
                        rates AS (
                            SELECT uptimeSecs,
                                   (heapBefore - prevHeapAfter) / NULLIF(uptimeSecs - prevUptime, 0)
                                       AS allocBytesPerSec
                            FROM intervals
                            WHERE prevHeapAfter IS NOT NULL
                              AND uptimeSecs > prevUptime
                              AND heapBefore >= prevHeapAfter
                        )
                        SELECT count(*)                                               AS "Intervals",
                               round(avg(allocBytesPerSec) / 1048576.0, 2)           AS "Avg Alloc Rate (MB/s)",
                               round(min(allocBytesPerSec) / 1048576.0, 2)           AS "Min Alloc Rate (MB/s)",
                               round(max(allocBytesPerSec) / 1048576.0, 2)           AS "Max Alloc Rate (MB/s)",
                               round(approx_quantile(allocBytesPerSec, 0.50) / 1048576.0, 2)
                                                                                     AS "p50 Alloc Rate (MB/s)",
                               round(approx_quantile(allocBytesPerSec, 0.95) / 1048576.0, 2)
                                                                                     AS "p95 Alloc Rate (MB/s)",
                               round(regr_slope(allocBytesPerSec, uptimeSecs) / 1048576.0, 4)
                                                                                     AS "Rate Trend (MB/s²)",
                               round(regr_r2(allocBytesPerSec, uptimeSecs), 4)       AS "R²",
                               CASE
                                 WHEN regr_r2(allocBytesPerSec, uptimeSecs) > 0.5
                                      AND regr_slope(allocBytesPerSec, uptimeSecs) > 0
                                 THEN 'Growing — allocation pressure increasing over time'
                                 WHEN regr_r2(allocBytesPerSec, uptimeSecs) > 0.5
                                      AND regr_slope(allocBytesPerSec, uptimeSecs) < 0
                                 THEN 'Declining — allocation rate falling over time'
                                 ELSE 'Stable'
                               END                                                   AS "Trend Assessment"
                        FROM rates
                        """,
                    "jvmlog_gc_event")
                    .description("Allocation rate statistics and trend analysis derived from inter-GC heap growth — avg/min/max/p95 rates and a regression-based trend assessment (growing/stable/declining)."),

            // -----------------------------------------------------------------------
            // JVM GC configuration detail (extended from gc_init — all known columns)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-init-detail", "jvmlog",
                    "GC Log: JVM GC Configuration Detail", null,
                    """
                        CREATE VIEW "jvmlog-gc-init-detail" AS
                        SELECT max(algorithm)                                        AS "GC Algorithm",
                               max(jdkVersion)                                       AS "JDK Version",
                               round(max(minHeap) / 1048576.0, 0)                   AS "Min Heap (MB)",
                               round(max(initialHeap) / 1048576.0, 0)               AS "Initial Heap (MB)",
                               round(max(maxHeap) / 1048576.0, 0)                   AS "Max Heap (MB)",
                               round(max(softMaxCapacity) / 1048576.0, 0)           AS "Soft Max Heap (MB)",
                               max(parallelWorkers)                                  AS "Parallel Workers",
                               max(concurrentWorkers)                                AS "Concurrent Workers",
                               max(cpuTotal)                                         AS "Total CPUs",
                               round(max(physicalMemory) / 1073741824.0, 2)         AS "Physical Memory (GB)",
                               max(numaSupport)                                      AS "NUMA Support",
                               round(max(heapRegionSize) / 1048576.0, 0)            AS "Heap Region (MB)",
                               max(periodicGc)                                       AS "Periodic GC",
                               max(preTouch)                                         AS "Pre-Touch",
                               max(gcMode)                                           AS "Shenandoah Mode",
                               max(heuristics)                                       AS "Shenandoah Heuristics"
                        FROM jvmlog_gc_init
                        """,
                    "jvmlog_gc_init")
                    .description("Extended JVM GC configuration: all known init parameters including heap sizes, worker counts, hardware resources, and collector-specific settings."),

            // -----------------------------------------------------------------------
            // Full GC frequency and impact analysis (GCeasy "Full GC Duration" section)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-full-gc-frequency", "jvmlog",
                    "GC Log: Full GC Frequency and Impact", null,
                    """
                        CREATE VIEW "jvmlog-full-gc-frequency" AS
                        WITH full_gcs AS (
                            SELECT gcId, uptimeSecs, gcCause, pauseMs, heapBefore, heapAfter, heapMax,
                                   LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS prevUptime
                            FROM jvmlog_gc_event
                            WHERE gcType IN ('Full', 'Degenerated', 'GarbageFirst (Full)')
                              AND uptimeSecs IS NOT NULL
                        )
                        SELECT count(*)                                              AS "Full GC Count",
                               round(avg(pauseMs), 1)                               AS "Avg Pause (ms)",
                               round(max(pauseMs), 1)                               AS "Max Pause (ms)",
                               round(sum(pauseMs) / 1000.0, 2)                     AS "Total Pause (s)",
                               round(avg(uptimeSecs - prevUptime), 1)              AS "Avg Interval (s)",
                               round(min(uptimeSecs - prevUptime), 1)              AS "Min Interval (s)",
                               round(avg(100.0 * heapBefore / NULLIF(heapMax,0)), 1) AS "Avg Heap Fill % at Trigger",
                               round(avg(100.0 * (heapBefore - heapAfter) / NULLIF(heapBefore,0)), 1)
                                                                                    AS "Avg Reclaim %",
                               round(1.0 * count(*) /
                                   NULLIF((max(uptimeSecs) - min(uptimeSecs)) / 60.0, 0), 2)
                                                                                    AS "Rate (Full GCs/min)"
                        FROM full_gcs
                        """,
                    "jvmlog_gc_event")
                    .description("Full GC frequency and impact summary: count, pause times, interval between events, heap fill at trigger, reclaim efficiency, and rate per minute."),

            // -----------------------------------------------------------------------
            // GC activity per type per minute (GCeasy "GC Activity Chart" parity)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-type-per-minute", "jvmlog",
                    "GC Log: GC Type Activity per Minute", null,
                    """
                        CREATE VIEW "jvmlog-gc-type-per-minute" AS
                        SELECT floor(uptimeSecs / 60.0)::BIGINT               AS "Minute",
                               gcType                                           AS "GC Type",
                               count(*)                                         AS "Count",
                               round(sum(pauseMs), 1)                          AS "Total Pause (ms)",
                               round(avg(pauseMs), 2)                          AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)                          AS "Max Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL AND gcType IS NOT NULL
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT, gcType
                        ORDER BY 1, gcType
                        """,
                    "jvmlog_gc_event")
                    .description("GC type activity per 1-minute uptime window — see how Young, Mixed, Full, and Concurrent-STW counts shift over time, equivalent to GCeasy's GC Activity Chart."),

            // -----------------------------------------------------------------------
            // Memory reclaimed per GC (distribution of bytes freed)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-memory-reclaimed", "jvmlog",
                    "GC Log: Memory Reclaimed per GC", null,
                    """
                        CREATE VIEW "jvmlog-memory-reclaimed" AS
                        WITH reclaim AS (
                            SELECT gcId,
                                   gcType,
                                   gcCause,
                                   heapBefore - heapAfter                    AS reclaimedBytes,
                                   heapBefore,
                                   heapMax
                            FROM jvmlog_gc_event
                            WHERE heapBefore IS NOT NULL AND heapAfter IS NOT NULL
                              AND heapBefore >= heapAfter
                        )
                        SELECT gcType                                                AS "GC Type",
                               count(*)                                              AS "Events",
                               round(avg(reclaimedBytes) / 1048576.0, 1)            AS "Avg Reclaimed (MB)",
                               round(min(reclaimedBytes) / 1048576.0, 1)            AS "Min Reclaimed (MB)",
                               round(max(reclaimedBytes) / 1048576.0, 1)            AS "Max Reclaimed (MB)",
                               round(approx_quantile(reclaimedBytes, 0.50) / 1048576.0, 1)
                                                                                    AS "p50 (MB)",
                               round(approx_quantile(reclaimedBytes, 0.95) / 1048576.0, 1)
                                                                                    AS "p95 (MB)",
                               round(sum(reclaimedBytes) / 1073741824.0, 2)         AS "Total Reclaimed (GB)",
                               round(avg(100.0 * reclaimedBytes / NULLIF(heapBefore, 0)), 1)
                                                                                    AS "Avg Reclaim %"
                        FROM reclaim
                        GROUP BY gcType
                        ORDER BY "Total Reclaimed (GB)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Memory reclaimed per GC type: avg/min/max/p50/p95 bytes freed and total reclaim over the log — shows which GC types do the most reclamation work."),

            // -----------------------------------------------------------------------
            // GC pause outliers (statistical outliers by Z-score)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-outliers", "jvmlog",
                    "GC Log: GC Pause Outliers", null,
                    """
                        CREATE VIEW "jvmlog-pause-outliers" AS
                        WITH stats AS (
                            SELECT avg(pauseMs) AS meanMs, stddev_pop(pauseMs) AS stdMs
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                        ),
                        scored AS (
                            SELECT e.gcId,
                                   e.gcType,
                                   e.gcCause,
                                   e.pauseMs,
                                   e.uptimeSecs,
                                   e.heapBefore,
                                   e.heapAfter,
                                   e.heapMax,
                                   (e.pauseMs - s.meanMs) / NULLIF(s.stdMs, 0) AS zScore
                            FROM jvmlog_gc_event e, stats s
                            WHERE e.pauseMs IS NOT NULL
                        )
                        SELECT gcId                                              AS "GC ID",
                               gcType                                            AS "GC Type",
                               gcCause                                           AS "Cause",
                               round(uptimeSecs, 3)                             AS "Uptime (s)",
                               round(pauseMs, 2)                                AS "Pause (ms)",
                               round(zScore, 2)                                 AS "Z-Score",
                               heapBefore                                       AS "Heap Before",
                               heapAfter                                        AS "Heap After",
                               heapMax                                          AS "Heap Max"
                        FROM scored
                        WHERE abs(zScore) > 2.0
                        ORDER BY zScore DESC
                        """,
                    "jvmlog_gc_event")
                    .description("GC pauses that are statistical outliers (|Z-score| > 2.0 from mean) — these abnormally long or short GCs warrant investigation for heap pressure, JIT de-opt, or safepoint delays."),

            // -----------------------------------------------------------------------
            // Heap-after trend (GCViewer "Tenured generation fill" equivalent)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-after-trend", "jvmlog",
                    "GC Log: Post-GC Heap Level Trend", null,
                    """
                        CREATE VIEW "jvmlog-heap-after-trend" AS
                        WITH base AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   heapAfter,
                                   heapMax,
                                   100.0 * heapAfter / NULLIF(heapMax, 0) AS heapAfterPct,
                                   gcType
                            FROM jvmlog_gc_event
                            WHERE heapAfter IS NOT NULL AND uptimeSecs IS NOT NULL
                        )
                        SELECT count(*)                                               AS "GC Events",
                               round(avg(heapAfterPct), 1)                           AS "Avg Post-GC Heap %",
                               round(min(heapAfterPct), 1)                           AS "Min Post-GC Heap %",
                               round(max(heapAfterPct), 1)                           AS "Max Post-GC Heap %",
                               round(regr_slope(heapAfterPct, uptimeSecs), 6)        AS "Trend (%/s)",
                               round(regr_r2(heapAfterPct, uptimeSecs), 4)           AS "R²",
                               CASE
                                 WHEN regr_r2(heapAfterPct, uptimeSecs) > 0.5
                                      AND regr_slope(heapAfterPct, uptimeSecs) > 0
                                 THEN 'Rising — live data set growing (potential memory leak)'
                                 WHEN regr_r2(heapAfterPct, uptimeSecs) > 0.5
                                      AND regr_slope(heapAfterPct, uptimeSecs) < 0
                                 THEN 'Falling — live data set shrinking (warm-up or load reduction)'
                                 ELSE 'Stable'
                               END                                                   AS "Assessment"
                        FROM base
                        """,
                    "jvmlog_gc_event")
                    .description("Post-GC heap level trend over time — rising post-GC heap % is the primary indicator of live data set growth and potential memory leaks, mirroring GCViewer's tenured fill chart."),

            // -----------------------------------------------------------------------
            // Inter-GC allocation timeline (allocation pressure per window)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-alloc-pressure-timeline", "jvmlog",
                    "GC Log: Allocation Pressure Timeline", null,
                    """
                        CREATE VIEW "jvmlog-alloc-pressure-timeline" AS
                        WITH intervals AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   heapBefore,
                                   LAG(heapAfter)   OVER (ORDER BY uptimeSecs) AS prevAfter,
                                   LAG(uptimeSecs)  OVER (ORDER BY uptimeSecs) AS prevUptime
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND heapBefore IS NOT NULL
                        )
                        SELECT gcId                                                      AS "GC ID",
                               round(uptimeSecs, 3)                                     AS "Uptime (s)",
                               round((heapBefore - prevAfter) / 1048576.0, 1)           AS "Allocated Since Last GC (MB)",
                               round((uptimeSecs - prevUptime), 3)                      AS "Interval (s)",
                               round((heapBefore - prevAfter) /
                                     NULLIF((uptimeSecs - prevUptime) * 1048576.0, 0), 2)
                                                                                        AS "Alloc Rate (MB/s)"
                        FROM intervals
                        WHERE prevAfter IS NOT NULL AND uptimeSecs > prevUptime
                          AND heapBefore >= prevAfter
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_gc_event")
                    .description("Per-GC allocation pressure: bytes allocated since the previous GC, interval length, and instantaneous allocation rate — useful for identifying allocation spikes."),

            // -----------------------------------------------------------------------
            // SLA breaches per GC cause (GCViewer "pause above SLA per cause")
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-sla-breach-by-cause", "jvmlog",
                    "GC Log: SLA Breach Rate per GC Cause", null,
                    """
                        CREATE VIEW "jvmlog-sla-breach-by-cause" AS
                        SELECT gcCause                                             AS "GC Cause",
                               count(*)                                            AS "Total GCs",
                               count(*) FILTER (WHERE pauseMs > 200)              AS "Breaches >200ms",
                               count(*) FILTER (WHERE pauseMs > 500)              AS "Breaches >500ms",
                               count(*) FILTER (WHERE pauseMs > 1000)             AS "Breaches >1s",
                               round(100.0 * count(*) FILTER (WHERE pauseMs > 200)
                                     / NULLIF(count(*), 0), 1)                    AS "Breach % (>200ms)",
                               round(max(pauseMs), 1)                             AS "Worst Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND gcCause IS NOT NULL
                        GROUP BY gcCause
                        ORDER BY "Breaches >200ms" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("SLA breach counts per GC cause at 200ms/500ms/1s thresholds — shows which causes are responsible for the most latency violations."),

            // -----------------------------------------------------------------------
            // Consecutive high-pause sequence detector
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-burst-windows", "jvmlog",
                    "GC Log: High-Pause Burst Windows", null,
                    """
                        CREATE VIEW "jvmlog-pause-burst-windows" AS
                        WITH flagged AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   gcType,
                                   gcCause,
                                   pauseMs,
                                   pauseMs > 200 AS isHigh
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        ),
                        grouped AS (
                            SELECT *,
                                   gcId - row_number() OVER (PARTITION BY isHigh ORDER BY gcId) AS grp
                            FROM flagged
                            WHERE isHigh
                        )
                        SELECT count(*)                                          AS "Consecutive High-Pause GCs",
                               round(min(uptimeSecs), 3)                        AS "Burst Start (s)",
                               round(max(uptimeSecs), 3)                        AS "Burst End (s)",
                               round(max(uptimeSecs) - min(uptimeSecs), 3)      AS "Burst Duration (s)",
                               round(sum(pauseMs), 1)                           AS "Total Pause (ms)",
                               round(max(pauseMs), 1)                           AS "Peak Pause (ms)",
                               string_agg(DISTINCT gcCause, ', ')               AS "Causes"
                        FROM grouped
                        GROUP BY grp
                        HAVING count(*) >= 2
                        ORDER BY "Total Pause (ms)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Consecutive sequences of GC pauses >200ms — bursts of back-to-back high pauses indicate sustained heap pressure or concurrent-mode failure conditions."),

            // -----------------------------------------------------------------------
            // GC health score trend over time (windowed — GCeasy temporal health)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-health-timeline", "jvmlog",
                    "GC Log: GC Health Score Over Time", null,
                    """
                        CREATE VIEW "jvmlog-health-timeline" AS
                        WITH windows AS (
                            SELECT floor(uptimeSecs / 60.0)::BIGINT AS minute,
                                   count(*)                           AS gcCount,
                                   avg(pauseMs)                       AS avgPause,
                                   max(pauseMs)                       AS maxPause,
                                   sum(pauseMs)                       AS totalPause,
                                   100.0 * sum(pauseMs) / 60000.0    AS overhead
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        )
                        SELECT minute                                              AS "Minute",
                               gcCount                                             AS "GC Count",
                               round(avgPause, 1)                                 AS "Avg Pause (ms)",
                               round(maxPause, 1)                                 AS "Max Pause (ms)",
                               round(overhead, 2)                                 AS "Overhead %",
                               CASE
                                 WHEN overhead > 20 OR maxPause > 1000 THEN 0
                                 WHEN overhead > 10 OR maxPause > 500  THEN 30
                                 WHEN overhead > 5  OR maxPause > 200  THEN 60
                                 WHEN overhead > 2  OR maxPause > 100  THEN 80
                                 ELSE 100
                               END                                                AS "Health Score"
                        FROM windows
                        ORDER BY minute
                        """,
                    "jvmlog_gc_event")
                    .description("GC health score per 1-minute window over the log — tracks how GC health evolves over time, surfacing degradation periods that a single aggregate score hides."),

            // -----------------------------------------------------------------------
            // Heap efficiency per GC type (MB reclaimed per ms pause)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-efficiency-by-type", "jvmlog",
                    "GC Log: Heap Efficiency per GC Type", null,
                    """
                        CREATE VIEW "jvmlog-heap-efficiency-by-type" AS
                        SELECT gcType                                              AS "GC Type",
                               count(*)                                            AS "Count",
                               round(avg((heapBefore - heapAfter) / 1048576.0), 1)
                                                                                  AS "Avg Reclaimed (MB)",
                               round(avg(pauseMs), 2)                             AS "Avg Pause (ms)",
                               round(sum(heapBefore - heapAfter) / 1048576.0
                                     / NULLIF(sum(pauseMs), 0), 4)                AS "MB/ms (Efficiency)",
                               round(sum(heapBefore - heapAfter) / 1073741824.0, 2)
                                                                                  AS "Total Reclaimed (GB)",
                               round(sum(pauseMs) / 1000.0, 2)                   AS "Total Pause (s)"
                        FROM jvmlog_gc_event
                        WHERE heapBefore IS NOT NULL AND heapAfter IS NOT NULL
                          AND heapBefore >= heapAfter AND pauseMs > 0 AND gcType IS NOT NULL
                        GROUP BY gcType
                        ORDER BY "MB/ms (Efficiency)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Heap reclamation efficiency per GC type: MB reclaimed per ms of pause — high efficiency means the GC type recovers a lot of memory quickly; Full GC typically scores lowest."),

            // -----------------------------------------------------------------------
            // GC pressure heatmap (cause × hour of uptime)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-cause-heatmap", "jvmlog",
                    "GC Log: GC Cause Activity Heatmap", null,
                    """
                        CREATE VIEW "jvmlog-gc-cause-heatmap" AS
                        SELECT floor(uptimeSecs / 300.0)::BIGINT           AS "5-Min Window",
                               round(min(uptimeSecs), 0)                   AS "Window Start (s)",
                               gcCause                                      AS "GC Cause",
                               count(*)                                     AS "Count",
                               round(sum(pauseMs), 1)                      AS "Total Pause (ms)",
                               round(max(pauseMs), 1)                      AS "Max Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE gcCause IS NOT NULL AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 300.0)::BIGINT, gcCause
                        ORDER BY 1, "Total Pause (ms)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("GC cause activity per 5-minute window — a cross-tabulation of time vs cause showing when specific causes dominate and how the cause mix evolves across the log."),

            // -----------------------------------------------------------------------
            // Inter-GC interval distribution (histogram of time between GCs)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-interval-distribution", "jvmlog",
                    "GC Log: Inter-GC Interval Distribution", null,
                    """
                        CREATE VIEW "jvmlog-interval-distribution" AS
                        WITH intervals AS (
                            SELECT uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS gapSecs
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL
                        ),
                        bucketed AS (
                            SELECT CASE
                                     WHEN gapSecs < 0.1  THEN '<0.1s'
                                     WHEN gapSecs < 0.5  THEN '0.1-0.5s'
                                     WHEN gapSecs < 1.0  THEN '0.5-1s'
                                     WHEN gapSecs < 2.0  THEN '1-2s'
                                     WHEN gapSecs < 5.0  THEN '2-5s'
                                     WHEN gapSecs < 10.0 THEN '5-10s'
                                     WHEN gapSecs < 30.0 THEN '10-30s'
                                     ELSE '30s+'
                                   END AS bucket,
                                   CASE
                                     WHEN gapSecs < 0.1  THEN 0
                                     WHEN gapSecs < 0.5  THEN 1
                                     WHEN gapSecs < 1.0  THEN 2
                                     WHEN gapSecs < 2.0  THEN 3
                                     WHEN gapSecs < 5.0  THEN 4
                                     WHEN gapSecs < 10.0 THEN 5
                                     WHEN gapSecs < 30.0 THEN 6
                                     ELSE 7
                                   END AS sortKey
                            FROM intervals
                            WHERE gapSecs IS NOT NULL
                        )
                        SELECT bucket                                              AS "Interval Bucket",
                               count(*)                                            AS "Count",
                               round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS "% of Intervals"
                        FROM bucketed
                        GROUP BY bucket, sortKey
                        ORDER BY sortKey
                        """,
                    "jvmlog_gc_event")
                    .description("Distribution of time between consecutive GC events — frequent very-short intervals (<0.1s) indicate high GC pressure; long intervals indicate the heap is under-pressure."),

            // -----------------------------------------------------------------------
            // Live data set estimate (post-GC heap floor)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-live-data-estimate", "jvmlog",
                    "GC Log: Live Data Set Estimate", null,
                    """
                        CREATE VIEW "jvmlog-live-data-estimate" AS
                        WITH post_gc AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   heapAfter,
                                   heapMax,
                                   100.0 * heapAfter / NULLIF(heapMax, 0) AS afterPct,
                                   gcType
                            FROM jvmlog_gc_event
                            WHERE heapAfter IS NOT NULL AND gcType NOT IN ('Concurrent', 'Pause Initial Mark')
                        ),
                        windows AS (
                            SELECT floor(uptimeSecs / 300.0)::BIGINT AS w,
                                   min(heapAfter)                     AS minAfter,
                                   avg(heapAfter)                     AS avgAfter,
                                   max(heapAfter)                     AS maxAfter
                            FROM post_gc
                            GROUP BY floor(uptimeSecs / 300.0)::BIGINT
                        )
                        SELECT count(*)                                               AS "GC Events",
                               round(min(heapAfter) / 1048576.0, 1)                  AS "Min Post-GC Heap (MB)",
                               round(avg(heapAfter) / 1048576.0, 1)                  AS "Avg Post-GC Heap (MB)",
                               round(approx_quantile(heapAfter, 0.10) / 1048576.0, 1)
                                                                                     AS "p10 Post-GC Heap (MB)",
                               round(approx_quantile(heapAfter, 0.25) / 1048576.0, 1)
                                                                                     AS "p25 Post-GC Heap (MB)",
                               round(max(heapMax) / 1048576.0, 1)                   AS "Max Heap (MB)",
                               round(min(heapAfter) * 100.0 / NULLIF(max(heapMax), 0), 1)
                                                                                     AS "Min Post-GC Heap %",
                               round(approx_quantile(heapAfter, 0.10) * 100.0 / NULLIF(max(heapMax), 0), 1)
                                                                                     AS "p10 Post-GC Heap %"
                        FROM post_gc
                        """,
                    "jvmlog_gc_event")
                    .description("Live data set estimate from post-GC heap levels — the minimum and p10 post-GC heap size approximates the live data set: data that cannot be reclaimed by any GC."),

            // -----------------------------------------------------------------------
            // Young GC frequency over time
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-young-gc-frequency", "jvmlog",
                    "GC Log: Young GC Frequency Over Time", null,
                    """
                        CREATE VIEW "jvmlog-young-gc-frequency" AS
                        WITH young AS (
                            SELECT floor(uptimeSecs / 60.0)::BIGINT AS minute,
                                   count(*)                           AS youngCount,
                                   round(sum(pauseMs), 1)             AS totalPauseMs,
                                   round(avg(pauseMs), 2)             AS avgPauseMs
                            FROM jvmlog_gc_event
                            WHERE gcType IN ('Young', 'GarbageFirst (young)', 'Pause Young')
                              AND uptimeSecs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        )
                        SELECT minute                                              AS "Minute",
                               youngCount                                          AS "Young GC Count",
                               totalPauseMs                                        AS "Total Pause (ms)",
                               avgPauseMs                                          AS "Avg Pause (ms)",
                               round(1.0 * youngCount / 60.0, 3)                  AS "Rate (GCs/s)"
                        FROM young
                        ORDER BY minute
                        """,
                    "jvmlog_gc_event")
                    .description("Young GC frequency per 1-minute window — rising Young GC rate indicates increasing allocation pressure; constant high rate suggests Young gen is undersized."),

            // -----------------------------------------------------------------------
            // Allocation surge detection (sudden spikes vs rolling baseline)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-allocation-surges", "jvmlog",
                    "GC Log: Allocation Rate Surges", null,
                    """
                        CREATE VIEW "jvmlog-allocation-surges" AS
                        WITH intervals AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   (heapBefore - LAG(heapAfter) OVER (ORDER BY uptimeSecs))
                                       / NULLIF(uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs), 0)
                                       AS allocBytesPerSec,
                                   LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS prevUptime
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND heapBefore IS NOT NULL
                        ),
                        stats AS (
                            SELECT avg(allocBytesPerSec)    AS mean,
                                   stddev_pop(allocBytesPerSec) AS std
                            FROM intervals
                            WHERE allocBytesPerSec > 0
                        )
                        SELECT i.gcId                                                AS "GC ID",
                               round(i.uptimeSecs, 3)                               AS "Uptime (s)",
                               round(i.allocBytesPerSec / 1048576.0, 1)             AS "Alloc Rate (MB/s)",
                               round(s.mean / 1048576.0, 1)                         AS "Baseline (MB/s)",
                               round((i.allocBytesPerSec - s.mean) / NULLIF(s.std, 0), 2)
                                                                                    AS "Z-Score",
                               round(i.uptimeSecs - i.prevUptime, 3)               AS "Interval (s)"
                        FROM intervals i, stats s
                        WHERE i.allocBytesPerSec > 0
                          AND (i.allocBytesPerSec - s.mean) / NULLIF(s.std, 0) > 2.0
                        ORDER BY "Z-Score" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("GCs where the preceding allocation rate was a statistical outlier (Z-score > 2.0) — these sudden spikes indicate burst allocation events that may trigger emergency GCs."),

            // -----------------------------------------------------------------------
            // Safepoint operation heatmap (operation × time window)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-safepoint-heatmap", "jvmlog",
                    "GC Log: Safepoint Operation Frequency Heatmap", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-heatmap" AS
                        SELECT floor(uptimeSecs / 60.0)::BIGINT               AS "Minute",
                               operation                                        AS "Operation",
                               count(*)                                         AS "Count",
                               round(sum(durationMs), 1)                       AS "Total STW (ms)",
                               round(max(durationMs), 1)                       AS "Max STW (ms)"
                        FROM jvmlog_safepoint
                        WHERE uptimeSecs IS NOT NULL AND operation IS NOT NULL
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT, operation
                        ORDER BY 1, "Total STW (ms)" DESC
                        """,
                    "jvmlog_safepoint")
                    .description("Safepoint operation frequency per 1-minute window — shows which operations dominate STW time each minute and whether problematic operations cluster in time."),

            // -----------------------------------------------------------------------
            // Metaspace class space growth trend (leak detection)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-class-space-trend", "jvmlog",
                    "GC Log: Class Space Growth Trend", null,
                    """
                        CREATE VIEW "jvmlog-class-space-trend" AS
                        WITH cs AS (
                            SELECT e.uptimeSecs,
                                   m.classSpaceAfter,
                                   m.classSpaceCommitted
                            FROM jvmlog_metaspace m
                            JOIN jvmlog_gc_event  e USING (gcId)
                            WHERE m.classSpaceAfter IS NOT NULL AND e.uptimeSecs IS NOT NULL
                        )
                        SELECT count(*)                                                AS "Data Points",
                               round(min(classSpaceAfter) / 1048576.0, 1)             AS "Min Class Space (MB)",
                               round(max(classSpaceAfter) / 1048576.0, 1)             AS "Max Class Space (MB)",
                               round(avg(classSpaceAfter) / 1048576.0, 1)             AS "Avg Class Space (MB)",
                               round(max(classSpaceCommitted) / 1048576.0, 1)         AS "Max Committed (MB)",
                               round(regr_slope(classSpaceAfter, uptimeSecs), 2)      AS "Growth Rate (bytes/s)",
                               round(regr_r2(classSpaceAfter, uptimeSecs), 4)         AS "R²",
                               CASE
                                 WHEN regr_r2(classSpaceAfter, uptimeSecs) > 0.7
                                      AND regr_slope(classSpaceAfter, uptimeSecs) > 1024
                                 THEN 'Warning — class space growing steadily, possible classloader leak'
                                 WHEN regr_r2(classSpaceAfter, uptimeSecs) > 0.5
                                      AND regr_slope(classSpaceAfter, uptimeSecs) > 0
                                 THEN 'Mild growth — monitor for classloader accumulation'
                                 ELSE 'Stable'
                               END                                                    AS "Assessment"
                        FROM cs
                        """,
                    "jvmlog_metaspace", "jvmlog_gc_event")
                    .description("Class space growth trend from metaspace data — linear regression on class space usage detects classloader leaks before they cause OutOfMemoryError: Metaspace.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-class-space-trend" AS
                            SELECT count(*)                                                AS "Data Points",
                                   round(min(classSpaceAfter) / 1048576.0, 1)             AS "Min Class Space (MB)",
                                   round(max(classSpaceAfter) / 1048576.0, 1)             AS "Max Class Space (MB)",
                                   round(avg(classSpaceAfter) / 1048576.0, 1)             AS "Avg Class Space (MB)",
                                   round(max(classSpaceCommitted) / 1048576.0, 1)         AS "Max Committed (MB)",
                                   round(regr_slope(classSpaceAfter, gcId * 1.0), 2)      AS "Growth Rate (bytes/GC)",
                                   round(regr_r2(classSpaceAfter, gcId * 1.0), 4)         AS "R²",
                                   CASE
                                     WHEN regr_r2(classSpaceAfter, gcId * 1.0) > 0.7
                                          AND regr_slope(classSpaceAfter, gcId * 1.0) > 0
                                     THEN 'Warning — class space growing, possible classloader leak'
                                     ELSE 'Stable'
                                   END                                                    AS "Assessment"
                            FROM jvmlog_metaspace
                            WHERE classSpaceAfter IS NOT NULL
                            """,
                        "jvmlog_metaspace"),

            // -----------------------------------------------------------------------
            // GC throughput consistency (rolling coefficient of variation)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-throughput-consistency", "jvmlog",
                    "GC Log: GC Throughput Consistency", null,
                    """
                        CREATE VIEW "jvmlog-throughput-consistency" AS
                        WITH windows AS (
                            SELECT floor(uptimeSecs / 60.0)::BIGINT AS minute,
                                   100.0 * (1.0 - sum(pauseMs) / 60000.0) AS throughputPct
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        )
                        SELECT count(*)                                              AS "Minutes Observed",
                               round(avg(throughputPct), 2)                         AS "Avg Throughput %",
                               round(min(throughputPct), 2)                         AS "Min Throughput %",
                               round(max(throughputPct), 2)                         AS "Max Throughput %",
                               round(stddev_pop(throughputPct), 2)                  AS "StdDev %",
                               round(100.0 * stddev_pop(throughputPct)
                                     / NULLIF(avg(throughputPct), 0), 2)            AS "CV % (Consistency)",
                               CASE
                                 WHEN 100.0 * stddev_pop(throughputPct)
                                      / NULLIF(avg(throughputPct), 0) < 5
                                 THEN 'Consistent — GC overhead stable across minutes'
                                 WHEN 100.0 * stddev_pop(throughputPct)
                                      / NULLIF(avg(throughputPct), 0) < 15
                                 THEN 'Moderate variance — some GC pressure spikes'
                                 ELSE 'High variance — GC overhead highly irregular'
                               END                                                  AS "Consistency Assessment"
                        FROM windows
                        """,
                    "jvmlog_gc_event")
                    .description("GC throughput consistency across 1-minute windows: coefficient of variation (CV%) measures how steady the overhead is — high CV% means erratic GC spikes."),

            // -----------------------------------------------------------------------
            // Heap fragmentation timeline (headroom trend)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-headroom-timeline", "jvmlog",
                    "GC Log: Heap Headroom Over Time", null,
                    """
                        CREATE VIEW "jvmlog-heap-headroom-timeline" AS
                        SELECT gcId                                                   AS "GC ID",
                               round(uptimeSecs, 3)                                  AS "Uptime (s)",
                               gcType                                                 AS "GC Type",
                               round(heapMax / 1048576.0, 1)                        AS "Heap Max (MB)",
                               round(heapAfter / 1048576.0, 1)                      AS "Heap After (MB)",
                               round((heapMax - heapAfter) / 1048576.0, 1)          AS "Headroom (MB)",
                               round(100.0 * (heapMax - heapAfter)
                                     / NULLIF(heapMax, 0), 1)                        AS "Headroom %"
                        FROM jvmlog_gc_event
                        WHERE heapMax IS NOT NULL AND heapAfter IS NOT NULL
                          AND uptimeSecs IS NOT NULL
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_gc_event")
                    .description("Post-GC heap headroom (free capacity) per GC event over time — declining headroom trend means the JVM is approaching the heap ceiling and Full GCs are likely imminent."),

            // -----------------------------------------------------------------------
            // Concurrent mode failure rate (G1/CMS/Shenandoah error pattern)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-concurrent-mode-failure", "jvmlog",
                    "GC Log: Concurrent Mode Failure Analysis", null,
                    """
                        CREATE VIEW "jvmlog-concurrent-mode-failure" AS
                        WITH all_errors AS (
                            SELECT gcId, errorType, durationMs
                            FROM jvmlog_gc_errors
                            WHERE errorType IN ('To-space exhausted', 'Evacuation Failure',
                                                'Degenerated GC', 'Out Of Memory')
                        )
                        SELECT errorType                                              AS "Failure Type",
                               count(*)                                               AS "Count",
                               round(sum(durationMs), 1)                             AS "Total Duration (ms)",
                               round(avg(durationMs), 2)                             AS "Avg Duration (ms)",
                               round(max(durationMs), 2)                             AS "Max Duration (ms)",
                               round(100.0 * count(*) / (
                                   SELECT count(*) FROM jvmlog_gc_event
                               ), 2)                                                 AS "% of All GCs"
                        FROM all_errors
                        GROUP BY errorType
                        ORDER BY "Count" DESC
                        """,
                    "jvmlog_gc_errors")
                    .description("Concurrent mode failure rates: evacuation failures, to-space exhaustion, degenerated GCs, and OOM events — these indicate the concurrent collector cannot keep up with allocation pressure."),

            // -----------------------------------------------------------------------
            // Metaspace pressure assessment
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-metaspace-pressure", "jvmlog",
                    "GC Log: Metaspace Pressure Assessment", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-pressure" AS
                        WITH ms AS (
                            SELECT e.gcId,
                                   e.uptimeSecs,
                                   m.metaspaceAfter,
                                   m.metaspaceCommitted,
                                   m.metaspaceAfter * 100.0 / NULLIF(m.metaspaceCommitted, 0) AS usePct
                            FROM jvmlog_metaspace m
                            JOIN jvmlog_gc_event   e USING (gcId)
                            WHERE m.metaspaceAfter IS NOT NULL AND m.metaspaceCommitted IS NOT NULL
                        )
                        SELECT count(*)                                                AS "Samples",
                               round(min(metaspaceAfter) / 1048576.0, 1)              AS "Min Used (MB)",
                               round(max(metaspaceAfter) / 1048576.0, 1)              AS "Max Used (MB)",
                               round(avg(metaspaceAfter) / 1048576.0, 1)              AS "Avg Used (MB)",
                               round(max(metaspaceCommitted) / 1048576.0, 1)          AS "Max Committed (MB)",
                               round(avg(usePct), 1)                                  AS "Avg Use %",
                               round(max(usePct), 1)                                  AS "Peak Use %",
                               round(regr_slope(metaspaceAfter, uptimeSecs) / 1024.0, 2)
                                                                                      AS "Growth (KB/s)",
                               CASE
                                 WHEN max(usePct) > 90
                                 THEN 'Critical — metaspace nearly full, OOM risk high'
                                 WHEN max(usePct) > 75
                                 THEN 'Warning — metaspace use elevated, monitor closely'
                                 WHEN regr_slope(metaspaceAfter, uptimeSecs) > 102400
                                 THEN 'Growing — steady metaspace growth detected'
                                 ELSE 'Healthy'
                               END                                                    AS "Assessment"
                        FROM ms
                        """,
                    "jvmlog_metaspace", "jvmlog_gc_event")
                    .description("Metaspace pressure assessment: current usage vs committed, growth rate, peak fill %, and a health assessment — identifies OOM: Metaspace risk before it occurs.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-metaspace-pressure" AS
                            SELECT count(*)                                                AS "Samples",
                                   round(min(metaspaceAfter) / 1048576.0, 1)              AS "Min Used (MB)",
                                   round(max(metaspaceAfter) / 1048576.0, 1)              AS "Max Used (MB)",
                                   round(avg(metaspaceAfter) / 1048576.0, 1)              AS "Avg Used (MB)",
                                   round(max(metaspaceCommitted) / 1048576.0, 1)          AS "Max Committed (MB)",
                                   round(avg(metaspaceAfter * 100.0 / NULLIF(metaspaceCommitted, 0)), 1)
                                                                                          AS "Avg Use %",
                                   round(max(metaspaceAfter * 100.0 / NULLIF(metaspaceCommitted, 0)), 1)
                                                                                          AS "Peak Use %"
                            FROM jvmlog_metaspace
                            WHERE metaspaceAfter IS NOT NULL AND metaspaceCommitted IS NOT NULL
                            """,
                        "jvmlog_metaspace"),

            // -----------------------------------------------------------------------
            // Pause histogram per GC type
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-histogram-by-type", "jvmlog",
                    "GC Log: Pause Time Histogram per GC Type", null,
                    """
                        CREATE VIEW "jvmlog-pause-histogram-by-type" AS
                        WITH bucketed AS (
                            SELECT gcType,
                                   CASE
                                     WHEN pauseMs < 10    THEN '<10ms'
                                     WHEN pauseMs < 25    THEN '10-25ms'
                                     WHEN pauseMs < 50    THEN '25-50ms'
                                     WHEN pauseMs < 100   THEN '50-100ms'
                                     WHEN pauseMs < 200   THEN '100-200ms'
                                     WHEN pauseMs < 500   THEN '200-500ms'
                                     WHEN pauseMs < 1000  THEN '500ms-1s'
                                     ELSE '1s+'
                                   END AS bucket,
                                   CASE
                                     WHEN pauseMs < 10    THEN 0
                                     WHEN pauseMs < 25    THEN 1
                                     WHEN pauseMs < 50    THEN 2
                                     WHEN pauseMs < 100   THEN 3
                                     WHEN pauseMs < 200   THEN 4
                                     WHEN pauseMs < 500   THEN 5
                                     WHEN pauseMs < 1000  THEN 6
                                     ELSE 7
                                   END AS sortKey
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND gcType IS NOT NULL
                        )
                        SELECT gcType                                              AS "GC Type",
                               bucket                                              AS "Pause Bucket",
                               count(*)                                            AS "Count",
                               round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY gcType), 1)
                                                                                  AS "% of Type"
                        FROM bucketed
                        GROUP BY gcType, bucket, sortKey
                        ORDER BY gcType, sortKey
                        """,
                    "jvmlog_gc_event")
                    .description("Pause time histogram per GC type — shows the distribution shape for each type separately, revealing whether Young GCs have a long tail that Full GCs might be hiding in the global histogram."),

            // -----------------------------------------------------------------------
            // Allocation vs reclaim balance (creation vs GC throughput ratio)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-alloc-reclaim-balance", "jvmlog",
                    "GC Log: Allocation vs Reclaim Balance", null,
                    """
                        CREATE VIEW "jvmlog-alloc-reclaim-balance" AS
                        WITH intervals AS (
                            SELECT gcId,
                                   heapBefore - LAG(heapAfter) OVER (ORDER BY uptimeSecs) AS allocatedBytes,
                                   heapBefore - heapAfter                                  AS reclaimedBytes,
                                   pauseMs
                            FROM jvmlog_gc_event
                            WHERE heapBefore IS NOT NULL AND heapAfter IS NOT NULL
                              AND uptimeSecs IS NOT NULL
                        )
                        SELECT count(*) FILTER (WHERE allocatedBytes IS NOT NULL)    AS "GC Cycles",
                               round(sum(allocatedBytes) / 1073741824.0, 2)          AS "Total Allocated (GB)",
                               round(sum(reclaimedBytes) / 1073741824.0, 2)          AS "Total Reclaimed (GB)",
                               round(sum(reclaimedBytes) * 100.0
                                     / NULLIF(sum(allocatedBytes), 0), 1)            AS "Reclaim/Alloc Ratio %",
                               round(avg(allocatedBytes) / 1048576.0, 1)             AS "Avg Alloc per GC (MB)",
                               round(avg(reclaimedBytes) / 1048576.0, 1)             AS "Avg Reclaim per GC (MB)",
                               round(sum(allocatedBytes - reclaimedBytes) / 1073741824.0, 3)
                                                                                     AS "Net Live Growth (GB)",
                               CASE
                                 WHEN sum(reclaimedBytes) * 100.0
                                      / NULLIF(sum(allocatedBytes), 0) > 95
                                 THEN 'Balanced — GC reclaiming nearly all allocations'
                                 WHEN sum(reclaimedBytes) * 100.0
                                      / NULLIF(sum(allocatedBytes), 0) > 80
                                 THEN 'Mild net growth — live data set slowly expanding'
                                 ELSE 'Significant net growth — high live data set accumulation'
                               END                                                   AS "Assessment"
                        FROM intervals
                        """,
                    "jvmlog_gc_event")
                    .description("Allocation vs reclaim balance: total allocated and reclaimed across the log, reclaim ratio %, and net live data set growth — high net growth indicates a memory leak or workload imbalance."),

            // -----------------------------------------------------------------------
            // GC cause category analysis
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-cause-categories", "jvmlog",
                    "GC Log: GC Cause Category Summary", null,
                    """
                        CREATE VIEW "jvmlog-cause-categories" AS
                        WITH categorized AS (
                            SELECT gcId,
                                   gcCause,
                                   pauseMs,
                                   CASE
                                     WHEN gcCause LIKE '%Evacuation%' OR gcCause LIKE '%G1%'
                                     THEN 'Young-Gen Evacuation'
                                     WHEN gcCause IN ('Allocation Failure', 'Allocation Stall')
                                     THEN 'Allocation Pressure'
                                     WHEN gcCause LIKE '%Humongous%'
                                     THEN 'Humongous Allocation'
                                     WHEN gcCause IN ('System.gc()', 'Heap Inspection Initiated GC',
                                                      'Heap Dump Initiated GC', 'WhiteBox Initiated Young GC')
                                     THEN 'Explicit / Diagnostic'
                                     WHEN gcCause IN ('GCLocker Initiated GC', 'JNI Critical')
                                     THEN 'JNI / GCLocker'
                                     WHEN gcCause LIKE '%Ergonomic%' OR gcCause LIKE '%Threshold%'
                                     THEN 'Ergonomics / Threshold'
                                     WHEN gcCause LIKE '%Metadata%' OR gcCause LIKE '%Metaspace%'
                                     THEN 'Metaspace Pressure'
                                     WHEN gcCause LIKE '%Concurrent%' OR gcCause LIKE '%Proactive%'
                                     THEN 'Concurrent / Proactive'
                                     ELSE 'Other'
                                   END AS category
                            FROM jvmlog_gc_event
                            WHERE gcCause IS NOT NULL AND pauseMs IS NOT NULL
                        )
                        SELECT category                                              AS "Category",
                               count(DISTINCT gcCause)                              AS "Distinct Causes",
                               count(*)                                              AS "Total GCs",
                               round(sum(pauseMs), 1)                               AS "Total Pause (ms)",
                               round(avg(pauseMs), 2)                               AS "Avg Pause (ms)",
                               round(100.0 * count(*) / sum(count(*)) OVER (), 1)  AS "% of All GCs"
                        FROM categorized
                        GROUP BY category
                        ORDER BY "Total GCs" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("GC causes grouped into high-level categories (Evacuation, Allocation Pressure, Explicit, Ergonomics, Metaspace, etc.) — simplifies cause analysis when many distinct cause strings appear in the log."),

            // -----------------------------------------------------------------------
            // GC CPU time estimate (pause × CPU cores × efficiency)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-cpu-estimate", "jvmlog",
                    "GC Log: Estimated GC CPU Consumption", null,
                    """
                        CREATE VIEW "jvmlog-gc-cpu-estimate" AS
                        WITH init AS (
                            SELECT max(parallelWorkers) AS workers,
                                   max(cpuTotal)         AS cpus
                            FROM jvmlog_gc_init
                        ),
                        gc_totals AS (
                            SELECT count(*)            AS gcCount,
                                   sum(pauseMs) / 1000.0 AS totalPauseSecs,
                                   max(uptimeSecs) - min(uptimeSecs) AS wallSecs
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        )
                        SELECT i.workers                                             AS "GC Workers",
                               i.cpus                                               AS "Total CPUs",
                               g.gcCount                                            AS "GC Events",
                               round(g.totalPauseSecs, 2)                          AS "Total STW (s)",
                               round(g.wallSecs, 2)                                AS "Wall Time (s)",
                               round(g.totalPauseSecs * COALESCE(i.workers, 4), 2)
                                                                                   AS "Est. GC CPU-Seconds (STW)",
                               round(100.0 * g.totalPauseSecs / NULLIF(g.wallSecs, 0), 2)
                                                                                   AS "STW Overhead %",
                               CASE
                                 WHEN i.cpus IS NOT NULL
                                 THEN round(100.0 * g.totalPauseSecs * COALESCE(i.workers, 4)
                                            / NULLIF(g.wallSecs * i.cpus, 0), 2)
                                 ELSE NULL
                               END                                                 AS "GC CPU% of Total"
                        FROM gc_totals g
                        LEFT JOIN init i ON true
                        """,
                    "jvmlog_gc_event", "jvmlog_gc_init")
                    .description("Estimated GC CPU consumption: total STW pause × worker thread count approximates CPU-seconds spent on GC — shows GC's share of total CPU capacity.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-gc-cpu-estimate" AS
                            SELECT count(*)                                             AS "GC Events",
                                   round(sum(pauseMs) / 1000.0, 2)                    AS "Total STW (s)",
                                   round(max(uptimeSecs) - min(uptimeSecs), 2)         AS "Wall Time (s)",
                                   round(100.0 * sum(pauseMs) /
                                         NULLIF((max(uptimeSecs) - min(uptimeSecs)) * 1000.0, 0), 2)
                                                                                      AS "STW Overhead %"
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                            """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // Pause vs heap fill correlation analysis
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-heap-correlation", "jvmlog",
                    "GC Log: Pause Duration vs Heap Fill Correlation", null,
                    """
                        CREATE VIEW "jvmlog-pause-heap-correlation" AS
                        WITH base AS (
                            SELECT gcType,
                                   100.0 * heapBefore / NULLIF(heapMax, 0) AS heapFillPct,
                                   pauseMs
                            FROM jvmlog_gc_event
                            WHERE heapBefore IS NOT NULL AND heapMax IS NOT NULL
                              AND pauseMs IS NOT NULL AND gcType IS NOT NULL
                        )
                        SELECT gcType                                              AS "GC Type",
                               count(*)                                            AS "Events",
                               round(corr(pauseMs, heapFillPct), 4)               AS "Correlation (r)",
                               round(regr_slope(pauseMs, heapFillPct), 4)         AS "Slope (ms/%)",
                               round(regr_r2(pauseMs, heapFillPct), 4)            AS "R²",
                               CASE
                                 WHEN abs(corr(pauseMs, heapFillPct)) > 0.7
                                 THEN 'Strong correlation — heap fill drives pause duration'
                                 WHEN abs(corr(pauseMs, heapFillPct)) > 0.4
                                 THEN 'Moderate correlation'
                                 ELSE 'Weak / no correlation'
                               END                                                AS "Interpretation"
                        FROM base
                        GROUP BY gcType
                        ORDER BY abs(corr(pauseMs, heapFillPct)) DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Correlation between heap fill % at GC trigger and pause duration per GC type — strong correlation means heap pressure directly drives longer pauses."),

            // -----------------------------------------------------------------------
            // Throughput overhead per GC type
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-overhead-by-type", "jvmlog",
                    "GC Log: Pause Overhead Contribution per GC Type", null,
                    """
                        CREATE VIEW "jvmlog-overhead-by-type" AS
                        WITH totals AS (
                            SELECT gcType,
                                   sum(pauseMs)  AS typePause,
                                   count(*)      AS typeCount
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND gcType IS NOT NULL
                            GROUP BY gcType
                        ),
                        wall AS (
                            SELECT max(uptimeSecs) - min(uptimeSecs) AS wallSecs
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL
                        )
                        SELECT t.gcType                                             AS "GC Type",
                               t.typeCount                                          AS "Count",
                               round(t.typePause, 1)                               AS "Total Pause (ms)",
                               round(100.0 * t.typePause / sum(t.typePause) OVER (), 1)
                                                                                   AS "% of All Pause",
                               round(100.0 * t.typePause / NULLIF(w.wallSecs * 1000.0, 0), 2)
                                                                                   AS "Overhead %",
                               round(t.typePause / NULLIF(t.typeCount, 0), 2)     AS "Avg Pause (ms)"
                        FROM totals t, wall w
                        ORDER BY t.typePause DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Pause overhead contribution per GC type: which types consume the most wall-clock time? Full GC typically accounts for a disproportionate share relative to its count."),

            // -----------------------------------------------------------------------
            // G1 mixed GC promotion tracking (Old region delta per cycle)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-g1-old-gen-tracking", "jvmlog",
                    "GC Log: G1 Old Generation Size Tracking", null,
                    """
                        CREATE VIEW "jvmlog-g1-old-gen-tracking" AS
                        WITH old_regions AS (
                            SELECT r.gcId,
                                   e.gcType,
                                   r.oldBefore,
                                   r.oldAfter,
                                   r.oldAfter - LAG(r.oldAfter) OVER (ORDER BY r.gcId) AS deltaOld
                            FROM jvmlog_g1_regions r
                            JOIN jvmlog_gc_event   e USING (gcId)
                            WHERE r.oldBefore IS NOT NULL OR r.oldAfter IS NOT NULL
                        )
                        SELECT gcType                                              AS "GC Type",
                               count(*)                                            AS "Cycles",
                               round(avg(oldBefore), 1)                           AS "Avg Old Before (regions)",
                               round(avg(oldAfter), 1)                            AS "Avg Old After (regions)",
                               round(avg(oldAfter - oldBefore), 2)                AS "Avg Old Region Change",
                               round(max(oldAfter), 0)                            AS "Max Old (regions)",
                               round(avg(deltaOld), 2)                            AS "Avg Δ vs Previous GC"
                        FROM old_regions
                        GROUP BY gcType
                        ORDER BY "Avg Δ vs Previous GC" DESC
                        """,
                    "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("G1 Old generation region count tracking per GC type — mixed GCs should reduce Old region count; if average delta is positive, the Old gen is growing despite GC.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-g1-old-gen-tracking" AS
                            WITH old_regions AS (
                                SELECT gcId,
                                       oldBefore,
                                       oldAfter,
                                       oldAfter - LAG(oldAfter) OVER (ORDER BY gcId) AS deltaOld
                                FROM jvmlog_g1_regions
                                WHERE oldBefore IS NOT NULL OR oldAfter IS NOT NULL
                            )
                            SELECT count(*)                                            AS "Cycles",
                                   round(avg(oldBefore), 1)                           AS "Avg Old Before (regions)",
                                   round(avg(oldAfter), 1)                            AS "Avg Old After (regions)",
                                   round(avg(oldAfter - oldBefore), 2)                AS "Avg Old Region Change",
                                   round(max(oldAfter), 0)                            AS "Max Old (regions)",
                                   round(avg(deltaOld), 2)                            AS "Avg Δ vs Previous GC"
                            FROM old_regions
                            """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // Phase timing heatmap (phase × GC type average duration)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-phase-by-gc-type", "jvmlog",
                    "GC Log: Phase Duration by GC Type", null,
                    """
                        CREATE VIEW "jvmlog-phase-by-gc-type" AS
                        SELECT e.gcType                                            AS "GC Type",
                               p.phaseName                                         AS "Phase",
                               count(*)                                            AS "Occurrences",
                               round(avg(p.durationMs), 2)                        AS "Avg (ms)",
                               round(max(p.durationMs), 2)                        AS "Max (ms)",
                               round(approx_quantile(p.durationMs, 0.95), 2)      AS "p95 (ms)",
                               round(sum(p.durationMs), 1)                        AS "Total (ms)"
                        FROM jvmlog_gc_phase p
                        JOIN jvmlog_gc_event  e USING (gcId)
                        WHERE p.durationMs IS NOT NULL AND e.gcType IS NOT NULL
                        GROUP BY e.gcType, p.phaseName
                        ORDER BY e.gcType, "Total (ms)" DESC
                        """,
                    "jvmlog_gc_phase", "jvmlog_gc_event")
                    .description("Phase duration aggregated by GC type — shows which phases dominate within each collection type and highlights cross-type differences in phase timing."),

            // -----------------------------------------------------------------------
            // ZGC minor vs major cycle comparison (generational ZGC)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-zgc-minor-vs-major", "jvmlog",
                    "GC Log: ZGC Minor vs Major Cycle Comparison", null,
                    """
                        CREATE VIEW "jvmlog-zgc-minor-vs-major" AS
                        WITH cycle_summary AS (
                            SELECT gcId,
                                   generation,
                                   CASE
                                     WHEN generation IN ('Young', 'young')         THEN 'Minor (Young)'
                                     WHEN generation IN ('Old', 'old', 'N/A', null) THEN 'Major (Old/Full)'
                                     ELSE generation
                                   END AS cycleType,
                                   sum(durationMs)  AS totalDurationMs,
                                   sum(CASE WHEN NOT concurrent THEN durationMs ELSE 0 END) AS totalPauseMs
                            FROM jvmlog_zgc_phases
                            WHERE durationMs IS NOT NULL
                            GROUP BY gcId, generation
                        )
                        SELECT cycleType                                           AS "Cycle Type",
                               count(*)                                            AS "Cycles",
                               round(sum(totalDurationMs), 1)                     AS "Total Duration (ms)",
                               round(avg(totalDurationMs), 1)                     AS "Avg Duration (ms)",
                               round(max(totalDurationMs), 1)                     AS "Max Duration (ms)",
                               round(sum(totalPauseMs), 1)                        AS "Total Pause (ms)",
                               round(avg(totalPauseMs), 2)                        AS "Avg Pause (ms)"
                        FROM cycle_summary
                        GROUP BY cycleType
                        ORDER BY cycleType
                        """,
                    "jvmlog_zgc_phases")
                    .description("ZGC generational minor vs major cycle comparison — minor cycles (Young gen) should be fast; high minor/major frequency ratio or growing major duration indicates old gen pressure."),

            // -----------------------------------------------------------------------
            // Pause spike frequency per time window
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-spike-frequency", "jvmlog",
                    "GC Log: Pause Spike Frequency Over Time", null,
                    """
                        CREATE VIEW "jvmlog-pause-spike-frequency" AS
                        SELECT floor(uptimeSecs / 60.0)::BIGINT                   AS "Minute",
                               count(*) FILTER (WHERE pauseMs > 100)              AS "Spikes >100ms",
                               count(*) FILTER (WHERE pauseMs > 200)              AS "Spikes >200ms",
                               count(*) FILTER (WHERE pauseMs > 500)              AS "Spikes >500ms",
                               count(*) FILTER (WHERE pauseMs > 1000)             AS "Spikes >1s",
                               count(*)                                            AS "Total GCs",
                               round(max(pauseMs), 1)                             AS "Worst Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        ORDER BY 1
                        """,
                    "jvmlog_gc_event")
                    .description("High-pause event count per 1-minute window at 100ms/200ms/500ms/1s thresholds — identifies which time periods had the most latency violations."),

            // -----------------------------------------------------------------------
            // Application run time vs GC stop time ratio (running totals)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-app-vs-gc-time", "jvmlog",
                    "GC Log: Application vs GC Time Running Totals", null,
                    """
                        CREATE VIEW "jvmlog-app-vs-gc-time" AS
                        WITH cumulative AS (
                            SELECT gcId,
                                   round(uptimeSecs, 3)                           AS uptimeSecs,
                                   pauseMs,
                                   sum(pauseMs) OVER (ORDER BY uptimeSecs ROWS UNBOUNDED PRECEDING)
                                       AS cumulativePauseMs
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        )
                        SELECT gcId                                                AS "GC ID",
                               uptimeSecs                                          AS "Uptime (s)",
                               round(pauseMs, 2)                                  AS "Pause (ms)",
                               round(cumulativePauseMs, 1)                        AS "Cumulative GC Time (ms)",
                               round(cumulativePauseMs / NULLIF(uptimeSecs * 1000.0, 0) * 100.0, 2)
                                                                                  AS "Running GC Overhead %",
                               round(100.0 - cumulativePauseMs
                                     / NULLIF(uptimeSecs * 1000.0, 0) * 100.0, 2)
                                                                                  AS "Running Throughput %"
                        FROM cumulative
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_gc_event")
                    .description("Running cumulative GC overhead and throughput % — shows how application availability evolves over the log duration, not just the snapshot at the end."),

            // -----------------------------------------------------------------------
            // Metaspace expansion events
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-metaspace-expansions", "jvmlog",
                    "GC Log: Metaspace Expansion Events", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-expansions" AS
                        WITH ordered AS (
                            SELECT m.gcId,
                                   e.uptimeSecs,
                                   m.metaspaceAfter,
                                   m.metaspaceCommitted,
                                   LAG(m.metaspaceAfter)     OVER (ORDER BY m.gcId) AS prevAfter,
                                   LAG(m.metaspaceCommitted) OVER (ORDER BY m.gcId) AS prevCommitted
                            FROM jvmlog_metaspace m
                            JOIN jvmlog_gc_event   e USING (gcId)
                            WHERE m.metaspaceAfter IS NOT NULL
                        )
                        SELECT gcId                                                AS "GC ID",
                               round(uptimeSecs, 3)                               AS "Uptime (s)",
                               round(metaspaceAfter / 1048576.0, 1)               AS "Used (MB)",
                               round(prevAfter / 1048576.0, 1)                    AS "Prev Used (MB)",
                               round((metaspaceAfter - prevAfter) / 1048576.0, 2) AS "Growth (MB)",
                               round(metaspaceCommitted / 1048576.0, 1)           AS "Committed (MB)",
                               round((metaspaceCommitted - prevCommitted) / 1048576.0, 2)
                                                                                  AS "Committed Δ (MB)"
                        FROM ordered
                        WHERE prevAfter IS NOT NULL
                          AND (metaspaceAfter - prevAfter) > 1048576  -- only show >1MB growth events
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_metaspace", "jvmlog_gc_event")
                    .description("Metaspace expansion events where usage grew by >1MB between consecutive GCs — repeated expansions indicate steady class loading growth or a classloader leak.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-metaspace-expansions" AS
                            WITH ordered AS (
                                SELECT gcId,
                                       metaspaceAfter,
                                       metaspaceCommitted,
                                       LAG(metaspaceAfter)     OVER (ORDER BY gcId) AS prevAfter,
                                       LAG(metaspaceCommitted) OVER (ORDER BY gcId) AS prevCommitted
                                FROM jvmlog_metaspace
                                WHERE metaspaceAfter IS NOT NULL
                            )
                            SELECT gcId                                                AS "GC ID",
                                   round(metaspaceAfter / 1048576.0, 1)               AS "Used (MB)",
                                   round(prevAfter / 1048576.0, 1)                    AS "Prev Used (MB)",
                                   round((metaspaceAfter - prevAfter) / 1048576.0, 2) AS "Growth (MB)"
                            FROM ordered
                            WHERE prevAfter IS NOT NULL
                              AND (metaspaceAfter - prevAfter) > 1048576
                            ORDER BY gcId
                            """,
                        "jvmlog_metaspace"),

            // -----------------------------------------------------------------------
            // GC pressure index (composite pressure metric)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-pressure-index", "jvmlog",
                    "GC Log: GC Pressure Index", null,
                    """
                        CREATE VIEW "jvmlog-gc-pressure-index" AS
                        WITH windows AS (
                            SELECT floor(uptimeSecs / 60.0)::BIGINT AS minute,
                                   count(*)                           AS gcCount,
                                   sum(pauseMs)                       AS totalPauseMs,
                                   max(pauseMs)                       AS maxPauseMs,
                                   avg(100.0 * heapBefore / NULLIF(heapMax, 0)) AS avgHeapFillPct,
                                   count(*) FILTER (WHERE gcType IN ('Full', 'Degenerated')) AS fullGcs,
                                   count(*) FILTER (WHERE pauseMs > 200) AS spikeCount
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        )
                        SELECT minute                                              AS "Minute",
                               gcCount                                             AS "GC Count",
                               round(totalPauseMs, 1)                             AS "Total Pause (ms)",
                               round(maxPauseMs, 1)                               AS "Max Pause (ms)",
                               round(avgHeapFillPct, 1)                           AS "Avg Heap Fill %",
                               fullGcs                                             AS "Full GCs",
                               spikeCount                                          AS "Spikes >200ms",
                               round(
                                   LEAST(100,
                                       (totalPauseMs / 60000.0 * 40)     -- overhead weight
                                       + (LEAST(maxPauseMs, 2000) / 2000.0 * 30) -- max pause weight
                                       + (avgHeapFillPct / 100.0 * 20)    -- heap fill weight
                                       + (fullGcs * 5)                     -- full GC penalty
                                       + (spikeCount * 2)                  -- spike penalty (capped at 10)
                                   )
                               , 1)                                                AS "Pressure Index"
                        FROM windows
                        ORDER BY minute
                        """,
                    "jvmlog_gc_event")
                    .description("Composite GC pressure index per minute (0-100) combining overhead%, max pause, heap fill%, full GC count, and spike count — a single number to spot the most problematic periods."),

            // -----------------------------------------------------------------------
            // Long concurrent phase detection
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-long-concurrent-phases", "jvmlog",
                    "GC Log: Long Concurrent Phase Detection", null,
                    """
                        CREATE VIEW "jvmlog-long-concurrent-phases" AS
                        WITH stats AS (
                            SELECT phaseName,
                                   avg(durationMs)      AS mean,
                                   stddev_pop(durationMs) AS std
                            FROM jvmlog_gc_phase
                            WHERE lower(phaseName) LIKE '%concurrent%' AND durationMs IS NOT NULL
                            GROUP BY phaseName
                        )
                        SELECT p.gcId                                              AS "GC ID",
                               p.phaseName                                         AS "Phase",
                               round(p.durationMs, 1)                             AS "Duration (ms)",
                               round(s.mean, 1)                                   AS "Avg (ms)",
                               round((p.durationMs - s.mean) / NULLIF(s.std, 0), 2)
                                                                                  AS "Z-Score",
                               round(p.durationMs / NULLIF(s.mean, 0), 2)        AS "Ratio to Avg"
                        FROM jvmlog_gc_phase p
                        JOIN stats s USING (phaseName)
                        WHERE lower(p.phaseName) LIKE '%concurrent%'
                          AND p.durationMs IS NOT NULL
                          AND (p.durationMs - s.mean) / NULLIF(s.std, 0) > 2.0
                        ORDER BY "Z-Score" DESC
                        LIMIT 50
                        """,
                    "jvmlog_gc_phase")
                    .description("Concurrent phases with duration more than 2 standard deviations above their mean — abnormally long concurrent phases can delay the next pause and indicate heap pressure or OS interference."),

            // -----------------------------------------------------------------------
            // G1 Eden fill before GC (Young generation saturation)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-eden-fill-at-trigger", "jvmlog",
                    "GC Log: Eden Region Fill at GC Trigger", null,
                    """
                        CREATE VIEW "jvmlog-eden-fill-at-trigger" AS
                        WITH ef AS (
                            SELECT r.gcId,
                                   e.gcType,
                                   e.gcCause,
                                   100.0 * r.edenBefore / NULLIF(r.edenMax, 0) AS edenFillPct
                            FROM jvmlog_g1_regions r
                            JOIN jvmlog_gc_event   e USING (gcId)
                            WHERE r.edenBefore IS NOT NULL AND r.edenMax IS NOT NULL AND r.edenMax > 0
                        )
                        SELECT gcType                                              AS "GC Type",
                               count(*)                                            AS "Events",
                               round(avg(edenFillPct), 1)                         AS "Avg Eden Fill %",
                               round(min(edenFillPct), 1)                         AS "Min Eden Fill %",
                               round(max(edenFillPct), 1)                         AS "Max Eden Fill %",
                               round(approx_quantile(edenFillPct, 0.50), 1)       AS "p50 Eden Fill %",
                               round(approx_quantile(edenFillPct, 0.10), 1)       AS "p10 Eden Fill %"
                        FROM ef
                        GROUP BY gcType
                        ORDER BY "Avg Eden Fill %" DESC
                        """,
                    "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("Eden region fill % at GC trigger per GC type — consistently low fill indicates G1 is over-triggering Young GCs; consistently 100% indicates Eden is too small for the allocation rate.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-eden-fill-at-trigger" AS
                            SELECT count(*)                                            AS "Events",
                                   round(avg(100.0 * edenBefore / NULLIF(edenMax, 0)), 1) AS "Avg Eden Fill %",
                                   round(min(100.0 * edenBefore / NULLIF(edenMax, 0)), 1) AS "Min Eden Fill %",
                                   round(max(100.0 * edenBefore / NULLIF(edenMax, 0)), 1) AS "Max Eden Fill %"
                            FROM jvmlog_g1_regions
                            WHERE edenBefore IS NOT NULL AND edenMax IS NOT NULL AND edenMax > 0
                            """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // GC multi-metric trend summary (all key trends in one view)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-trend-summary", "jvmlog",
                    "GC Log: Multi-Metric Trend Summary", null,
                    """
                        CREATE VIEW "jvmlog-trend-summary" AS
                        WITH base AS (
                            SELECT uptimeSecs,
                                   pauseMs,
                                   heapBefore,
                                   heapAfter,
                                   heapMax,
                                   100.0 * heapBefore / NULLIF(heapMax, 0) AS heapFillPct,
                                   100.0 * heapAfter  / NULLIF(heapMax, 0) AS heapAfterPct
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                        )
                        SELECT 'Pause Duration'      AS "Metric",
                               round(regr_slope(pauseMs, uptimeSecs), 4)        AS "Trend (per sec)",
                               round(regr_r2(pauseMs, uptimeSecs), 3)           AS "R²",
                               CASE WHEN regr_r2(pauseMs, uptimeSecs) > 0.4
                                    THEN CASE WHEN regr_slope(pauseMs, uptimeSecs) > 0
                                              THEN 'Degrading' ELSE 'Improving' END
                                    ELSE 'Stable' END                           AS "Direction"
                        FROM base
                        UNION ALL
                        SELECT 'Heap Fill at Trigger',
                               round(regr_slope(heapFillPct, uptimeSecs), 4),
                               round(regr_r2(heapFillPct, uptimeSecs), 3),
                               CASE WHEN regr_r2(heapFillPct, uptimeSecs) > 0.4
                                    THEN CASE WHEN regr_slope(heapFillPct, uptimeSecs) > 0
                                              THEN 'Rising' ELSE 'Falling' END
                                    ELSE 'Stable' END
                        FROM base
                        UNION ALL
                        SELECT 'Post-GC Heap Level',
                               round(regr_slope(heapAfterPct, uptimeSecs), 4),
                               round(regr_r2(heapAfterPct, uptimeSecs), 3),
                               CASE WHEN regr_r2(heapAfterPct, uptimeSecs) > 0.4
                                    THEN CASE WHEN regr_slope(heapAfterPct, uptimeSecs) > 0
                                              THEN 'Rising (possible leak)' ELSE 'Falling' END
                                    ELSE 'Stable' END
                        FROM base
                        ORDER BY "Metric"
                        """,
                    "jvmlog_gc_event")
                    .description("Multi-metric trend summary — pause duration, heap fill at trigger, and post-GC heap level trends in a single view, each with slope, R², and a plain-text direction assessment."),

            // -----------------------------------------------------------------------
            // Safepoint TTR outliers (operations with unusually long time-to-reach)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-safepoint-ttr-outliers", "jvmlog",
                    "GC Log: Safepoint Time-to-Reach Outliers", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-ttr-outliers" AS
                        WITH stats AS (
                            SELECT avg(ttrMs)      AS mean,
                                   stddev_pop(ttrMs) AS std
                            FROM jvmlog_safepoint
                            WHERE ttrMs IS NOT NULL
                        )
                        SELECT s.gcId                                              AS "GC ID",
                               s.operation                                         AS "Operation",
                               round(s.uptimeSecs, 3)                             AS "Uptime (s)",
                               round(s.ttrMs, 3)                                  AS "TTR (ms)",
                               round(s.durationMs, 2)                             AS "STW Duration (ms)",
                               round((s.ttrMs - st.mean) / NULLIF(st.std, 0), 2) AS "Z-Score",
                               round(s.ttrMs / NULLIF(st.mean, 0), 1)            AS "Ratio to Mean TTR"
                        FROM jvmlog_safepoint s, stats st
                        WHERE s.ttrMs IS NOT NULL
                          AND (s.ttrMs - st.mean) / NULLIF(st.std, 0) > 2.0
                        ORDER BY "Z-Score" DESC
                        LIMIT 30
                        """,
                    "jvmlog_safepoint")
                    .description("Safepoint time-to-reach outliers (Z-score > 2.0) — unusually long TTR indicates a thread was slow to reach the safepoint, often caused by JNI, compiled loops without safepoint polls, or OS scheduling delays."),

            // -----------------------------------------------------------------------
            // Survivor region occupancy over time (G1 promotion pressure)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-survivor-occupancy-timeline", "jvmlog",
                    "GC Log: G1 Survivor Region Occupancy Timeline", null,
                    """
                        CREATE VIEW "jvmlog-survivor-occupancy-timeline" AS
                        SELECT r.gcId                                              AS "GC ID",
                               round(e.uptimeSecs, 3)                             AS "Uptime (s)",
                               r.survivorBefore                                   AS "Survivor Before",
                               r.survivorAfter                                    AS "Survivor After",
                               r.survivorMax                                      AS "Survivor Max",
                               round(100.0 * r.survivorAfter / NULLIF(r.survivorMax, 0), 1)
                                                                                  AS "Survivor Fill %",
                               (r.survivorAfter - r.survivorBefore)               AS "Survivor Δ (regions)"
                        FROM jvmlog_g1_regions r
                        JOIN jvmlog_gc_event    e USING (gcId)
                        WHERE r.survivorAfter IS NOT NULL AND r.survivorMax IS NOT NULL
                          AND r.survivorMax > 0
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("G1 survivor region occupancy per GC event — consistently high survivor fill % indicates objects surviving too many collections and aging into the Old gen prematurely.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-survivor-occupancy-timeline" AS
                            SELECT gcId                                                AS "GC ID",
                                   survivorBefore                                      AS "Survivor Before",
                                   survivorAfter                                       AS "Survivor After",
                                   survivorMax                                         AS "Survivor Max",
                                   round(100.0 * survivorAfter / NULLIF(survivorMax, 0), 1)
                                                                                      AS "Survivor Fill %"
                            FROM jvmlog_g1_regions
                            WHERE survivorAfter IS NOT NULL AND survivorMax IS NOT NULL AND survivorMax > 0
                            ORDER BY gcId
                            """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // String dedup savings rate over time
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-stringdedup-rate-timeline", "jvmlog",
                    "GC Log: String Dedup Savings Rate Timeline", null,
                    """
                        CREATE VIEW "jvmlog-stringdedup-rate-timeline" AS
                        WITH sd AS (
                            SELECT d.gcId,
                                   e.uptimeSecs,
                                   d.savedBytes,
                                   d.objectCount,
                                   d.deduplicatedObjects,
                                   d.durationMs
                            FROM jvmlog_stringdedup d
                            JOIN jvmlog_gc_event     e USING (gcId)
                            WHERE d.savedBytes IS NOT NULL OR d.deduplicatedObjects IS NOT NULL
                        )
                        SELECT floor(uptimeSecs / 60.0)::BIGINT                   AS "Minute",
                               count(*)                                            AS "Dedup Events",
                               round(sum(savedBytes) / 1048576.0, 2)              AS "Bytes Saved (MB)",
                               round(sum(deduplicatedObjects), 0)                 AS "Objects Deduped",
                               round(avg(durationMs), 2)                          AS "Avg Duration (ms)"
                        FROM sd
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        ORDER BY 1
                        """,
                    "jvmlog_stringdedup", "jvmlog_gc_event")
                    .description("String deduplication savings per 1-minute window — tracks how much memory is being saved by dedup and whether it's consistent or declining over time.")
                    .addAlternative(
                        """
                            CREATE VIEW "jvmlog-stringdedup-rate-timeline" AS
                            SELECT gcId                                                AS "GC ID",
                                   savedBytes                                          AS "Bytes Saved",
                                   objectCount                                         AS "Objects",
                                   deduplicatedObjects                                 AS "Deduped Objects",
                                   durationMs                                          AS "Duration (ms)"
                            FROM jvmlog_stringdedup
                            WHERE savedBytes IS NOT NULL OR deduplicatedObjects IS NOT NULL
                            ORDER BY gcId
                            """,
                        "jvmlog_stringdedup"),

            // -----------------------------------------------------------------------
            // Full GC recovery analysis (efficiency of each Full GC)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-full-gc-recovery", "jvmlog",
                    "GC Log: Full GC Recovery Analysis", null,
                    """
                        CREATE VIEW "jvmlog-full-gc-recovery" AS
                        SELECT gcId                                                   AS "GC ID",
                               gcCause                                                AS "Cause",
                               round(uptimeSecs, 3)                                  AS "Uptime (s)",
                               round(heapBefore / 1048576.0, 1)                      AS "Heap Before (MB)",
                               round(heapAfter / 1048576.0, 1)                       AS "Heap After (MB)",
                               round(heapMax / 1048576.0, 1)                         AS "Heap Max (MB)",
                               round((heapBefore - heapAfter) / 1048576.0, 1)        AS "Reclaimed (MB)",
                               round(100.0 * (heapBefore - heapAfter)
                                     / NULLIF(heapBefore, 0), 1)                     AS "Reclaim %",
                               round(100.0 * heapBefore / NULLIF(heapMax, 0), 1)     AS "Fill Before %",
                               round(100.0 * heapAfter  / NULLIF(heapMax, 0), 1)     AS "Fill After %",
                               round(pauseMs, 1)                                     AS "Pause (ms)",
                               round((heapBefore - heapAfter) / 1048576.0
                                     / NULLIF(pauseMs, 0), 3)                        AS "Efficiency (MB/ms)"
                        FROM jvmlog_gc_event
                        WHERE gcType IN ('Full', 'Degenerated', 'GarbageFirst (Full)')
                          AND heapBefore IS NOT NULL AND pauseMs IS NOT NULL
                        ORDER BY uptimeSecs
                        """,
                    "jvmlog_gc_event")
                    .description("Per-Full-GC recovery analysis: heap fill before/after, bytes reclaimed, reclaim %, and MB/ms efficiency — identifies which Full GCs were productive and which indicated a high live data set."),

            // -----------------------------------------------------------------------
            // GC cause dominant window transitions
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-dominant-cause-timeline", "jvmlog",
                    "GC Log: Dominant GC Cause per 5-Minute Window", null,
                    """
                        CREATE VIEW "jvmlog-dominant-cause-timeline" AS
                        WITH window_counts AS (
                            SELECT floor(uptimeSecs / 300.0)::BIGINT    AS window5m,
                                   round(min(uptimeSecs), 0)             AS windowStart,
                                   gcCause,
                                   count(*)                               AS gcCount,
                                   round(sum(pauseMs), 1)                AS totalPause,
                                   RANK() OVER (
                                       PARTITION BY floor(uptimeSecs / 300.0)::BIGINT
                                       ORDER BY count(*) DESC
                                   ) AS rnk
                            FROM jvmlog_gc_event
                            WHERE gcCause IS NOT NULL AND uptimeSecs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 300.0)::BIGINT, gcCause
                        )
                        SELECT window5m                                             AS "5-Min Window",
                               windowStart                                          AS "Window Start (s)",
                               gcCause                                             AS "Dominant Cause",
                               gcCount                                             AS "Count",
                               totalPause                                           AS "Total Pause (ms)"
                        FROM window_counts
                        WHERE rnk = 1
                        ORDER BY window5m
                        """,
                    "jvmlog_gc_event")
                    .description("The dominant GC cause (by count) per 5-minute window — shows how the trigger mix evolves: transitioning from Evacuation to Allocation Failure to System.gc() indicates escalating heap pressure."),

            // -----------------------------------------------------------------------
            // Heap committed vs max over time (when did heap reach max?)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-max-proximity", "jvmlog",
                    "GC Log: Heap Size vs Maximum Over Time", null,
                    """
                        CREATE VIEW "jvmlog-heap-max-proximity" AS
                        WITH heap AS (
                            SELECT gcId,
                                   heapBefore, heapAfter, heapCommittedBefore
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        )
                        SELECT e.gcId                                                         AS "GC ID",
                               round(e.uptimeSecs, 3)                                        AS "Uptime (s)",
                               e.gcType                                                       AS "GC Type",
                               round(h.heapBefore / 1048576.0, 1)                            AS "Heap Before (MB)",
                               round(h.heapAfter  / 1048576.0, 1)                            AS "Heap After (MB)",
                               round(h.heapCommittedBefore / 1048576.0, 1)                   AS "Committed (MB)",
                               round(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0), 1)
                                                                                             AS "Before / Committed %",
                               round(100.0 * h.heapAfter  / NULLIF(h.heapCommittedBefore, 0), 1)
                                                                                             AS "After / Committed %",
                               round((h.heapCommittedBefore - h.heapBefore) / 1048576.0, 1) AS "Free Before (MB)"
                        FROM jvmlog_gc_event e
                        JOIN heap h USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Heap size (before/after) vs committed per GC event — shows how close each GC brings the heap to the ceiling, useful for identifying the onset of heap saturation.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-heap-max-proximity" AS
                        SELECT gcId AS "GC ID", round(uptimeSecs, 3) AS "Uptime (s)", gcType AS "GC Type"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL
                        ORDER BY uptimeSecs
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // GC type mix trend (is the ratio of Young vs Mixed vs Full changing?)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-type-mix-trend", "jvmlog",
                    "GC Log: GC Type Mix Trend Over Time", null,
                    """
                        CREATE VIEW "jvmlog-gc-type-mix-trend" AS
                        WITH windows AS (
                            SELECT floor(uptimeSecs / 300.0)::BIGINT AS w,
                                   count(*) FILTER (WHERE gcType IN ('Young', 'GarbageFirst (young)', 'Pause Young'))
                                       AS youngCount,
                                   count(*) FILTER (WHERE gcType IN ('Mixed', 'GarbageFirst (mixed)'))
                                       AS mixedCount,
                                   count(*) FILTER (WHERE gcType IN ('Full', 'Degenerated', 'GarbageFirst (Full)'))
                                       AS fullCount,
                                   count(*) AS totalCount
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND gcType IS NOT NULL
                            GROUP BY floor(uptimeSecs / 300.0)::BIGINT
                        )
                        SELECT w                                                    AS "5-Min Window",
                               youngCount                                            AS "Young",
                               mixedCount                                            AS "Mixed",
                               fullCount                                             AS "Full",
                               totalCount                                            AS "Total",
                               round(100.0 * youngCount / NULLIF(totalCount, 0), 1) AS "Young %",
                               round(100.0 * mixedCount / NULLIF(totalCount, 0), 1) AS "Mixed %",
                               round(100.0 * fullCount  / NULLIF(totalCount, 0), 1) AS "Full %"
                        FROM windows
                        ORDER BY w
                        """,
                    "jvmlog_gc_event")
                    .description("GC type mix per 5-minute window: Young/Mixed/Full counts and percentages — a rising Full% or Mixed% indicates increasing heap pressure and imminent risk of concurrent mode failure."),

            // -----------------------------------------------------------------------
            // Allocation rate per GC cause (which causes trigger high-alloc GCs?)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-alloc-rate-by-cause", "jvmlog",
                    "GC Log: Allocation Rate at Trigger by GC Cause", null,
                    """
                        CREATE VIEW "jvmlog-alloc-rate-by-cause" AS
                        WITH heap AS (
                            SELECT gcId, heapBefore, heapAfter
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        ),
                        intervals AS (
                            SELECT e.gcId,
                                   e.cause,
                                   e.uptimeSecs,
                                   h.heapBefore,
                                   LAG(h.heapAfter)  OVER (ORDER BY e.uptimeSecs) AS prevAfter,
                                   LAG(e.uptimeSecs) OVER (ORDER BY e.uptimeSecs) AS prevUptime
                            FROM jvmlog_gc_event e
                            JOIN heap h USING (gcId)
                            WHERE e.uptimeSecs IS NOT NULL AND h.heapBefore IS NOT NULL
                        ),
                        rates AS (
                            SELECT cause,
                                   (heapBefore - prevAfter) / NULLIF(uptimeSecs - prevUptime, 0)
                                       AS allocBytesPerSec
                            FROM intervals
                            WHERE prevAfter IS NOT NULL AND uptimeSecs > prevUptime
                              AND heapBefore >= prevAfter
                        )
                        SELECT cause                                                AS "GC Cause",
                               count(*)                                             AS "Events",
                               round(avg(allocBytesPerSec) / 1048576.0, 1)         AS "Avg Alloc Rate (MB/s)",
                               round(max(allocBytesPerSec) / 1048576.0, 1)         AS "Max Alloc Rate (MB/s)",
                               round(approx_quantile(allocBytesPerSec, 0.95) / 1048576.0, 1)
                                                                                   AS "p95 Alloc Rate (MB/s)"
                        FROM rates
                        WHERE cause IS NOT NULL AND allocBytesPerSec > 0
                        GROUP BY cause
                        ORDER BY "Avg Alloc Rate (MB/s)" DESC
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Allocation rate at GC trigger grouped by cause — identifies which GC causes are associated with the highest allocation pressure, useful for correlating cause with workload behavior.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-alloc-rate-by-cause" AS
                        SELECT cause AS "GC Cause", count(*) AS "Events"
                        FROM jvmlog_gc_event
                        WHERE cause IS NOT NULL
                        GROUP BY cause
                        ORDER BY "Events" DESC
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // Pause time trend by GC cause (is each cause getting worse over time?)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-trend-by-cause", "jvmlog",
                    "GC Log: Pause Duration Trend per GC Cause", null,
                    """
                        CREATE VIEW "jvmlog-pause-trend-by-cause" AS
                        SELECT cause                                                AS "GC Cause",
                               count(*)                                             AS "Events",
                               round(avg(pauseMs), 2)                              AS "Avg Pause (ms)",
                               round(regr_slope(pauseMs, uptimeSecs), 4)           AS "Trend (ms/s)",
                               round(regr_r2(pauseMs, uptimeSecs), 4)              AS "R²",
                               CASE
                                 WHEN regr_r2(pauseMs, uptimeSecs) > 0.4
                                      AND regr_slope(pauseMs, uptimeSecs) > 0
                                 THEN 'Degrading — pauses for this cause growing over time'
                                 WHEN regr_r2(pauseMs, uptimeSecs) > 0.4
                                      AND regr_slope(pauseMs, uptimeSecs) < 0
                                 THEN 'Improving — pauses for this cause shrinking over time'
                                 ELSE 'Stable'
                               END                                                 AS "Trend"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                          AND cause IS NOT NULL
                        GROUP BY cause
                        HAVING count(*) >= 5
                        ORDER BY "Trend (ms/s)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Pause duration trend per GC cause — detects which causes are getting systematically worse over the log duration, not just which are worst overall."),

            // -----------------------------------------------------------------------
            // GC footprint summary (GCViewer-style: min/max/avg heap after GC)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-footprint", "jvmlog",
                    "GC Log: Heap Footprint Summary", null,
                    """
                        CREATE VIEW "jvmlog-gc-footprint" AS
                        WITH heap AS (
                            SELECT gcId, heapAfter, heapCommittedBefore
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        )
                        SELECT
                            round(min(h.heapAfter)            / 1048576.0, 1) AS "Min Heap After (MB)",
                            round(avg(h.heapAfter)            / 1048576.0, 1) AS "Avg Heap After (MB)",
                            round(max(h.heapAfter)            / 1048576.0, 1) AS "Max Heap After (MB)",
                            round(min(h.heapCommittedBefore)  / 1048576.0, 1) AS "Min Committed (MB)",
                            round(avg(h.heapCommittedBefore)  / 1048576.0, 1) AS "Avg Committed (MB)",
                            round(max(h.heapCommittedBefore)  / 1048576.0, 1) AS "Max Committed (MB)",
                            round(approx_quantile(h.heapAfter, 0.50) / 1048576.0, 1) AS "p50 Heap After (MB)",
                            round(approx_quantile(h.heapAfter, 0.95) / 1048576.0, 1) AS "p95 Heap After (MB)"
                        FROM jvmlog_gc_event e
                        JOIN heap h USING (gcId)
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("GCViewer-style heap footprint: min/avg/max heap after GC and committed heap across the entire log — minimum footprint represents the true working set.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-gc-footprint" AS
                        SELECT count(*) AS "GC Events", round(avg(pauseMs), 2) AS "Avg Pause (ms)"
                        FROM jvmlog_gc_event
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // Committed heap timeline (heap expansion / shrinkage over time)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-committed-timeline", "jvmlog",
                    "GC Log: Committed Heap Timeline", null,
                    """
                        CREATE VIEW "jvmlog-heap-committed-timeline" AS
                        WITH heap AS (
                            SELECT gcId, heapBefore, heapAfter, heapCommittedBefore, heapCommittedAfter
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        )
                        SELECT e.gcId                                                    AS "GC ID",
                               round(e.uptimeSecs, 3)                                   AS "Uptime (s)",
                               round(h.heapBefore         / 1048576.0, 1)               AS "Used Before (MB)",
                               round(h.heapAfter          / 1048576.0, 1)               AS "Used After (MB)",
                               round(h.heapCommittedBefore / 1048576.0, 1)              AS "Committed (MB)",
                               round((h.heapCommittedBefore - h.heapBefore) / 1048576.0, 1)
                                                                                        AS "Free Before (MB)",
                               round(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0), 1)
                                                                                        AS "Utilisation %"
                        FROM jvmlog_gc_event e
                        JOIN heap h USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Committed and used heap at every GC event — a flat committed line with rising used% indicates the JVM has stopped resizing (Xms=Xmx or GCLocker) and heap saturation is imminent.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-heap-committed-timeline" AS
                        SELECT gcId AS "GC ID", round(uptimeSecs, 3) AS "Uptime (s)",
                               round(pauseMs, 2) AS "Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL
                        ORDER BY uptimeSecs
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // G1 humongous allocation timeline
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-g1-humongous-timeline", "jvmlog",
                    "GC Log: G1 Humongous Region Count Timeline", null,
                    """
                        CREATE VIEW "jvmlog-g1-humongous-timeline" AS
                        WITH regions AS (
                            SELECT gcId, max(humongousBefore) AS humongousBefore, max(humongousAfter) AS humongousAfter
                            FROM jvmlog_g1_regions
                            WHERE humongousBefore IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT e.gcId                  AS "GC ID",
                               round(e.uptimeSecs, 3)  AS "Uptime (s)",
                               r.humongousBefore        AS "Humongous Regions Before",
                               r.humongousAfter         AS "Humongous Regions After",
                               r.humongousBefore - r.humongousAfter
                                                        AS "Humongous Reclaimed"
                        FROM jvmlog_gc_event e
                        JOIN regions r USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_g1_regions")
                    .description("G1 humongous region count before/after each GC — persistent humongous regions across GCs indicate large object retention; high before-count with low reclaim indicates GC pressure from large objects.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-g1-humongous-timeline" AS
                        SELECT gcId AS "GC ID", max(humongousBefore) AS "Humongous Before", max(humongousAfter) AS "Humongous After"
                        FROM jvmlog_g1_regions
                        WHERE humongousBefore IS NOT NULL
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // Pause percentile SLA compliance table
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-pause-sla-compliance", "jvmlog",
                    "GC Log: Pause SLA Compliance", null,
                    """
                        CREATE VIEW "jvmlog-pause-sla-compliance" AS
                        SELECT
                            count(*) AS "Total GCs",
                            round(100.0 * count(*) FILTER (WHERE pauseMs < 10)   / count(*), 1) AS "< 10 ms %",
                            round(100.0 * count(*) FILTER (WHERE pauseMs < 50)   / count(*), 1) AS "< 50 ms %",
                            round(100.0 * count(*) FILTER (WHERE pauseMs < 100)  / count(*), 1) AS "< 100 ms %",
                            round(100.0 * count(*) FILTER (WHERE pauseMs < 200)  / count(*), 1) AS "< 200 ms %",
                            round(100.0 * count(*) FILTER (WHERE pauseMs < 500)  / count(*), 1) AS "< 500 ms %",
                            round(100.0 * count(*) FILTER (WHERE pauseMs >= 500) / count(*), 1) AS ">= 500 ms %",
                            round(max(pauseMs), 1) AS "Max Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL
                        """,
                    "jvmlog_gc_event")
                    .description("SLA compliance summary: percentage of GC pauses under common latency thresholds (10/50/100/200/500 ms) — GCeasy-style pass/fail visibility for pause budgets."),

            // -----------------------------------------------------------------------
            // Concurrent GC stall rate (ZGC / Shenandoah allocation stalls per minute)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-concurrent-stall-timeline", "jvmlog",
                    "GC Log: Concurrent GC Allocation Stall Rate", null,
                    """
                        CREATE VIEW "jvmlog-concurrent-stall-timeline" AS
                        WITH buckets AS (
                            SELECT (rowid / 20)::BIGINT          AS bucket,
                                   count(*)                       AS stallCount,
                                   round(sum(stallMs), 1)         AS totalStallMs,
                                   round(avg(stallMs), 2)         AS avgStallMs
                            FROM jvmlog_alloc_stall
                            GROUP BY (rowid / 20)::BIGINT
                        )
                        SELECT bucket        AS "Bucket (20 events)",
                               stallCount    AS "Stalls",
                               totalStallMs  AS "Total Stall (ms)",
                               avgStallMs    AS "Avg Stall (ms)"
                        FROM buckets
                        ORDER BY bucket
                        """,
                    "jvmlog_alloc_stall")
                    .description("Allocation stall count and total stall time in rolling 20-event buckets — for ZGC/Shenandoah, stalls mean the mutator was blocked waiting for the concurrent collector; sustained stalls indicate the GC cannot keep up with allocation."),

            // -----------------------------------------------------------------------
            // Heap reclaim efficiency: MB reclaimed per ms of pause
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-reclaim-efficiency", "jvmlog",
                    "GC Log: Heap Reclaim Efficiency", null,
                    """
                        CREATE VIEW "jvmlog-heap-reclaim-efficiency" AS
                        WITH heap AS (
                            SELECT gcId, heapBefore, heapAfter
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        )
                        SELECT e.gcType                                                              AS "GC Type",
                               e.cause                                                              AS "Cause",
                               count(*)                                                              AS "Events",
                               round(avg((h.heapBefore - h.heapAfter) / 1048576.0), 1)              AS "Avg Reclaimed (MB)",
                               round(avg(e.pauseMs), 2)                                             AS "Avg Pause (ms)",
                               round(avg((h.heapBefore - h.heapAfter) / 1048576.0 / NULLIF(e.pauseMs, 0)), 2)
                                                                                                    AS "Reclaim Rate (MB/ms)",
                               round(approx_quantile((h.heapBefore - h.heapAfter) / 1048576.0 / NULLIF(e.pauseMs, 0), 0.50), 2)
                                                                                                    AS "p50 Reclaim Rate (MB/ms)"
                        FROM jvmlog_gc_event e
                        JOIN heap h USING (gcId)
                        WHERE e.pauseMs > 0 AND h.heapBefore > h.heapAfter
                          AND e.gcType IS NOT NULL
                        GROUP BY e.gcType, e.cause
                        ORDER BY "Reclaim Rate (MB/ms)" DESC
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Heap reclamation efficiency: MB reclaimed per ms of pause time, grouped by GC type and cause — low efficiency (< 0.5 MB/ms) means GC is spending more pause time per unit of heap reclaimed, a sign of fragmentation or tenure promotion pressure.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-heap-reclaim-efficiency" AS
                        SELECT gcType AS "GC Type", cause AS "Cause",
                               count(*) AS "Events", round(avg(pauseMs), 2) AS "Avg Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE gcType IS NOT NULL
                        GROUP BY gcType, cause
                        ORDER BY "Avg Pause (ms)" DESC
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // Safepoint non-GC operations (JIT, deopt, biased-lock, etc.)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-safepoint-non-gc", "jvmlog",
                    "GC Log: Non-GC Safepoint Operations", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-non-gc" AS
                        SELECT operation                                        AS "Operation",
                               count(*)                                         AS "Count",
                               round(sum(totalMs), 1)                           AS "Total STW (ms)",
                               round(avg(totalMs), 2)                           AS "Avg STW (ms)",
                               round(max(totalMs), 2)                           AS "Max STW (ms)",
                               round(avg(syncMs), 2)                            AS "Avg Sync (ms)"
                        FROM jvmlog_safepoint
                        WHERE operation IS NOT NULL
                          AND operation NOT LIKE 'G1%'
                          AND operation NOT LIKE 'ZGC%'
                          AND operation NOT LIKE 'Shenandoah%'
                          AND operation NOT IN ('GenCollect', 'ParallelGCSystemGC',
                                                'CGC_Operation', 'CMS_Initial_Mark',
                                                'CMS_Final_Remark', 'G1PauseRemark',
                                                'G1PauseCleanup', 'PSMarkSweep',
                                                'ParallelGCFailedAllocation',
                                                'ParallelGCSystemGC')
                        GROUP BY operation
                        ORDER BY "Total STW (ms)" DESC
                        """,
                    "jvmlog_safepoint")
                    .description("Non-GC safepoints (JIT deoptimisation, biased-lock revocation, thread dumps, etc.) — these add STW time independent of GC; high JIT deopt safepoints indicate code quality issues or profiling overhead."),

            // -----------------------------------------------------------------------
            // G1 young generation sizing trend (Eden max regions over time)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-young-gen-sizing-trend", "jvmlog",
                    "GC Log: G1 Young Generation Size Trend", null,
                    """
                        CREATE VIEW "jvmlog-young-gen-sizing-trend" AS
                        WITH regions AS (
                            SELECT gcId,
                                   max(edenMax)     AS edenMax,
                                   max(survivorMax) AS survivorMax
                            FROM jvmlog_g1_regions
                            WHERE edenMax IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT e.gcId                                         AS "GC ID",
                               round(e.uptimeSecs, 3)                         AS "Uptime (s)",
                               r.edenMax                                       AS "Eden Max Regions",
                               r.survivorMax                                   AS "Survivor Max Regions",
                               r.edenMax + r.survivorMax                       AS "Young Gen Max Regions"
                        FROM jvmlog_gc_event e
                        JOIN regions r USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_g1_regions")
                    .description("G1 adaptive young generation sizing: Eden and Survivor max regions per GC — steady growth in edenMax means G1 is responding to allocation pressure by enlarging the young generation, trading more memory for fewer promotions.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-young-gen-sizing-trend" AS
                        SELECT gcId, max(edenMax) AS "Eden Max", max(survivorMax) AS "Survivor Max"
                        FROM jvmlog_g1_regions
                        WHERE edenMax IS NOT NULL
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // GC interval distribution (histogram of inter-GC time buckets)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-interval-histogram", "jvmlog",
                    "GC Log: GC Interval Distribution", null,
                    """
                        CREATE VIEW "jvmlog-gc-interval-histogram" AS
                        WITH intervals AS (
                            SELECT uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS intervalSecs
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL
                        ),
                        bucketed AS (
                            SELECT CASE
                                     WHEN intervalSecs < 0.1  THEN '< 0.1s'
                                     WHEN intervalSecs < 0.5  THEN '0.1–0.5s'
                                     WHEN intervalSecs < 1.0  THEN '0.5–1s'
                                     WHEN intervalSecs < 5.0  THEN '1–5s'
                                     WHEN intervalSecs < 10.0 THEN '5–10s'
                                     WHEN intervalSecs < 30.0 THEN '10–30s'
                                     ELSE '>= 30s'
                                   END AS bucket,
                                   CASE
                                     WHEN intervalSecs < 0.1  THEN 1
                                     WHEN intervalSecs < 0.5  THEN 2
                                     WHEN intervalSecs < 1.0  THEN 3
                                     WHEN intervalSecs < 5.0  THEN 4
                                     WHEN intervalSecs < 10.0 THEN 5
                                     WHEN intervalSecs < 30.0 THEN 6
                                     ELSE 7
                                   END AS bucketOrder
                            FROM intervals
                            WHERE intervalSecs IS NOT NULL
                        )
                        SELECT bucket                                        AS "Interval Bucket",
                               count(*)                                      AS "Count",
                               round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS "% of Events"
                        FROM bucketed
                        GROUP BY bucket, bucketOrder
                        ORDER BY bucketOrder
                        """,
                    "jvmlog_gc_event")
                    .description("Distribution of inter-GC intervals in time buckets — a spike in '< 0.1s' means GCs are back-to-back (heap exhaustion), while a spike in '>= 30s' means GC is infrequent (good for throughput, often seen with ZGC)."),

            // -----------------------------------------------------------------------
            // Phase worst performers by GC type
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-phase-worst-by-type", "jvmlog",
                    "GC Log: Worst Phases by GC Type", null,
                    """
                        CREATE VIEW "jvmlog-phase-worst-by-type" AS
                        SELECT p.phaseName                                         AS "Phase",
                               e.gcType                                             AS "GC Type",
                               count(*)                                             AS "Events",
                               round(avg(p.durationMs), 2)                         AS "Avg (ms)",
                               round(max(p.durationMs), 2)                         AS "Max (ms)",
                               round(approx_quantile(p.durationMs, 0.95), 2)       AS "P95 (ms)"
                        FROM jvmlog_gc_phase p
                        JOIN jvmlog_gc_event e USING (gcId)
                        WHERE p.durationMs IS NOT NULL AND e.gcType IS NOT NULL
                        GROUP BY p.phaseName, e.gcType
                        QUALIFY row_number() OVER (PARTITION BY e.gcType ORDER BY avg(p.durationMs) DESC) <= 5
                        ORDER BY e.gcType, "Avg (ms)" DESC
                        """,
                    "jvmlog_gc_phase", "jvmlog_gc_event")
                    .description("Top-5 slowest GC phases per GC type — identifies which phases dominate each collection type (e.g., 'Mark from Roots' in Young vs 'Rebuild Remembered Sets' in Mixed) to direct tuning effort.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-phase-worst-by-type" AS
                        SELECT phaseName AS "Phase", count(*) AS "Events",
                               round(avg(durationMs), 2) AS "Avg (ms)",
                               round(max(durationMs), 2) AS "Max (ms)"
                        FROM jvmlog_gc_phase
                        WHERE durationMs IS NOT NULL
                        GROUP BY phaseName
                        ORDER BY "Avg (ms)" DESC
                        LIMIT 20
                        """,
                        "jvmlog_gc_phase"),

            // -----------------------------------------------------------------------
            // Promotion rate: bytes promoted to old gen per GC interval
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-promotion-rate", "jvmlog",
                    "GC Log: Object Promotion Rate to Old Gen", null,
                    """
                        CREATE VIEW "jvmlog-promotion-rate" AS
                        WITH heap AS (
                            SELECT gcId, heapAfter
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        ),
                        young_gcs AS (
                            SELECT e.gcId, e.uptimeSecs, h.heapAfter,
                                   LAG(h.heapAfter) OVER (ORDER BY e.uptimeSecs) AS prevAfter,
                                   LAG(e.gcType)    OVER (ORDER BY e.uptimeSecs) AS prevType
                            FROM jvmlog_gc_event e
                            JOIN heap h USING (gcId)
                            WHERE e.gcType NOT IN ('Full', 'GarbageFirst (Full)', 'PSMarkSweep')
                              AND e.uptimeSecs IS NOT NULL
                        )
                        SELECT floor(uptimeSecs / 60.0)::BIGINT                      AS "Minute",
                               count(*)                                               AS "Young GCs",
                               round(avg(GREATEST(heapAfter - prevAfter, 0)) / 1048576.0, 1)
                                                                                     AS "Avg Promoted (MB)",
                               round(sum(GREATEST(heapAfter - prevAfter, 0)) / 1048576.0, 1)
                                                                                     AS "Total Promoted (MB)"
                        FROM young_gcs
                        WHERE prevAfter IS NOT NULL AND prevType NOT IN ('Full', 'GarbageFirst (Full)')
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        ORDER BY "Minute"
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Estimated object promotion rate to Old generation per minute — computed as heap growth between consecutive Young GC events; sustained high promotion means survivor spaces are overflowing into Old gen, rising Full GC risk.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-promotion-rate" AS
                        SELECT floor(uptimeSecs / 60.0)::BIGINT AS "Minute", count(*) AS "Young GCs"
                        FROM jvmlog_gc_event
                        WHERE gcType NOT IN ('Full', 'GarbageFirst (Full)', 'PSMarkSweep')
                          AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 60.0)::BIGINT
                        ORDER BY "Minute"
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // Metaspace-triggered GC analysis
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-metaspace-gc-trigger", "jvmlog",
                    "GC Log: Metaspace-Triggered GC Events", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-gc-trigger" AS
                        SELECT e.gcId                                                   AS "GC ID",
                               round(e.uptimeSecs, 3)                                  AS "Uptime (s)",
                               e.gcType                                                 AS "GC Type",
                               round(e.pauseMs, 2)                                     AS "Pause (ms)",
                               round(m.metaspaceBefore / 1048576.0, 1)                 AS "Meta Before (MB)",
                               round(m.metaspaceAfter  / 1048576.0, 1)                 AS "Meta After (MB)",
                               round(m.metaspaceCommitted / 1048576.0, 1)              AS "Meta Committed (MB)"
                        FROM jvmlog_gc_event e
                        JOIN jvmlog_metaspace m USING (gcId)
                        WHERE e.cause IN ('Metadata GC Threshold',
                                          'Last ditch collection',
                                          'Ergonomics',
                                          'GCLocker Initiated GC')
                          AND e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_metaspace")
                    .description("GC events triggered by metaspace pressure — repeated Metadata GC Threshold events indicate class loading pressure or classloader leaks; Last Ditch Collection means metaspace expansion is exhausted.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-metaspace-gc-trigger" AS
                        SELECT gcId AS "GC ID", round(uptimeSecs, 3) AS "Uptime (s)",
                               gcType AS "GC Type", round(pauseMs, 2) AS "Pause (ms)",
                               cause AS "Cause"
                        FROM jvmlog_gc_event
                        WHERE cause IN ('Metadata GC Threshold', 'Last ditch collection',
                                        'GCLocker Initiated GC')
                          AND uptimeSecs IS NOT NULL
                        ORDER BY uptimeSecs
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // G1 mixed GC trigger analysis (ergonomics decisions)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-g1-mixed-trigger-analysis", "jvmlog",
                    "GC Log: G1 Mixed GC Trigger Analysis", null,
                    """
                        CREATE VIEW "jvmlog-g1-mixed-trigger-analysis" AS
                        SELECT decision                                            AS "Decision",
                               count(*)                                            AS "Count",
                               round(avg(reclaimablePct), 1)                      AS "Avg Reclaimable %",
                               round(avg(thresholdPct), 1)                        AS "Avg Threshold %",
                               round(min(reclaimablePct), 1)                      AS "Min Reclaimable %",
                               round(max(reclaimablePct), 1)                      AS "Max Reclaimable %"
                        FROM jvmlog_g1_mixed_gc
                        GROUP BY decision
                        ORDER BY "Count" DESC
                        """,
                    "jvmlog_g1_mixed_gc")
                    .description("G1 mixed GC ergonomics decisions: Continue vs Do Not Continue, with reclaimable% vs threshold% — if 'Do Not Continue' dominates, G1 is abandoning mixed cycles early, likely because Old gen live data is too high."),

            // -----------------------------------------------------------------------
            // Concurrent phase efficiency (concurrent time vs subsequent pause time)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-concurrent-phase-efficiency", "jvmlog",
                    "GC Log: Concurrent Phase Efficiency", null,
                    """
                        CREATE VIEW "jvmlog-concurrent-phase-efficiency" AS
                        WITH concPhases AS (
                            SELECT gcId,
                                   sum(durationMs) AS concurrentMs
                            FROM jvmlog_gc_phase
                            WHERE phaseName LIKE 'Concurrent%'
                              AND durationMs IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT p.gcId                                                    AS "GC ID",
                               round(p.concurrentMs, 1)                                  AS "Concurrent Work (ms)",
                               round(e.pauseMs, 2)                                       AS "Subsequent Pause (ms)",
                               round(100.0 * e.pauseMs / NULLIF(p.concurrentMs, 0), 1)  AS "Pause / Concurrent %"
                        FROM concPhases p
                        JOIN jvmlog_gc_event e USING (gcId)
                        WHERE e.pauseMs IS NOT NULL
                        ORDER BY "Pause / Concurrent %" DESC
                        """,
                    "jvmlog_gc_phase", "jvmlog_gc_event")
                    .description("Ratio of STW pause to preceding concurrent work per GC event — a high Pause/Concurrent% means the concurrent phase did little useful work, so the subsequent STW had to do more, indicating the concurrent collector is falling behind.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-concurrent-phase-efficiency" AS
                        SELECT gcId AS "GC ID",
                               round(sum(durationMs), 1) AS "Concurrent Work (ms)"
                        FROM jvmlog_gc_phase
                        WHERE phaseName LIKE 'Concurrent%' AND durationMs IS NOT NULL
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_gc_phase"),

            // -----------------------------------------------------------------------
            // Heap saturation events (heap > 90% full before GC)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-heap-saturation-events", "jvmlog",
                    "GC Log: Heap Saturation Events (> 90% Full)", null,
                    """
                        CREATE VIEW "jvmlog-heap-saturation-events" AS
                        WITH heap AS (
                            SELECT gcId, heapBefore, heapAfter, heapCommittedBefore
                            FROM jvmlog_heap_snapshot
                            QUALIFY row_number() OVER (PARTITION BY gcId ORDER BY heapCommittedBefore DESC NULLS LAST) = 1
                        )
                        SELECT e.gcId                                                              AS "GC ID",
                               round(e.uptimeSecs, 3)                                             AS "Uptime (s)",
                               e.gcType                                                            AS "GC Type",
                               e.cause                                                             AS "Cause",
                               round(e.pauseMs, 2)                                                AS "Pause (ms)",
                               round(h.heapBefore / 1048576.0, 1)                                 AS "Heap Before (MB)",
                               round(h.heapCommittedBefore / 1048576.0, 1)                        AS "Committed (MB)",
                               round(100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0), 1)  AS "Utilisation %",
                               round((h.heapBefore - h.heapAfter) / 1048576.0, 1)                 AS "Reclaimed (MB)"
                        FROM jvmlog_gc_event e
                        JOIN heap h USING (gcId)
                        WHERE 100.0 * h.heapBefore / NULLIF(h.heapCommittedBefore, 0) >= 90
                          AND e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("GC events where heap was at least 90% full before collection — these indicate the JVM is running at the edge of heap capacity; repeated saturation events precede OutOfMemoryError.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-heap-saturation-events" AS
                        SELECT gcId AS "GC ID", gcType AS "GC Type", cause AS "Cause",
                               round(pauseMs, 2) AS "Pause (ms)", round(uptimeSecs, 3) AS "Uptime (s)"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL
                        ORDER BY uptimeSecs
                        LIMIT 0
                        """,
                        "jvmlog_gc_event"),

            // -----------------------------------------------------------------------
            // GC burst detection: 30-second windows with > 3 GC events
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-burst-detection", "jvmlog",
                    "GC Log: GC Burst Windows (Rapid-Fire GC)", null,
                    """
                        CREATE VIEW "jvmlog-gc-burst-detection" AS
                        WITH windows AS (
                            SELECT floor(uptimeSecs / 30.0)::BIGINT AS w,
                                   count(*)                          AS gcCount,
                                   round(sum(pauseMs), 1)            AS totalPauseMs,
                                   min(uptimeSecs)                   AS windowStart
                            FROM jvmlog_gc_event
                            WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                            GROUP BY floor(uptimeSecs / 30.0)::BIGINT
                            HAVING count(*) > 3
                        )
                        SELECT round(windowStart, 1)  AS "Window Start (s)",
                               gcCount                 AS "GC Count in 30s",
                               totalPauseMs            AS "Total Pause (ms)"
                        FROM windows
                        ORDER BY gcCount DESC
                        """,
                    "jvmlog_gc_event")
                    .description("30-second windows with more than 3 GC events — rapid-fire GC bursts indicate allocation spikes or heap exhaustion; the worst windows by count are shown first."),

            // -----------------------------------------------------------------------
            // ZGC garbage ratio by cycle
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-zgc-garbage-ratio-by-cycle", "jvmlog",
                    "GC Log: ZGC Garbage vs Live Bytes per Cycle", null,
                    """
                        CREATE VIEW "jvmlog-zgc-garbage-ratio-by-cycle" AS
                        WITH reloc AS (
                            SELECT gcId,
                                   max(liveBytes)    AS liveBytes,
                                   max(garbageBytes) AS garbageBytes
                            FROM jvmlog_zgc_stats
                            WHERE phase = 'Relocate Start'
                              AND liveBytes IS NOT NULL AND garbageBytes IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT r.gcId                                                          AS "GC ID",
                               round(r.liveBytes    / 1048576.0, 1)                           AS "Live (MB)",
                               round(r.garbageBytes / 1048576.0, 1)                           AS "Garbage (MB)",
                               round(100.0 * r.garbageBytes / NULLIF(r.liveBytes + r.garbageBytes, 0), 1)
                                                                                              AS "Garbage %",
                               round(e.uptimeSecs, 3)                                         AS "Uptime (s)"
                        FROM reloc r
                        JOIN jvmlog_gc_event e USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_zgc_stats", "jvmlog_gc_event")
                    .description("ZGC live vs garbage bytes at Relocate Start per cycle — Garbage% shows how much of the heap is actual garbage; low Garbage% means ZGC is working hard for small gains.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-zgc-garbage-ratio-by-cycle" AS
                        SELECT gcId AS "GC ID",
                               max(liveBytes) / 1048576.0    AS "Live (MB)",
                               max(garbageBytes) / 1048576.0 AS "Garbage (MB)"
                        FROM jvmlog_zgc_stats
                        WHERE phase = 'Relocate Start'
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_zgc_stats"),

            // -----------------------------------------------------------------------
            // Full GC cause summary
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-full-gc-cause-summary", "jvmlog",
                    "GC Log: Full GC Events by Cause", null,
                    """
                        CREATE VIEW "jvmlog-full-gc-cause-summary" AS
                        SELECT cause                                                AS "Cause",
                               count(*)                                             AS "Full GCs",
                               round(avg(pauseMs), 2)                              AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)                              AS "Max Pause (ms)",
                               round(sum(pauseMs), 1)                              AS "Total Pause (ms)",
                               round(approx_quantile(pauseMs, 0.95), 2)            AS "P95 Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE gcType IN ('Full', 'GarbageFirst (Full)', 'PSMarkSweep',
                                         'Degenerated', 'Concurrent Mark Abort')
                          AND cause IS NOT NULL
                        GROUP BY cause
                        ORDER BY "Full GCs" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Full GC events grouped by trigger cause — System.gc() calls indicate explicit GC invocations (often by third-party libraries), while Allocation Failure or Last ditch collection means heap exhaustion."),

            // -----------------------------------------------------------------------
            // GC duration vs pause time ratio (concurrent collector efficiency)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-duration-vs-pause", "jvmlog",
                    "GC Log: Total Duration vs STW Pause Ratio", null,
                    """
                        CREATE VIEW "jvmlog-gc-duration-vs-pause" AS
                        SELECT gcType                                                AS "GC Type",
                               count(*)                                              AS "Events",
                               round(avg(pauseMs), 2)                               AS "Avg Pause (ms)",
                               round(avg(durationMs), 2)                            AS "Avg Duration (ms)",
                               round(avg(durationMs - pauseMs), 2)                  AS "Avg Concurrent (ms)",
                               round(100.0 * avg(pauseMs) / NULLIF(avg(durationMs), 0), 1)
                                                                                    AS "STW / Duration %"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND durationMs IS NOT NULL
                          AND durationMs >= pauseMs AND gcType IS NOT NULL
                        GROUP BY gcType
                        ORDER BY "STW / Duration %" ASC
                        """,
                    "jvmlog_gc_event")
                    .description("STW pause as a fraction of total GC duration per type — for concurrent collectors (ZGC, Shenandoah, G1) a low STW/Duration% is expected; a rising ratio means concurrent phases are being cut short."),

            // -----------------------------------------------------------------------
            // ZGC load: allocation rate and system load per cycle
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-zgc-load-timeline", "jvmlog",
                    "GC Log: ZGC System Load and Allocation Rate per Cycle", null,
                    """
                        CREATE VIEW "jvmlog-zgc-load-timeline" AS
                        WITH loads AS (
                            SELECT gcId,
                                   max(load1s)        AS load1s,
                                   max(load5s)        AS load5s,
                                   max(allocRateMbps) AS allocRateMbps,
                                   max(allocStalls)   AS allocStalls
                            FROM jvmlog_zgc_load
                            GROUP BY gcId
                        )
                        SELECT e.gcId                                   AS "GC ID",
                               round(e.uptimeSecs, 3)                   AS "Uptime (s)",
                               round(l.load1s, 2)                       AS "Load (1s avg)",
                               round(l.load5s, 2)                       AS "Load (5s avg)",
                               round(l.allocRateMbps, 1)                AS "Alloc Rate (MB/s)",
                               coalesce(l.allocStalls, 0)               AS "Alloc Stalls"
                        FROM jvmlog_gc_event e
                        JOIN loads l USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_zgc_load", "jvmlog_gc_event")
                    .description("ZGC system load averages and allocation rate per GC cycle — high load at GC time means the JVM is competing with other processes; rising allocation rate often precedes allocation stalls.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-zgc-load-timeline" AS
                        SELECT gcId AS "GC ID",
                               max(load1s) AS "Load (1s avg)",
                               max(allocRateMbps) AS "Alloc Rate (MB/s)",
                               max(allocStalls) AS "Alloc Stalls"
                        FROM jvmlog_zgc_load
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_zgc_load"),

            // -----------------------------------------------------------------------
            // GC worker utilisation: unused threads per phase
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-worker-utilisation", "jvmlog",
                    "GC Log: GC Worker Thread Utilisation", null,
                    """
                        CREATE VIEW "jvmlog-gc-worker-utilisation" AS
                        SELECT taskName                                              AS "Task",
                               count(*)                                              AS "Observations",
                               round(avg(workersUsed), 1)                           AS "Avg Workers Used",
                               max(workersMax)                                      AS "Max Available",
                               round(100.0 * avg(workersUsed) / NULLIF(max(workersMax), 0), 1)
                                                                                    AS "Utilisation %",
                               min(workersUsed)                                     AS "Min Used"
                        FROM jvmlog_gc_workers
                        WHERE taskName IS NOT NULL
                        GROUP BY taskName
                        ORDER BY "Utilisation %" ASC
                        """,
                    "jvmlog_gc_workers")
                    .description("GC parallel worker utilisation per task — phases consistently using fewer workers than available indicate under-parallelisation; low utilisation on evacuation or marking suggests CPU affinity or NUMA issues."),

            // -----------------------------------------------------------------------
            // GC pause aggregated by hour (for long-running services)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-gc-pause-by-hour", "jvmlog",
                    "GC Log: GC Pause Aggregated by Hour", null,
                    """
                        CREATE VIEW "jvmlog-gc-pause-by-hour" AS
                        SELECT floor(uptimeSecs / 3600.0)::BIGINT AS "Hour",
                               count(*)                            AS "GC Events",
                               round(sum(pauseMs) / 1000.0, 2)    AS "Total Pause (s)",
                               round(avg(pauseMs), 2)              AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)              AS "Max Pause (ms)",
                               round(100.0 * sum(pauseMs) / 3600000.0, 3) AS "GC Overhead %"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL AND pauseMs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 3600.0)::BIGINT
                        ORDER BY "Hour"
                        """,
                    "jvmlog_gc_event")
                    .description("GC pause aggregated per hour of JVM uptime — useful for long-running services to detect degradation over hours of operation; rising GC overhead % per hour indicates heap drift or fragmentation buildup."),

            // -----------------------------------------------------------------------
            // Old gen growth trend (G1 regions — old region count over time)
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-old-gen-growth", "jvmlog",
                    "GC Log: G1 Old Generation Growth Trend", null,
                    """
                        CREATE VIEW "jvmlog-old-gen-growth" AS
                        WITH regions AS (
                            SELECT gcId, max(oldAfter) AS oldRegions
                            FROM jvmlog_g1_regions
                            WHERE oldAfter IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT e.gcId                                            AS "GC ID",
                               round(e.uptimeSecs, 3)                            AS "Uptime (s)",
                               r.oldRegions                                       AS "Old Regions After GC",
                               round(regr_slope(r.oldRegions, e.uptimeSecs)
                                     OVER (ORDER BY e.uptimeSecs ROWS BETWEEN 9 PRECEDING AND CURRENT ROW)
                                     , 4)                                         AS "10-GC Trend (regions/s)"
                        FROM jvmlog_gc_event e
                        JOIN regions r USING (gcId)
                        WHERE e.uptimeSecs IS NOT NULL
                        ORDER BY e.uptimeSecs
                        """,
                    "jvmlog_gc_event", "jvmlog_g1_regions")
                    .description("G1 Old generation region count after each GC with rolling 10-GC trend — a consistently positive trend means Old gen is growing faster than GC can reclaim it, a precursor to Concurrent Mode Failure.")
                    .addAlternative(
                        """
                        CREATE VIEW "jvmlog-old-gen-growth" AS
                        SELECT gcId AS "GC ID", max(oldAfter) AS "Old Regions After GC"
                        FROM jvmlog_g1_regions
                        WHERE oldAfter IS NOT NULL
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                        "jvmlog_g1_regions"),

            // -----------------------------------------------------------------------
            // Shenandoah heuristics and mode summary
            // -----------------------------------------------------------------------
            new View(
                    "jvmlog-shenandoah-summary", "jvmlog",
                    "GC Log: Shenandoah Pause Summary by Type", null,
                    """
                        CREATE VIEW "jvmlog-shenandoah-summary" AS
                        SELECT gcType                                                AS "STW Phase",
                               count(*)                                              AS "Events",
                               round(avg(pauseMs), 2)                               AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)                               AS "Max Pause (ms)",
                               round(sum(pauseMs), 1)                               AS "Total Pause (ms)",
                               round(approx_quantile(pauseMs, 0.95), 2)             AS "P95 (ms)"
                        FROM jvmlog_gc_event
                        WHERE gcType IN ('Init Mark', 'Final Mark',
                                         'Init Update Refs', 'Final Update Refs',
                                         'Degenerated')
                          AND pauseMs IS NOT NULL
                        GROUP BY gcType
                        ORDER BY "Total Pause (ms)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Shenandoah STW pause breakdown by phase — Init/Final Mark and Init/Final Update Refs should be short (< 10ms); long Final Mark means concurrent marking didn't finish; Degenerated means Shenandoah fell back to full STW collection."),

                    // Batch 7
                    new View(
                    "jvmlog-safepoint-sync-hotspot", "jvmlog",
                    "GC Log: Safepoint Operations with Longest Thread-Sync Time", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-sync-hotspot" AS
                        SELECT operation                                              AS "Operation",
                               count(*)                                              AS "Count",
                               round(avg(totalMs), 2)                               AS "Avg Total (ms)",
                               round(avg(syncMs), 2)                                AS "Avg Sync (ms)",
                               round(max(syncMs), 2)                                AS "Max Sync (ms)",
                               round(avg(syncMs) / nullif(avg(totalMs), 0) * 100, 1) AS "Sync % of Total"
                        FROM jvmlog_safepoint
                        WHERE syncMs IS NOT NULL
                        GROUP BY operation
                        ORDER BY "Max Sync (ms)" DESC
                        """,
                    "jvmlog_safepoint")
                    .description("Safepoint operations ranked by max thread-sync time. High sync time (> 10ms) means threads took long to reach a safepoint — diagnose with -XX:+PrintSafepointStatistics; common culprits are JNI frames, counted loops, or too many threads."),

                    new View(
                    "jvmlog-zgc-liveness-trend", "jvmlog",
                    "GC Log: ZGC Live Set Trend at Relocate Start", null,
                    """
                        CREATE VIEW "jvmlog-zgc-liveness-trend" AS
                        SELECT gcId                                                    AS "GC ID",
                               round(liveBytes / 1048576.0, 1)                        AS "Live (MB)",
                               round(garbageBytes / 1048576.0, 1)                     AS "Garbage (MB)",
                               round(liveBytes * 100.0 / nullif(liveBytes + garbageBytes, 0), 1) AS "Live %",
                               round(garbageBytes * 100.0 / nullif(liveBytes + garbageBytes, 0), 1) AS "Garbage %"
                        FROM jvmlog_zgc_stats
                        WHERE phase = 'Relocate Start'
                          AND liveBytes IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_zgc_stats")
                    .description("ZGC live set and garbage fractions measured at Relocate Start — a growing live fraction means long-lived data is accumulating; garbage fraction below 30% means ZGC is triggering too eagerly (tune -XX:ZCollectionInterval)."),

                    new View(
                    "jvmlog-shenandoah-concurrent-efficiency", "jvmlog",
                    "GC Log: Shenandoah Concurrent-to-STW Efficiency per Cycle", null,
                    """
                        CREATE VIEW "jvmlog-shenandoah-concurrent-efficiency" AS
                        WITH concurrent AS (
                            SELECT gcId,
                                   sum(durationMs) AS concurrentMs
                            FROM jvmlog_gc_phase
                            WHERE phaseName IN ('Concurrent marking', 'Concurrent evacuation',
                                                'Concurrent update references', 'Concurrent cleanup',
                                                'Concurrent reset bitmaps')
                            GROUP BY gcId
                        ),
                        pauses AS (
                            SELECT gcId,
                                   sum(pauseMs) AS stwMs
                            FROM jvmlog_gc_event
                            WHERE gcType IN ('Init Mark', 'Final Mark',
                                             'Init Update Refs', 'Final Update Refs')
                              AND pauseMs IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT c.gcId                                                             AS "GC ID",
                               round(c.concurrentMs, 1)                                          AS "Concurrent (ms)",
                               round(p.stwMs, 2)                                                 AS "STW (ms)",
                               round(c.concurrentMs + p.stwMs, 1)                               AS "Total (ms)",
                               round(p.stwMs / nullif(c.concurrentMs + p.stwMs, 0) * 100, 2)    AS "STW Fraction (%)"
                        FROM concurrent c
                        JOIN pauses p USING (gcId)
                        ORDER BY c.gcId
                        """,
                    "jvmlog_gc_phase", "jvmlog_gc_event")
                    .description("Per-cycle Shenandoah efficiency: STW fraction of total cycle time. STW fraction above 10% means the concurrent phase did not finish before space ran out — consider increasing heap size or reducing allocation rate.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-shenandoah-concurrent-efficiency" AS
                        SELECT gcId                                                   AS "GC ID",
                               round(sum(durationMs), 1)                             AS "Concurrent (ms)"
                        FROM jvmlog_gc_phase
                        WHERE phaseName IN ('Concurrent marking', 'Concurrent evacuation',
                                            'Concurrent update references', 'Concurrent cleanup',
                                            'Concurrent reset bitmaps')
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_phase"),

                    new View(
                    "jvmlog-heap-before-after-delta", "jvmlog",
                    "GC Log: Heap Before/After Delta per GC (Reclaim Effectiveness)", null,
                    """
                        CREATE VIEW "jvmlog-heap-before-after-delta" AS
                        SELECT e.gcId                                                             AS "GC ID",
                               e.gcType                                                           AS "GC Type",
                               round(e.uptimeSecs, 1)                                             AS "Uptime (s)",
                               round(h.heapBefore / 1048576.0, 1)                                AS "Before (MB)",
                               round(h.heapAfter / 1048576.0, 1)                                 AS "After (MB)",
                               round((h.heapBefore - h.heapAfter) / 1048576.0, 1)               AS "Reclaimed (MB)",
                               round((h.heapBefore - h.heapAfter) * 100.0 / nullif(h.heapBefore, 0), 1) AS "Reclaim %"
                        FROM jvmlog_gc_event e
                        JOIN (
                            SELECT gcId,
                                   first(heapBefore) AS heapBefore,
                                   first(heapAfter)  AS heapAfter
                            FROM jvmlog_heap_snapshot
                            GROUP BY gcId
                        ) h USING (gcId)
                        ORDER BY e.gcId
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Per-GC heap reclaim: bytes freed and reclaim % of heap-before. Reclaim% consistently below 50% for Young GC means survivor regions are too large or tenuring threshold is too low.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-heap-before-after-delta" AS
                        SELECT gcId                                                   AS "GC ID",
                               gcType                                                 AS "GC Type",
                               round(uptimeSecs, 1)                                   AS "Uptime (s)"
                        FROM jvmlog_gc_event
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_event"),

                    new View(
                    "jvmlog-gc-overhead-trend", "jvmlog",
                    "GC Log: GC Overhead Trend (% time in GC per 5-min window)", null,
                    """
                        CREATE VIEW "jvmlog-gc-overhead-trend" AS
                        WITH buckets AS (
                            SELECT floor(uptimeSecs / 300) * 300        AS bucketSecs,
                                   sum(pauseMs)                         AS totalPauseMs,
                                   count(*)                             AS gcCount
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY 1
                        )
                        SELECT round(bucketSecs / 60.0, 1)                              AS "Uptime (min)",
                               gcCount                                                   AS "GC Count",
                               round(totalPauseMs / 1000.0, 2)                          AS "Pause Secs",
                               round(totalPauseMs / 3000.0, 2)                          AS "GC Overhead %",
                               CASE WHEN totalPauseMs / 3000.0 >= 10 THEN 'Critical'
                                    WHEN totalPauseMs / 3000.0 >= 5  THEN 'High'
                                    WHEN totalPauseMs / 3000.0 >= 1  THEN 'Moderate'
                                    ELSE 'Low' END                                       AS "Severity"
                        FROM buckets
                        ORDER BY bucketSecs
                        """,
                    "jvmlog_gc_event")
                    .description("GC overhead % per 5-minute window with severity classification. Critical (≥10%) indicates OutOfMemoryError risk; High (5-10%) will degrade p99 latency; Moderate (1-5%) is acceptable for most workloads."),

                    // Batch 8
                    new View(
                    "jvmlog-gc-pause-regression", "jvmlog",
                    "GC Log: GC Pause Linear Regression (Degradation Trend)", null,
                    """
                        CREATE VIEW "jvmlog-gc-pause-regression" AS
                        WITH data AS (
                            SELECT uptimeSecs AS x, pauseMs AS y
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        ),
                        stats AS (
                            SELECT count(*)                         AS n,
                                   avg(x)                          AS avgX,
                                   avg(y)                          AS avgY,
                                   regr_slope(y, x)                AS slope,
                                   regr_intercept(y, x)            AS intercept,
                                   round(regr_r2(y, x), 4)         AS r2
                            FROM data
                        )
                        SELECT n                                                          AS "Sample Count",
                               round(avgY, 2)                                            AS "Mean Pause (ms)",
                               round(slope, 4)                                           AS "Slope (ms/s)",
                               round(intercept, 2)                                       AS "Intercept (ms)",
                               r2                                                        AS "R²",
                               CASE WHEN slope > 0.01  THEN 'Degrading'
                                    WHEN slope < -0.01 THEN 'Improving'
                                    ELSE 'Stable' END                                    AS "Trend",
                               round(slope * 3600, 1)                                   AS "Projected +1h Change (ms)"
                        FROM stats
                        """,
                    "jvmlog_gc_event")
                    .description("Linear regression of GC pause over runtime: slope > 0 means pauses are growing; R² near 1.0 indicates a strong trend. 'Projected +1h Change' shows how much the average pause is expected to grow per hour if the trend continues."),

                    new View(
                    "jvmlog-alloc-stall-by-gc", "jvmlog",
                    "GC Log: Allocation Stalls per GC Cycle", null,
                    """
                        CREATE VIEW "jvmlog-alloc-stall-by-gc" AS
                        SELECT gcId                                                    AS "GC ID",
                               count(*)                                               AS "Stall Count",
                               count(DISTINCT threadName)                             AS "Affected Threads",
                               round(sum(stallMs), 2)                                AS "Total Stall (ms)",
                               round(max(stallMs), 2)                                AS "Max Stall (ms)"
                        FROM jvmlog_alloc_stall
                        GROUP BY gcId
                        ORDER BY "Total Stall (ms)" DESC
                        LIMIT 50
                        """,
                    "jvmlog_alloc_stall")
                    .description("GC cycles that caused the most allocation stalls — the worst GC IDs here are the ones that held up application threads the longest. Cross-reference with jvmlog-gc-pause-summary to see if those GCs were also the longest pauses."),

                    new View(
                    "jvmlog-zgc-reloc-pressure", "jvmlog",
                    "GC Log: ZGC Relocation Pressure (Heap Used Delta Mark→Relocate)", null,
                    """
                        CREATE VIEW "jvmlog-zgc-reloc-pressure" AS
                        WITH mark_start AS (
                            SELECT gcId, usedBytes AS usedAtMarkStart
                            FROM jvmlog_zgc_stats
                            WHERE phase = 'Mark Start'
                        ),
                        reloc_start AS (
                            SELECT gcId, usedBytes AS usedAtRelocStart
                            FROM jvmlog_zgc_stats
                            WHERE phase = 'Relocate Start'
                        ),
                        reloc_end AS (
                            SELECT gcId, usedBytes AS usedAtRelocEnd
                            FROM jvmlog_zgc_stats
                            WHERE phase = 'Relocate End'
                        )
                        SELECT m.gcId                                                              AS "GC ID",
                               round(m.usedAtMarkStart  / 1048576.0, 1)                          AS "Used at Mark Start (MB)",
                               round(r.usedAtRelocStart / 1048576.0, 1)                          AS "Used at Reloc Start (MB)",
                               round(e.usedAtRelocEnd   / 1048576.0, 1)                          AS "Used at Reloc End (MB)",
                               round((r.usedAtRelocStart - m.usedAtMarkStart) / 1048576.0, 1)    AS "Allocated During Mark (MB)",
                               round((r.usedAtRelocStart - e.usedAtRelocEnd) / 1048576.0, 1)     AS "Freed by Reloc (MB)"
                        FROM mark_start m
                        JOIN reloc_start r USING (gcId)
                        JOIN reloc_end   e USING (gcId)
                        ORDER BY m.gcId
                        """,
                    "jvmlog_zgc_stats")
                    .description("ZGC allocation pressure during concurrent phases: 'Allocated During Mark' shows how fast the application allocated while ZGC was marking; if this exceeds freed-by-reloc, allocation is outpacing collection."),

                    new View(
                    "jvmlog-phase-timing-matrix", "jvmlog",
                    "GC Log: Phase Timing Matrix (avg ms per phase, by GC type)", null,
                    """
                        CREATE VIEW "jvmlog-phase-timing-matrix" AS
                        SELECT p.phaseName                                        AS "Phase",
                               count(*)                                           AS "Invocations",
                               round(avg(p.durationMs), 2)                       AS "Avg (ms)",
                               round(approx_quantile(p.durationMs, 0.5), 2)     AS "P50 (ms)",
                               round(approx_quantile(p.durationMs, 0.95), 2)    AS "P95 (ms)",
                               round(max(p.durationMs), 2)                      AS "Max (ms)",
                               round(sum(p.durationMs), 1)                      AS "Total (ms)"
                        FROM jvmlog_gc_phase p
                        GROUP BY p.phaseName
                        ORDER BY "Total (ms)" DESC
                        """,
                    "jvmlog_gc_phase")
                    .description("Aggregated timing matrix for all internal GC phases — phases with high Total time are the primary bottlenecks; phases with high Max/Avg ratios have occasional stragglers (possibly due to CPU saturation or memory pressure during that phase)."),

                    new View(
                    "jvmlog-safepoint-operation-mix", "jvmlog",
                    "GC Log: Safepoint Operation Mix Over Time (10-min buckets)", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-operation-mix" AS
                        WITH safe AS (
                            SELECT rowid,
                                   floor(rowid * 1.0 / greatest(1, (SELECT count(*) FROM jvmlog_safepoint)) * 6) AS bucket,
                                   operation,
                                   totalMs
                            FROM jvmlog_safepoint
                        )
                        SELECT bucket                                                            AS "Bucket",
                               count(*)                                                         AS "Safepoints",
                               count(DISTINCT operation)                                        AS "Distinct Ops",
                               round(sum(totalMs), 1)                                           AS "Total STW (ms)",
                               round(avg(totalMs), 2)                                           AS "Avg STW (ms)"
                        FROM safe
                        GROUP BY bucket
                        ORDER BY bucket
                        """,
                    "jvmlog_safepoint")
                    .description("Safepoint activity aggregated into 6 equal-time buckets — rising 'Total STW' across buckets means safepoint pressure is increasing over time; rising 'Distinct Ops' means more types of operations are triggering safepoints."),

                    // Batch 9
                    new View(
                    "jvmlog-heap-usage-histogram", "jvmlog",
                    "GC Log: Heap Usage Distribution After GC (MB histogram)", null,
                    """
                        CREATE VIEW "jvmlog-heap-usage-histogram" AS
                        WITH buckets AS (
                            SELECT round(heapAfter / 1048576.0 / 50) * 50       AS bucketMB,
                                   count(*)                                      AS gcCount
                            FROM jvmlog_heap_snapshot
                            WHERE heapAfter IS NOT NULL
                            GROUP BY 1
                        )
                        SELECT bucketMB                                          AS "Heap After Bucket (MB)",
                               gcCount                                           AS "GC Count",
                               round(gcCount * 100.0 / sum(gcCount) OVER (), 1) AS "Frequency %"
                        FROM buckets
                        ORDER BY bucketMB
                        """,
                    "jvmlog_heap_snapshot")
                    .description("Distribution of post-GC heap sizes in 50MB buckets — the modal bucket shows the typical resting heap size; a wide distribution indicates high heap variance; buckets near Xmx indicate the heap is nearly full after GC."),

                    new View(
                    "jvmlog-young-gen-gc-rate", "jvmlog",
                    "GC Log: Young GC Rate per 5-min Window", null,
                    """
                        CREATE VIEW "jvmlog-young-gen-gc-rate" AS
                        WITH buckets AS (
                            SELECT floor(uptimeSecs / 300) * 300        AS bucketSecs,
                                   count(*)                             AS youngCount,
                                   sum(pauseMs)                         AS totalPauseMs
                            FROM jvmlog_gc_event
                            WHERE gcType IN ('Young', 'ParallelScavenge', 'DefNew', 'PSYoungGen')
                               OR (gcType IS NULL AND cause IN ('Allocation Failure', 'G1 Evacuation Pause'))
                            GROUP BY 1
                        )
                        SELECT round(bucketSecs / 60.0, 1)             AS "Uptime (min)",
                               youngCount                               AS "Young GCs",
                               round(youngCount / 5.0, 2)              AS "GC/min",
                               round(totalPauseMs, 1)                  AS "Total Pause (ms)"
                        FROM buckets
                        ORDER BY bucketSecs
                        """,
                    "jvmlog_gc_event")
                    .description("Young GC frequency per 5-minute window — GC/min above 10 indicates Eden is filling faster than it can be collected; if GC/min is steady but pause time rises, survivor/promotion pressure is growing."),

                    new View(
                    "jvmlog-alloc-stall-distribution", "jvmlog",
                    "GC Log: Allocation Stall Duration Distribution (histogram)", null,
                    """
                        CREATE VIEW "jvmlog-alloc-stall-distribution" AS
                        WITH buckets AS (
                            SELECT CASE WHEN stallMs < 10   THEN '<10ms'
                                        WHEN stallMs < 50   THEN '10-50ms'
                                        WHEN stallMs < 100  THEN '50-100ms'
                                        WHEN stallMs < 500  THEN '100-500ms'
                                        ELSE '>=500ms' END                       AS bucket,
                                   count(*)                                      AS stallCount,
                                   round(sum(stallMs), 1)                        AS totalMs
                            FROM jvmlog_alloc_stall
                            GROUP BY 1
                        )
                        SELECT bucket                                             AS "Stall Range",
                               stallCount                                         AS "Count",
                               totalMs                                            AS "Total (ms)",
                               round(stallCount * 100.0 / sum(stallCount) OVER (), 1) AS "% of Stalls"
                        FROM buckets
                        ORDER BY totalMs DESC
                        """,
                    "jvmlog_alloc_stall")
                    .description("Histogram of allocation stall durations — entries in the '>=500ms' bucket mean application threads were blocked for half a second waiting for GC, which will manifest as severe latency spikes in your SLA metrics."),

                    new View(
                    "jvmlog-gc-wall-vs-concurrent", "jvmlog",
                    "GC Log: GC Wall Time vs Concurrent Phase Time per Cycle", null,
                    """
                        CREATE VIEW "jvmlog-gc-wall-vs-concurrent" AS
                        WITH concurrent AS (
                            SELECT gcId,
                                   sum(durationMs) AS concurrentMs
                            FROM jvmlog_gc_phase
                            GROUP BY gcId
                        ),
                        pauses AS (
                            SELECT gcId,
                                   sum(pauseMs)    AS stwMs,
                                   min(uptimeSecs) AS startSecs,
                                   max(uptimeSecs) AS endSecs
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                            GROUP BY gcId
                        )
                        SELECT p.gcId                                                              AS "GC ID",
                               round(p.startSecs, 2)                                              AS "Start (s)",
                               round(p.stwMs, 2)                                                  AS "STW (ms)",
                               round(c.concurrentMs, 1)                                           AS "Concurrent (ms)",
                               round(p.stwMs + c.concurrentMs, 1)                                AS "Total Work (ms)",
                               round(p.stwMs * 100.0 / nullif(p.stwMs + c.concurrentMs, 0), 1)   AS "STW Fraction (%)"
                        FROM pauses p
                        JOIN concurrent c USING (gcId)
                        ORDER BY p.gcId
                        """,
                    "jvmlog_gc_event", "jvmlog_gc_phase")
                    .description("Per-cycle split between STW pause and concurrent phase work — STW fraction above 20% for ZGC/Shenandoah indicates the concurrent phase is not completing before space pressure forces a stop-the-world fallback.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-gc-wall-vs-concurrent" AS
                        SELECT gcId                                                   AS "GC ID",
                               round(sum(pauseMs), 2)                               AS "STW (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL
                        GROUP BY gcId
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_event"),

                    new View(
                    "jvmlog-full-gc-interval", "jvmlog",
                    "GC Log: Time Between Full GCs", null,
                    """
                        CREATE VIEW "jvmlog-full-gc-interval" AS
                        WITH fulls AS (
                            SELECT gcId,
                                   uptimeSecs,
                                   ROW_NUMBER() OVER (ORDER BY uptimeSecs) AS rn
                            FROM jvmlog_gc_event
                            WHERE gcType = 'Full'
                        )
                        SELECT a.gcId                                                          AS "GC ID",
                               round(a.uptimeSecs, 1)                                         AS "Uptime (s)",
                               round(a.uptimeSecs - b.uptimeSecs, 1)                          AS "Since Last Full GC (s)",
                               round((a.uptimeSecs - b.uptimeSecs) / 60.0, 2)                 AS "Interval (min)"
                        FROM fulls a
                        JOIN fulls b ON a.rn = b.rn + 1
                        ORDER BY a.gcId
                        """,
                    "jvmlog_gc_event")
                    .description("Time between consecutive Full GC events — a decreasing interval means Full GC is happening more and more frequently, which is a precursor to OutOfMemoryError; use this to set a baseline and alert when interval drops below your threshold."),

                    // Batch 10
                    new View(
                    "jvmlog-gc-start-of-trouble", "jvmlog",
                    "GC Log: First Occurrence of Each GC Cause", null,
                    """
                        CREATE VIEW "jvmlog-gc-start-of-trouble" AS
                        SELECT cause                                                AS "Cause",
                               min(uptimeSecs)                                     AS "First Seen (s)",
                               round(min(uptimeSecs) / 60.0, 2)                   AS "First Seen (min)",
                               count(*)                                            AS "Total Events",
                               round(max(pauseMs), 2)                             AS "Worst Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE cause IS NOT NULL
                        GROUP BY cause
                        ORDER BY "First Seen (s)"
                        """,
                    "jvmlog_gc_event")
                    .description("First GC event per cause with total event count and worst pause — the 'First Seen' column shows when each GC cause first appeared in the log; a cause that first appears late in the run indicates a state transition (e.g., heap growth, class loading spike)."),

                    new View(
                    "jvmlog-safepoint-gc-split", "jvmlog",
                    "GC Log: Safepoint STW Time — GC vs Non-GC Operations", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-gc-split" AS
                        SELECT CASE WHEN lower(operation) LIKE '%collect%'
                                      OR lower(operation) LIKE '%gc%'
                                      OR lower(operation) LIKE '%evacuation%'
                                      OR lower(operation) LIKE '%concurrent%mark%'
                                    THEN 'GC-triggered'
                                    ELSE 'Non-GC' END                              AS "Category",
                               count(*)                                            AS "Count",
                               round(sum(totalMs), 1)                             AS "Total STW (ms)",
                               round(avg(totalMs), 2)                             AS "Avg STW (ms)",
                               round(max(totalMs), 2)                             AS "Max STW (ms)"
                        FROM jvmlog_safepoint
                        WHERE operation IS NOT NULL
                        GROUP BY 1
                        ORDER BY "Total STW (ms)" DESC
                        """,
                    "jvmlog_safepoint")
                    .description("STW time attributed to GC-triggered vs non-GC safepoints — high Non-GC STW time means class unloading, deoptimization, or JIT-related operations are competing with GC for stop-the-world time."),

                    new View(
                    "jvmlog-metaspace-oom-proximity", "jvmlog",
                    "GC Log: Metaspace OOM Proximity (% of committed vs limit)", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-oom-proximity" AS
                        WITH latest AS (
                            SELECT gcId,
                                   metaspaceAfter,
                                   metaspaceCommitted,
                                   ROW_NUMBER() OVER (ORDER BY gcId DESC) AS rn
                            FROM jvmlog_metaspace
                            WHERE metaspaceAfter IS NOT NULL
                        ),
                        trend AS (
                            SELECT avg(metaspaceAfter) FILTER (WHERE rn <= 5)   AS recentAvg,
                                   avg(metaspaceAfter) FILTER (WHERE rn > 5)    AS earlierAvg,
                                   max(metaspaceCommitted)                       AS maxCommitted,
                                   max(metaspaceAfter)                           AS peakUsed
                            FROM latest
                        )
                        SELECT round(peakUsed / 1048576.0, 1)                          AS "Peak Used (MB)",
                               round(maxCommitted / 1048576.0, 1)                      AS "Max Committed (MB)",
                               round(peakUsed * 100.0 / nullif(maxCommitted, 0), 1)    AS "Peak Used % of Committed",
                               round(recentAvg / 1048576.0, 1)                         AS "Recent Avg (MB)",
                               round((recentAvg - earlierAvg) / 1048576.0, 2)          AS "Growth Trend (MB)",
                               CASE WHEN peakUsed * 100.0 / nullif(maxCommitted, 0) > 90 THEN 'Critical'
                                    WHEN peakUsed * 100.0 / nullif(maxCommitted, 0) > 75 THEN 'Warning'
                                    ELSE 'OK' END                                       AS "Status"
                        FROM trend
                        """,
                    "jvmlog_metaspace")
                    .description("Metaspace usage proximity to committed limit — Critical (>90%) means the next class loading spike may trigger Metaspace OOM; growth trend > 0 means ongoing class loading is consuming metaspace."),

                    new View(
                    "jvmlog-gc-cause-first-last", "jvmlog",
                    "GC Log: GC Cause Timeline — First, Last, Count per Cause", null,
                    """
                        CREATE VIEW "jvmlog-gc-cause-first-last" AS
                        SELECT cause                                                AS "Cause",
                               count(*)                                            AS "Count",
                               round(min(uptimeSecs), 1)                          AS "First (s)",
                               round(max(uptimeSecs), 1)                          AS "Last (s)",
                               round(max(uptimeSecs) - min(uptimeSecs), 1)        AS "Active Window (s)",
                               round(avg(pauseMs), 2)                             AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)                             AS "Max Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE cause IS NOT NULL AND pauseMs IS NOT NULL
                        GROUP BY cause
                        ORDER BY "Count" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Per-cause GC summary with temporal extent — 'Active Window' shows how long a cause was actively triggering GC; causes with short windows and high counts indicate burst patterns."),

                    new View(
                    "jvmlog-zgc-allocation-rate-trend", "jvmlog",
                    "GC Log: ZGC Allocation Rate Trend Over Time", null,
                    """
                        CREATE VIEW "jvmlog-zgc-allocation-rate-trend" AS
                        SELECT gcId                                                    AS "GC ID",
                               round(allocRateMbps, 2)                                AS "Alloc Rate (MB/s)",
                               round(load1s, 2)                                       AS "Load 1s",
                               allocStalls                                            AS "Alloc Stalls",
                               CASE WHEN allocRateMbps > 500 THEN 'Critical'
                                    WHEN allocRateMbps > 200 THEN 'High'
                                    WHEN allocRateMbps > 50  THEN 'Moderate'
                                    ELSE 'Low' END                                    AS "Pressure"
                        FROM jvmlog_zgc_load
                        ORDER BY gcId
                        """,
                    "jvmlog_zgc_load")
                    .description("ZGC allocation rate per cycle with system load — Critical (>500 MB/s) allocation rate means ZGC cannot collect fast enough; correlate with alloc stall count to confirm backpressure."),

                    // Batch 11
                    new View(
                    "jvmlog-gc-errors-timeline", "jvmlog",
                    "GC Log: GC Error Events Timeline", null,
                    """
                        CREATE VIEW "jvmlog-gc-errors-timeline" AS
                        SELECT gcId                                                   AS "GC ID",
                               errorType                                              AS "Error Type",
                               round(durationMs, 2)                                  AS "Duration (ms)",
                               errorDetail                                            AS "Detail"
                        FROM jvmlog_gc_errors
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_errors")
                    .description("Chronological list of GC error events (evacuation failures, to-space exhaustion, OOM, degenerated GC) — any entry here represents a serious GC health problem that will have caused application pauses or failures."),

                    new View(
                    "jvmlog-shenandoah-free-headroom", "jvmlog",
                    "GC Log: Shenandoah Free Heap and Headroom per Cycle", null,
                    """
                        CREATE VIEW "jvmlog-shenandoah-free-headroom" AS
                        SELECT gcId                                                    AS "GC ID",
                               round(freeBytes / 1048576.0, 1)                        AS "Free (MB)",
                               freeRegions                                            AS "Free Regions",
                               round(headroomBytes / 1048576.0, 1)                   AS "Headroom (MB)",
                               round(uncommittedBytes / 1048576.0, 1)                AS "Uncommitted (MB)"
                        FROM jvmlog_shenandoah_free
                        WHERE freeBytes IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_shenandoah_free")
                    .description("Shenandoah per-cycle free heap and headroom — headroom dropping toward 0 means Shenandoah is running out of room to complete concurrent evacuation; this precedes Degenerated GC fallback."),

                    new View(
                    "jvmlog-g1-concurrent-phase-summary", "jvmlog",
                    "GC Log: G1 Concurrent Phase Summary (cycle, mark-from-roots, rebuild)", null,
                    """
                        CREATE VIEW "jvmlog-g1-concurrent-phase-summary" AS
                        SELECT phaseName                                               AS "Phase",
                               count(*)                                               AS "Count",
                               round(avg(durationMs), 2)                             AS "Avg (ms)",
                               round(max(durationMs), 2)                             AS "Max (ms)",
                               sum(CASE WHEN phaseName = 'Concurrent Mark Abort' THEN 1 ELSE 0 END) AS "Aborts"
                        FROM jvmlog_gc_phase
                        WHERE phaseName IN ('Concurrent Cycle', 'Concurrent Mark from Roots',
                                            'Concurrent Mark Abort', 'Concurrent Rebuild Remembered Sets',
                                            'Concurrent Cleanup for Next Mark')
                        GROUP BY phaseName
                        ORDER BY "Avg (ms)" DESC
                        """,
                    "jvmlog_gc_phase")
                    .description("G1 concurrent phase statistics — non-zero 'Aborts' for Concurrent Mark means mixed GC was triggered before marking completed (allocation outpaced marking); long 'Concurrent Rebuild Remembered Sets' indicates a large old-gen live set."),

                    new View(
                    "jvmlog-metaspace-class-space-trend", "jvmlog",
                    "GC Log: Metaspace and Class Space per GC", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-class-space-trend" AS
                        SELECT gcId                                                    AS "GC ID",
                               round(metaspaceBefore / 1048576.0, 2)                  AS "Meta Before (MB)",
                               round(metaspaceAfter  / 1048576.0, 2)                  AS "Meta After (MB)",
                               round(metaspaceCommitted / 1048576.0, 2)               AS "Committed (MB)",
                               round((metaspaceAfter - metaspaceBefore) / 1048576.0, 3) AS "Delta (MB)"
                        FROM jvmlog_metaspace
                        WHERE metaspaceBefore IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_metaspace")
                    .description("Per-GC metaspace usage before/after collection — a positive delta every GC means class loading is continuous; a large drop after a specific GC means class unloading triggered; monitor Committed against MaxMetaspaceSize."),

                    new View(
                    "jvmlog-gc-error-by-type-timeline", "jvmlog",
                    "GC Log: GC Error Count per 5-min Window", null,
                    """
                        CREATE VIEW "jvmlog-gc-error-by-type-timeline" AS
                        WITH err_with_uptime AS (
                            SELECT e.gcId,
                                   e.errorType,
                                   g.uptimeSecs
                            FROM jvmlog_gc_errors e
                            LEFT JOIN (
                                SELECT gcId, min(uptimeSecs) AS uptimeSecs
                                FROM jvmlog_gc_event
                                GROUP BY gcId
                            ) g USING (gcId)
                        ),
                        buckets AS (
                            SELECT floor(uptimeSecs / 300) * 300         AS bucketSecs,
                                   errorType,
                                   count(*)                              AS errorCount
                            FROM err_with_uptime
                            WHERE uptimeSecs IS NOT NULL
                            GROUP BY 1, 2
                        )
                        SELECT round(bucketSecs / 60.0, 1)               AS "Uptime (min)",
                               errorType                                  AS "Error Type",
                               errorCount                                 AS "Count"
                        FROM buckets
                        ORDER BY bucketSecs, "Error Type"
                        """,
                    "jvmlog_gc_errors", "jvmlog_gc_event")
                    .description("GC error frequency per 5-minute window — clustering of errors in time means a specific load spike or heap state caused repeated failures; isolated errors are less severe than sustained error bursts.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-gc-error-by-type-timeline" AS
                        SELECT errorType                                  AS "Error Type",
                               count(*)                                  AS "Count"
                        FROM jvmlog_gc_errors
                        GROUP BY errorType
                        ORDER BY "Count" DESC
                        """,
                    "jvmlog_gc_errors"),

                    // Batch 12
                    new View(
                    "jvmlog-heap-growth-rate", "jvmlog",
                    "GC Log: Heap Live Set Growth (Post-GC Heap Regression)", null,
                    """
                        CREATE VIEW "jvmlog-heap-growth-rate" AS
                        WITH data AS (
                            SELECT e.gcId                                          AS gcId,
                                   e.uptimeSecs                                   AS x,
                                   h.heapAfter / 1048576.0                        AS y
                            FROM jvmlog_gc_event e
                            JOIN (
                                SELECT gcId, first(heapAfter) AS heapAfter
                                FROM jvmlog_heap_snapshot
                                GROUP BY gcId
                            ) h USING (gcId)
                            WHERE h.heapAfter IS NOT NULL AND e.uptimeSecs IS NOT NULL
                        )
                        SELECT count(*)                                             AS "Sample Count",
                               round(avg(y), 1)                                    AS "Mean Post-GC Heap (MB)",
                               round(regr_slope(y, x), 4)                         AS "Growth Slope (MB/s)",
                               round(regr_r2(y, x), 4)                            AS "R²",
                               round(regr_slope(y, x) * 3600, 1)                  AS "Projected +1h Growth (MB)",
                               CASE WHEN regr_slope(y, x) > 1.0   THEN 'Rapid Growth'
                                    WHEN regr_slope(y, x) > 0.1   THEN 'Slow Growth'
                                    WHEN regr_slope(y, x) < -0.1  THEN 'Shrinking'
                                    ELSE 'Stable' END                              AS "Trend"
                        FROM data
                        """,
                    "jvmlog_gc_event", "jvmlog_heap_snapshot")
                    .description("Linear regression of post-GC heap size — a positive slope means the live set is growing; 'Projected +1h Growth' extrapolates to how much more heap will be needed after one hour if the trend continues. Rapid Growth (>1 MB/s) is a memory leak indicator.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-heap-growth-rate" AS
                        SELECT count(*)                                              AS "Sample Count",
                               round(avg(pauseMs), 2)                              AS "Avg Pause (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL
                        """,
                    "jvmlog_gc_event"),

                    new View(
                    "jvmlog-g1-region-waste", "jvmlog",
                    "GC Log: G1 Region Utilisation — Humongous vs Regular Waste", null,
                    """
                        CREATE VIEW "jvmlog-g1-region-waste" AS
                        SELECT gcId                                                            AS "GC ID",
                               humongousBefore                                                AS "Humongous Regions Before",
                               humongousAfter                                                 AS "Humongous Regions After",
                               (edenBefore + survivorBefore + oldBefore + humongousBefore)   AS "Total Regions Before",
                               (edenAfter  + survivorAfter  + oldAfter  + humongousAfter)    AS "Total Regions After",
                               round(humongousBefore * 100.0 /
                                     nullif(edenBefore + survivorBefore + oldBefore + humongousBefore, 0), 1) AS "Humongous % Before",
                               round(humongousAfter * 100.0 /
                                     nullif(edenAfter + survivorAfter + oldAfter + humongousAfter, 0), 1)     AS "Humongous % After"
                        FROM jvmlog_g1_regions
                        ORDER BY gcId
                        """,
                    "jvmlog_g1_regions")
                    .description("G1 region utilisation showing humongous object regions as a percentage of total — high humongous% means large objects are fragmenting the heap; tune with -XX:G1HeapRegionSize or reduce object sizes to avoid humongous allocation overhead."),

                    new View(
                    "jvmlog-pause-budget-analysis", "jvmlog",
                    "GC Log: Pause Budget Analysis (SLA vs Actual)", null,
                    """
                        CREATE VIEW "jvmlog-pause-budget-analysis" AS
                        WITH sla_targets AS (
                            SELECT 100 AS sla100ms,
                                   200 AS sla200ms,
                                   500 AS sla500ms,
                                   1000 AS sla1000ms
                        ),
                        actual AS (
                            SELECT count(*)                                             AS total,
                                   round(avg(pauseMs), 2)                              AS avgPause,
                                   round(max(pauseMs), 2)                              AS maxPause,
                                   round(approx_quantile(pauseMs, 0.99), 2)           AS p99Pause,
                                   sum(CASE WHEN pauseMs <= 100  THEN 1 ELSE 0 END)   AS within100,
                                   sum(CASE WHEN pauseMs <= 200  THEN 1 ELSE 0 END)   AS within200,
                                   sum(CASE WHEN pauseMs <= 500  THEN 1 ELSE 0 END)   AS within500,
                                   sum(CASE WHEN pauseMs <= 1000 THEN 1 ELSE 0 END)   AS within1000
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                        )
                        SELECT s.sla100ms                                              AS "SLA 100ms Budget",
                               round(a.within100 * 100.0 / a.total, 2)               AS "% Within 100ms",
                               s.sla200ms                                              AS "SLA 200ms Budget",
                               round(a.within200 * 100.0 / a.total, 2)               AS "% Within 200ms",
                               s.sla500ms                                              AS "SLA 500ms Budget",
                               round(a.within500 * 100.0 / a.total, 2)               AS "% Within 500ms",
                               a.avgPause                                              AS "Avg Pause (ms)",
                               a.p99Pause                                             AS "P99 Pause (ms)",
                               a.maxPause                                             AS "Max Pause (ms)"
                        FROM actual a, sla_targets s
                        """,
                    "jvmlog_gc_event")
                    .description("Pause budget analysis: what fraction of GC events fit within 100ms, 200ms, and 500ms pause SLA targets. P99 above your SLA target means 1% of requests will miss the deadline."),

                    new View(
                    "jvmlog-gc-overhead-by-type", "jvmlog",
                    "GC Log: GC Overhead Contribution by Collector Type", null,
                    """
                        CREATE VIEW "jvmlog-gc-overhead-by-type" AS
                        SELECT gcType                                                  AS "GC Type",
                               count(*)                                               AS "Events",
                               round(sum(pauseMs), 1)                                AS "Total STW (ms)",
                               round(avg(pauseMs), 2)                                AS "Avg STW (ms)",
                               round(sum(pauseMs) * 100.0 /
                                     nullif(sum(sum(pauseMs)) OVER (), 0), 2)        AS "% of Total STW"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL
                        GROUP BY gcType
                        ORDER BY "Total STW (ms)" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("STW pause time contribution per GC type as a percentage of total — Full GC taking > 20% of total STW time is a red flag; Young GC taking > 80% is normal for generational collectors."),

                    new View(
                    "jvmlog-survivor-to-old-rate", "jvmlog",
                    "GC Log: Survivor→Old Promotion Rate (G1 region-based)", null,
                    """
                        CREATE VIEW "jvmlog-survivor-to-old-rate" AS
                        WITH regions AS (
                            SELECT gcId,
                                   survivorBefore,
                                   survivorAfter,
                                   oldBefore,
                                   oldAfter,
                                   ROW_NUMBER() OVER (ORDER BY gcId) AS rn
                            FROM jvmlog_g1_regions
                        )
                        SELECT r.gcId                                                              AS "GC ID",
                               r.survivorBefore                                                   AS "Survivor Before",
                               r.survivorAfter                                                    AS "Survivor After",
                               r.oldAfter - r.oldBefore                                           AS "Old Growth (regions)",
                               round((r.oldAfter - r.oldBefore) * 100.0 /
                                     nullif(r.survivorBefore + r.oldBefore, 0), 1)                AS "Promoted % of Live"
                        FROM regions r
                        WHERE r.survivorBefore IS NOT NULL
                          AND r.oldAfter IS NOT NULL
                        ORDER BY r.gcId
                        """,
                    "jvmlog_g1_regions")
                    .description("Per-GC G1 old generation growth from survivor promotion — high 'Promoted % of Live' means objects are aging quickly; sustained old gen growth without corresponding Full GC suggests premature tenuring, tune with -XX:MaxTenuringThreshold."),

                    // Batch 13
                    new View(
                    "jvmlog-pause-worst-10", "jvmlog",
                    "GC Log: Top 10 Worst GC Pauses with Context", null,
                    """
                        CREATE VIEW "jvmlog-pause-worst-10" AS
                        SELECT gcId                                                   AS "GC ID",
                               gcType                                                 AS "GC Type",
                               cause                                                  AS "Cause",
                               round(uptimeSecs, 1)                                  AS "At (s)",
                               round(pauseMs, 2)                                     AS "Pause (ms)",
                               round(durationMs, 2)                                  AS "Duration (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL
                        ORDER BY pauseMs DESC
                        LIMIT 10
                        """,
                    "jvmlog_gc_event")
                    .description("The 10 worst GC pause events — inspect the cause and time-of-occurrence for each; pauses clustering at the same uptime indicate a load spike; repeated Full GC in the top-10 means the old generation is consistently under pressure."),

                    new View(
                    "jvmlog-safepoint-top-ops", "jvmlog",
                    "GC Log: Top 10 Safepoint Operations by Total STW Time", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-top-ops" AS
                        SELECT operation                                              AS "Operation",
                               count(*)                                              AS "Count",
                               round(sum(totalMs), 1)                               AS "Total STW (ms)",
                               round(avg(totalMs), 2)                               AS "Avg STW (ms)",
                               round(max(totalMs), 2)                               AS "Max STW (ms)",
                               round(avg(syncMs), 2)                                AS "Avg Sync (ms)"
                        FROM jvmlog_safepoint
                        WHERE operation IS NOT NULL
                        GROUP BY operation
                        ORDER BY "Total STW (ms)" DESC
                        LIMIT 10
                        """,
                    "jvmlog_safepoint")
                    .description("Top 10 safepoint operations by total STW time — non-GC operations (RevokeBias, Deoptimize) in the top 10 mean JIT activity is competing for stop-the-world slots; check if tiered compilation is producing excessive deoptimizations."),

                    new View(
                    "jvmlog-worker-utilisation-by-phase", "jvmlog",
                    "GC Log: GC Worker Utilisation by Phase (workers used vs max)", null,
                    """
                        CREATE VIEW "jvmlog-worker-utilisation-by-phase" AS
                        SELECT taskName                                              AS "Task",
                               count(*)                                             AS "Invocations",
                               round(avg(workersUsed), 1)                          AS "Avg Workers Used",
                               max(workersMax)                                      AS "Max Available",
                               round(avg(workersUsed * 100.0 / nullif(workersMax, 0)), 1) AS "Avg Utilisation %",
                               min(workersUsed)                                    AS "Min Used"
                        FROM jvmlog_gc_workers
                        GROUP BY taskName
                        ORDER BY "Avg Utilisation %" ASC
                        """,
                    "jvmlog_gc_workers")
                    .description("Worker thread utilisation per GC task — tasks with Avg Utilisation% below 60% are under-parallelised; check that -XX:ParallelGCThreads is set appropriately for your CPU count."),

                    new View(
                    "jvmlog-gc-pause-interval-correlation", "jvmlog",
                    "GC Log: Pause Duration vs Inter-GC Interval Correlation", null,
                    """
                        CREATE VIEW "jvmlog-gc-pause-interval-correlation" AS
                        WITH intervals AS (
                            SELECT gcId,
                                   gcType,
                                   pauseMs,
                                   uptimeSecs - LAG(uptimeSecs) OVER (ORDER BY uptimeSecs) AS intervalSecs
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        )
                        SELECT gcId                                                    AS "GC ID",
                               gcType                                                  AS "GC Type",
                               round(intervalSecs, 2)                                  AS "Interval (s)",
                               round(pauseMs, 2)                                       AS "Pause (ms)",
                               CASE WHEN intervalSecs < 1.0 THEN 'Burst'
                                    WHEN intervalSecs < 5.0 THEN 'Frequent'
                                    WHEN intervalSecs < 30.0 THEN 'Normal'
                                    ELSE 'Infrequent' END                              AS "Frequency Class"
                        FROM intervals
                        WHERE intervalSecs IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_event")
                    .description("Per-GC pause vs time-since-last-GC — Burst class (< 1s intervals) means back-to-back GC cycles that starve the application; this view helps distinguish high-frequency short pauses from low-frequency long pauses."),

                    new View(
                    "jvmlog-g1-eden-fill-rate", "jvmlog",
                    "GC Log: G1 Eden Region Fill Rate (regions per minute)", null,
                    """
                        CREATE VIEW "jvmlog-g1-eden-fill-rate" AS
                        WITH gc_times AS (
                            SELECT gcId, min(uptimeSecs) AS uptimeSecs
                            FROM jvmlog_gc_event
                            GROUP BY gcId
                        ),
                        gc_with_interval AS (
                            SELECT r.gcId,
                                   t.uptimeSecs,
                                   r.edenBefore,
                                   r.edenAfter,
                                   r.edenMax,
                                   t.uptimeSecs - LAG(t.uptimeSecs) OVER (ORDER BY r.gcId) AS intervalSecs
                            FROM jvmlog_g1_regions r
                            JOIN gc_times t USING (gcId)
                            WHERE r.edenBefore IS NOT NULL
                        )
                        SELECT gcId                                                           AS "GC ID",
                               round(uptimeSecs, 1)                                          AS "Uptime (s)",
                               edenBefore                                                    AS "Eden Before (regions)",
                               edenAfter                                                     AS "Eden After (regions)",
                               edenMax                                                       AS "Eden Max (regions)",
                               round(edenBefore * 100.0 / nullif(edenMax, 0), 1)            AS "Eden Fill %",
                               round(edenBefore / nullif(intervalSecs / 60.0, 0), 1)        AS "Fill Rate (regions/min)"
                        FROM gc_with_interval
                        WHERE intervalSecs IS NOT NULL AND intervalSecs > 0
                        ORDER BY gcId
                        """,
                    "jvmlog_g1_regions", "jvmlog_gc_event")
                    .description("G1 Eden region fill rate — how many Eden regions are filled per minute. A high fill rate with low Eden Max means Eden is too small for the allocation rate; consider increasing -XX:NewSize or allowing G1 to adaptively size Eden.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-g1-eden-fill-rate" AS
                        SELECT gcId                                                           AS "GC ID",
                               edenBefore                                                    AS "Eden Before (regions)",
                               edenAfter                                                     AS "Eden After (regions)",
                               edenMax                                                       AS "Eden Max (regions)",
                               round(edenBefore * 100.0 / nullif(edenMax, 0), 1)            AS "Eden Fill %"
                        FROM jvmlog_g1_regions
                        WHERE edenBefore IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_g1_regions"),

                    // Batch 14
                    new View(
                    "jvmlog-gc-bottleneck-summary", "jvmlog",
                    "GC Log: Primary GC Bottleneck Identification", null,
                    """
                        CREATE VIEW "jvmlog-gc-bottleneck-summary" AS
                        WITH stats AS (
                            SELECT count(*)                                                    AS totalGCs,
                                   sum(CASE WHEN gcType = 'Full' THEN 1 ELSE 0 END)           AS fullGCs,
                                   round(avg(pauseMs), 2)                                     AS avgPause,
                                   round(approx_quantile(pauseMs, 0.99), 2)                  AS p99Pause,
                                   round(sum(pauseMs) / nullif(max(uptimeSecs) * 10.0, 0), 2) AS overheadPct,
                                   round(count(*) / nullif(max(uptimeSecs) / 60.0, 0), 2)    AS gcPerMin
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL AND uptimeSecs > 0
                        )
                        SELECT CASE WHEN fullGCs > 0 AND fullGCs * 1.0 / totalGCs > 0.05 THEN 'Too Many Full GCs'
                                    WHEN overheadPct >= 10 THEN 'GC Overhead Too High'
                                    WHEN p99Pause >= 500 THEN 'P99 Pause Violates SLA'
                                    WHEN gcPerMin > 10 THEN 'GC Frequency Too High'
                                    WHEN avgPause >= 200 THEN 'Average Pause Too High'
                                    ELSE 'No Obvious Bottleneck' END                         AS "Primary Bottleneck",
                               totalGCs                                                       AS "Total GCs",
                               fullGCs                                                        AS "Full GCs",
                               avgPause                                                       AS "Avg Pause (ms)",
                               p99Pause                                                       AS "P99 Pause (ms)",
                               overheadPct                                                    AS "Overhead %",
                               gcPerMin                                                       AS "GC/min"
                        FROM stats
                        """,
                    "jvmlog_gc_event")
                    .description("Automated GC bottleneck identification — evaluates Full GC ratio, overhead%, P99 pause, GC frequency, and average pause to identify the primary problem category. Use as a quick triage starting point."),

                    new View(
                    "jvmlog-pause-p99-rolling", "jvmlog",
                    "GC Log: Rolling P99 Pause Time (window of 50 GCs)", null,
                    """
                        CREATE VIEW "jvmlog-pause-p99-rolling" AS
                        SELECT gcId                                                              AS "GC ID",
                               round(uptimeSecs, 1)                                             AS "Uptime (s)",
                               round(pauseMs, 2)                                                AS "Pause (ms)",
                               round(approx_quantile(pauseMs, 0.99)
                                         OVER (ORDER BY gcId ROWS BETWEEN 49 PRECEDING AND CURRENT ROW), 2) AS "Rolling P99 (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_event")
                    .description("Rolling P99 pause time over a 50-GC window — a rising Rolling P99 indicates systematic pause degradation; a sudden jump means an episodic change in GC behaviour (heap resizing, class unloading, workload change)."),

                    new View(
                    "jvmlog-alloc-stall-gc-phase", "jvmlog",
                    "GC Log: Allocation Stalls Correlated with Concurrent GC Phases", null,
                    """
                        CREATE VIEW "jvmlog-alloc-stall-gc-phase" AS
                        SELECT s.gcId                                                          AS "GC ID",
                               p.phaseName                                                    AS "Concurrent Phase",
                               round(p.durationMs, 1)                                        AS "Phase Duration (ms)",
                               count(s.threadName)                                           AS "Stalls",
                               round(sum(s.stallMs), 2)                                      AS "Total Stall (ms)",
                               round(sum(s.stallMs) / nullif(p.durationMs, 0) * 100, 1)     AS "Stall % of Phase"
                        FROM jvmlog_alloc_stall s
                        JOIN (
                            SELECT gcId, phaseName, sum(durationMs) AS durationMs
                            FROM jvmlog_gc_phase
                            GROUP BY gcId, phaseName
                        ) p USING (gcId)
                        GROUP BY s.gcId, p.phaseName, p.durationMs
                        ORDER BY "Total Stall (ms)" DESC
                        """,
                    "jvmlog_alloc_stall", "jvmlog_gc_phase")
                    .description("Allocation stalls matched to the concurrent GC phase running at the same GC ID — phases with 'Stall % of Phase' > 10% are causing application threads to block during concurrent work; this indicates concurrent phase throughput is insufficient.")
                    .addAlternative(
                    """
                        CREATE VIEW "jvmlog-alloc-stall-gc-phase" AS
                        SELECT gcId                                                            AS "GC ID",
                               count(*)                                                       AS "Stall Count",
                               round(sum(stallMs), 2)                                        AS "Total Stall (ms)"
                        FROM jvmlog_alloc_stall
                        GROUP BY gcId
                        ORDER BY "Total Stall (ms)" DESC
                        """,
                    "jvmlog_alloc_stall"),

                    new View(
                    "jvmlog-zgc-capacity-trend", "jvmlog",
                    "GC Log: ZGC Heap Capacity vs Usage at Mark Start", null,
                    """
                        CREATE VIEW "jvmlog-zgc-capacity-trend" AS
                        WITH mark_start AS (
                            SELECT gcId,
                                   usedBytes
                            FROM jvmlog_zgc_stats
                            WHERE phase = 'Mark Start'
                        ),
                        gc_events AS (
                            SELECT gcId,
                                   max(pauseMs) AS maxPauseMs
                            FROM jvmlog_gc_event
                            GROUP BY gcId
                        )
                        SELECT m.gcId                                                               AS "GC ID",
                               round(m.usedBytes / 1048576.0, 1)                                  AS "Used at Mark Start (MB)",
                               round(regr_slope(m.usedBytes / 1048576.0, m.gcId)
                                     OVER (ORDER BY m.gcId ROWS BETWEEN 9 PRECEDING AND CURRENT ROW), 2) AS "10-Cycle Growth (MB/cycle)",
                               CASE WHEN m.usedBytes > LAG(m.usedBytes, 1) OVER (ORDER BY m.gcId)
                                    THEN 'Growing' ELSE 'Stable' END                               AS "Trend"
                        FROM mark_start m
                        ORDER BY m.gcId
                        """,
                    "jvmlog_zgc_stats")
                    .description("ZGC heap usage at Mark Start per cycle with 10-cycle growth slope — a positive slope means the live set is accumulating faster than ZGC can reclaim; watch for the 'Growing' trend persisting for more than 5 consecutive cycles."),

                    new View(
                    "jvmlog-gc-pause-sla-by-cause", "jvmlog",
                    "GC Log: Pause SLA Compliance Broken Down by Cause", null,
                    """
                        CREATE VIEW "jvmlog-gc-pause-sla-by-cause" AS
                        SELECT cause                                                            AS "Cause",
                               count(*)                                                        AS "Total",
                               sum(CASE WHEN pauseMs <= 100  THEN 1 ELSE 0 END)              AS "<=100ms",
                               sum(CASE WHEN pauseMs <= 200  THEN 1 ELSE 0 END)              AS "<=200ms",
                               sum(CASE WHEN pauseMs <= 500  THEN 1 ELSE 0 END)              AS "<=500ms",
                               round(sum(CASE WHEN pauseMs <= 200 THEN 1 ELSE 0 END) * 100.0 / count(*), 1) AS "200ms SLA %",
                               round(max(pauseMs), 2)                                         AS "Max (ms)",
                               round(approx_quantile(pauseMs, 0.99), 2)                      AS "P99 (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND cause IS NOT NULL
                        GROUP BY cause
                        ORDER BY "200ms SLA %" ASC
                        """,
                    "jvmlog_gc_event")
                    .description("Pause SLA compliance per trigger cause — causes with the lowest '200ms SLA %' are the ones most likely to breach your latency budget; these are the highest-priority targets for GC tuning."),

            // ── Batch 15 ──────────────────────────────────────────────────────────────

            // GCViewer-style: heap footprint report — min/max/avg heap after GC, committed range
            new View(
                    "jvmlog-heap-footprint-report", "jvmlog",
                    "GC Log: Heap Footprint Report (GCViewer-style)", null,
                    """
                        CREATE VIEW "jvmlog-heap-footprint-report" AS
                        SELECT round(min(heapAfter)  / 1048576.0, 1)            AS "Min After-GC Heap (MB)",
                               round(max(heapAfter)  / 1048576.0, 1)            AS "Max After-GC Heap (MB)",
                               round(avg(heapAfter)  / 1048576.0, 1)            AS "Avg After-GC Heap (MB)",
                               round(min(heapBefore) / 1048576.0, 1)            AS "Min Before-GC Heap (MB)",
                               round(max(heapBefore) / 1048576.0, 1)            AS "Max Before-GC Heap (MB)",
                               round(avg(heapBefore) / 1048576.0, 1)            AS "Avg Before-GC Heap (MB)",
                               round(min(heapCommittedAfter) / 1048576.0, 1)    AS "Min Committed (MB)",
                               round(max(heapCommittedAfter) / 1048576.0, 1)    AS "Max Committed (MB)",
                               round(avg(heapBefore - heapAfter) / 1048576.0, 1) AS "Avg Reclaimed per GC (MB)"
                        FROM jvmlog_heap_snapshot
                        WHERE heapAfter IS NOT NULL AND heapBefore IS NOT NULL
                        """,
                    "jvmlog_heap_snapshot")
                    .description("GCViewer-style heap footprint summary — min/max/avg heap before and after collection, committed range, and average reclaimed per cycle."),

            // Pause distribution histogram — bucket pause times into 0-10ms, 10-50ms, 50-100ms, 100-200ms, 200-500ms, 500ms+
            new View(
                    "jvmlog-pause-distribution-histogram", "jvmlog",
                    "GC Log: Pause Duration Distribution Histogram", null,
                    """
                        CREATE VIEW "jvmlog-pause-distribution-histogram" AS
                        SELECT bucket                                            AS "Pause Bucket",
                               count(*)                                         AS "Count",
                               round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS "% of Total",
                               round(avg(pauseMs), 2)                          AS "Avg in Bucket (ms)",
                               round(max(pauseMs), 2)                          AS "Max in Bucket (ms)"
                        FROM (
                            SELECT pauseMs,
                                   CASE WHEN pauseMs <  10  THEN '1: 0–10 ms'
                                        WHEN pauseMs <  50  THEN '2: 10–50 ms'
                                        WHEN pauseMs <  100 THEN '3: 50–100 ms'
                                        WHEN pauseMs <  200 THEN '4: 100–200 ms'
                                        WHEN pauseMs <  500 THEN '5: 200–500 ms'
                                        ELSE                     '6: 500+ ms'
                                   END AS bucket
                            FROM jvmlog_gc_event
                            WHERE pauseMs IS NOT NULL
                        ) t
                        GROUP BY bucket
                        ORDER BY bucket
                        """,
                    "jvmlog_gc_event")
                    .description("Pause duration distribution as a histogram — shows how many GCs land in each latency band; the 500ms+ bucket should be empty for well-tuned applications."),

            // Allocation stall thread hotspots — which application threads are stalling most
            new View(
                    "jvmlog-alloc-stall-thread-hotspots", "jvmlog",
                    "GC Log: Allocation Stall Hotspot Threads", null,
                    """
                        CREATE VIEW "jvmlog-alloc-stall-thread-hotspots" AS
                        SELECT threadName                                        AS "Thread",
                               count(*)                                         AS "Stall Events",
                               round(sum(stallMs), 2)                          AS "Total Stall (ms)",
                               round(avg(stallMs), 2)                          AS "Avg Stall (ms)",
                               round(max(stallMs), 2)                          AS "Max Stall (ms)",
                               round(sum(stallMs) * 100.0 /
                                     sum(sum(stallMs)) OVER (), 1)             AS "% of All Stalls"
                        FROM jvmlog_alloc_stall
                        WHERE stallMs IS NOT NULL
                        GROUP BY threadName
                        ORDER BY "Total Stall (ms)" DESC
                        """,
                    "jvmlog_alloc_stall")
                    .description("Application threads ranked by total allocation stall time — the top threads are the most impacted by GC backpressure; they are prime candidates for allocation profiling."),

            // GC pause coefficient of variation by GC type — consistency metric
            new View(
                    "jvmlog-pause-consistency-by-type", "jvmlog",
                    "GC Log: GC Pause Consistency (Coefficient of Variation) by Type", null,
                    """
                        CREATE VIEW "jvmlog-pause-consistency-by-type" AS
                        SELECT gcType                                            AS "GC Type",
                               count(*)                                         AS "Events",
                               round(avg(pauseMs), 2)                          AS "Avg Pause (ms)",
                               round(stddev_pop(pauseMs), 2)                   AS "StdDev (ms)",
                               round(stddev_pop(pauseMs) / nullif(avg(pauseMs), 0) * 100, 1) AS "CV %",
                               round(approx_quantile(pauseMs, 0.25), 2)        AS "P25 (ms)",
                               round(approx_quantile(pauseMs, 0.75), 2)        AS "P75 (ms)",
                               round(approx_quantile(pauseMs, 0.99), 2)        AS "P99 (ms)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND gcType IS NOT NULL
                        GROUP BY gcType
                        ORDER BY "CV %" DESC
                        """,
                    "jvmlog_gc_event")
                    .description("Pause consistency per GC type — coefficient of variation (CV%) measures predictability; high CV% means highly variable pauses that are hard to SLA-bound; low CV% means consistent, predictable pauses."),

            // GC type mix over time — shows how Young/Mixed/Full ratio shifts as heap pressure rises
            new View(
                    "jvmlog-gc-type-timeline", "jvmlog",
                    "GC Log: GC Type Mix Timeline", null,
                    """
                        CREATE VIEW "jvmlog-gc-type-timeline" AS
                        SELECT gcId                                              AS "GC ID",
                               round(uptimeSecs, 1)                            AS "Uptime (s)",
                               gcType                                          AS "GC Type",
                               round(pauseMs, 2)                               AS "Pause (ms)",
                               count(gcType) OVER (
                                   PARTITION BY gcType
                                   ORDER BY gcId
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                               )                                               AS "Cumulative Count"
                        FROM jvmlog_gc_event
                        WHERE gcType IS NOT NULL AND uptimeSecs IS NOT NULL
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_event")
                    .description("Per-GC type timeline with cumulative counts — as heap pressure builds, the cumulative Full GC line rises steeply; use to see the inflection point where the GC strategy shifted."),

            // ── Batch 16 ──────────────────────────────────────────────────────────────

            // GC event density by 10-second time window — JVM Mon-style heatmap source data
            new View(
                    "jvmlog-gc-event-density", "jvmlog",
                    "GC Log: GC Event Density per 10-second Window", null,
                    """
                        CREATE VIEW "jvmlog-gc-event-density" AS
                        SELECT floor(uptimeSecs / 10) * 10                     AS "Window Start (s)",
                               count(*)                                        AS "GC Count",
                               sum(CASE WHEN gcType = 'Full' THEN 1 ELSE 0 END) AS "Full GC Count",
                               round(sum(pauseMs), 2)                         AS "Total Pause (ms)",
                               round(avg(pauseMs), 2)                         AS "Avg Pause (ms)",
                               round(max(pauseMs), 2)                         AS "Max Pause (ms)",
                               round(sum(pauseMs) / (10.0 * 1000) * 100, 2)  AS "GC Overhead % (window)"
                        FROM jvmlog_gc_event
                        WHERE pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        GROUP BY floor(uptimeSecs / 10) * 10
                        ORDER BY "Window Start (s)"
                        """,
                    "jvmlog_gc_event")
                    .description("GC event density in 10-second windows — JVM Mon-style time-series source; windows with GC overhead > 10% or multiple Full GCs are hot spots requiring immediate investigation."),

            // Shenandoah uncommitted memory trend — how much memory Shenandoah is returning to OS over time
            new View(
                    "jvmlog-shenandoah-uncommit-trend", "jvmlog",
                    "GC Log: Shenandoah Memory Uncommit Trend", null,
                    """
                        CREATE VIEW "jvmlog-shenandoah-uncommit-trend" AS
                        SELECT gcId                                             AS "GC ID",
                               round(freeBytes / 1048576.0, 1)                AS "Free (MB)",
                               round(headroomBytes / 1048576.0, 1)            AS "Headroom (MB)",
                               round(uncommittedBytes / 1048576.0, 1)         AS "Uncommitted (MB)",
                               round(uncommittedBytes - LAG(uncommittedBytes, 1, uncommittedBytes) OVER (ORDER BY gcId), 0) / 1048576.0 AS "Delta Uncommitted (MB)"
                        FROM jvmlog_shenandoah_free
                        ORDER BY gcId
                        """,
                    "jvmlog_shenandoah_free")
                    .description("Shenandoah uncommit trend — positive delta uncommitted means Shenandoah is actively returning pages to the OS; if uncommitted stays at 0 across all cycles, the heap is under constant pressure and memory is never released."),

            // ZGC MMU (Minimum Mutator Utilization) approximation — % of each 200ms slice that was NOT in GC
            new View(
                    "jvmlog-zgc-mmu-approximation", "jvmlog",
                    "GC Log: ZGC Minimum Mutator Utilisation (Approximation)", null,
                    """
                        CREATE VIEW "jvmlog-zgc-mmu-approximation" AS
                        WITH phase_windows AS (
                            SELECT gcId,
                                   sum(durationMs) AS totalPhaseDurationMs
                            FROM jvmlog_gc_phase
                            GROUP BY gcId
                        ),
                        gc_with_phase AS (
                            SELECT e.gcId,
                                   round(e.uptimeSecs, 1) AS uptimeSecs,
                                   e.pauseMs,
                                   p.totalPhaseDurationMs
                            FROM jvmlog_gc_event e
                            JOIN phase_windows p USING (gcId)
                            WHERE e.uptimeSecs IS NOT NULL
                        )
                        SELECT gcId                                             AS "GC ID",
                               uptimeSecs                                      AS "Uptime (s)",
                               round(pauseMs, 2)                               AS "STW Pause (ms)",
                               round(totalPhaseDurationMs, 2)                 AS "Concurrent Phase Total (ms)",
                               round(greatest(0.0, 200.0 - coalesce(pauseMs, 0)) / 200.0 * 100, 1) AS "Approx MMU % (200ms window)"
                        FROM gc_with_phase
                        ORDER BY gcId
                        """,
                    "jvmlog_gc_phase", "jvmlog_gc_event")
                    .addAlternative(
                        """
                        SELECT gcId                                             AS "GC ID",
                               round(uptimeSecs, 1)                           AS "Uptime (s)",
                               round(pauseMs, 2)                               AS "STW Pause (ms)",
                               round(greatest(0.0, 200.0 - coalesce(pauseMs, 0)) / 200.0 * 100, 1) AS "Approx MMU % (200ms window)"
                        FROM jvmlog_gc_event
                        WHERE uptimeSecs IS NOT NULL
                        ORDER BY gcId
                        """,
                        "jvmlog_gc_event")
                    .description("ZGC MMU approximation — minimum mutator utilisation over a 200ms window; values below 95% mean the application was stalled for more than 10ms in a 200ms slice, violating typical low-latency SLOs."),

            // Metaspace growth acceleration — second derivative of metaspace usage (change in growth rate)
            new View(
                    "jvmlog-metaspace-growth-acceleration", "jvmlog",
                    "GC Log: Metaspace Growth Acceleration", null,
                    """
                        CREATE VIEW "jvmlog-metaspace-growth-acceleration" AS
                        WITH base AS (
                            SELECT gcId,
                                   metaspaceAfter,
                                   metaspaceCommitted,
                                   metaspaceAfter - LAG(metaspaceAfter, 1) OVER (ORDER BY gcId) AS delta
                            FROM jvmlog_metaspace
                            WHERE metaspaceAfter IS NOT NULL
                        )
                        SELECT gcId                                             AS "GC ID",
                               round(metaspaceAfter / 1048576.0, 2)           AS "Metaspace After (MB)",
                               round(metaspaceCommitted / 1048576.0, 2)       AS "Committed (MB)",
                               round(delta / 1024.0, 2)                       AS "Delta KB/cycle",
                               round((delta - LAG(delta, 1) OVER (ORDER BY gcId)) / 1024.0, 2) AS "Accel KB/cycle²"
                        FROM base
                        ORDER BY gcId
                        """,
                    "jvmlog_metaspace")
                    .description("Metaspace growth acceleration — positive acceleration (KB/cycle²) means class loading is speeding up; sustained positive acceleration with rising committed size indicates a classloader leak."),

            // Safepoint GC vs non-GC time breakdown — how much of total STW time is due to GC vs other operations
            new View(
                    "jvmlog-safepoint-gc-vs-nongc-stw", "jvmlog",
                    "GC Log: Safepoint STW Time — GC vs Non-GC Breakdown", null,
                    """
                        CREATE VIEW "jvmlog-safepoint-gc-vs-nongc-stw" AS
                        WITH sp AS (
                            SELECT operation,
                                   sum(totalMs) AS totalMs,
                                   count(*) AS events,
                                   CASE WHEN lower(operation) LIKE '%gc%'
                                             OR lower(operation) LIKE '%cleanup%'
                                             OR lower(operation) LIKE '%collect%'
                                        THEN 'GC-related'
                                        ELSE 'Non-GC'
                                   END AS category
                            FROM jvmlog_safepoint
                            WHERE totalMs IS NOT NULL
                            GROUP BY operation
                        )
                        SELECT category                                         AS "Category",
                               count(DISTINCT operation)                       AS "Distinct Operations",
                               sum(events)                                     AS "Total Events",
                               round(sum(totalMs), 2)                         AS "Total STW (ms)",
                               round(sum(totalMs) * 100.0 / sum(sum(totalMs)) OVER (), 1) AS "% of All STW",
                               round(avg(totalMs / events), 2)                AS "Avg per Event (ms)"
                        FROM sp
                        GROUP BY category
                        ORDER BY "Total STW (ms)" DESC
                        """,
                    "jvmlog_safepoint")
                    .description("Safepoint STW breakdown — shows what fraction of total stop-the-world time is caused by GC versus other JVM operations (deoptimisation, class loading, biased lock revocation); high non-GC STW often points to deopt storms."),

            // ── Batch 17 ──────────────────────────────────────────────────────────────

            // G1 humongous allocation detection — GCs triggered by humongous object pressure
            new View(
                    "jvmlog-g1-humongous-objects", "jvmlog",
                    "GC Log: G1 Humongous Object Allocation Pressure", null,
                    """
                        CREATE VIEW "jvmlog-g1-humongous-objects" AS
                        SELECT e.gcId                                           AS "GC ID",
                               round(e.uptimeSecs, 1)                         AS "Uptime (s)",
                               e.cause                                        AS "Cause",
                               round(e.pauseMs, 2)                            AS "Pause (ms)",
                               r.humongousBefore                              AS "Humongous Regions Before",
                               r.humongousAfter                               AS "Humongous Regions After",
                               r.edenMax                                      AS "Eden Max Regions",
                               round(r.humongousBefore * 100.0 /
                                     nullif(r.edenMax + r.humongousBefore, 0), 1) AS "Humongous % of Heap"
                        FROM jvmlog_g1_regions r
                        JOIN jvmlog_gc_event e USING (gcId)
                        WHERE r.humongousBefore > 0
                        ORDER BY r.humongousBefore DESC
                        """,
                    "jvmlog_g1_regions", "jvmlog_gc_event")
                    .addAlternative(
                        """
                        SELECT gcId                                            AS "GC ID",
                               humongousBefore                                AS "Humongous Regions Before",
                               humongousAfter                                 AS "Humongous Regions After",
                               edenMax                                        AS "Eden Max Regions"
                        FROM jvmlog_g1_regions
                        WHERE humongousBefore > 0
                        ORDER BY humongousBefore DESC
                        """,
                        "jvmlog_g1_regions")
                    .description("G1 humongous allocation pressure — GC cycles with non-zero humongous regions; humongous objects bypass Eden and go directly to the old gen region; frequent humongous allocations inflate old gen and trigger expensive mixed GCs."),

            // GC cause shift analysis — how the distribution of GC causes changes over time
            new View(
                    "jvmlog-gc-cause-shift", "jvmlog",
                    "GC Log: GC Cause Distribution Shift Over Time", null,
                    """
                        CREATE VIEW "jvmlog-gc-cause-shift" AS
                        WITH halves AS (
                            SELECT gcId, cause, pauseMs,
                                   uptimeSecs,
                                   CASE WHEN uptimeSecs <= (SELECT max(uptimeSecs) / 2.0 FROM jvmlog_gc_event WHERE uptimeSecs IS NOT NULL)
                                        THEN 'First Half' ELSE 'Second Half' END AS period
                            FROM jvmlog_gc_event
                            WHERE cause IS NOT NULL AND pauseMs IS NOT NULL AND uptimeSecs IS NOT NULL
                        )
                        SELECT cause                                           AS "Cause",
                               period                                         AS "Period",
                               count(*)                                       AS "Count",
                               round(avg(pauseMs), 2)                        AS "Avg Pause (ms)",
                               round(count(*) * 100.0 / sum(count(*)) OVER (PARTITION BY period), 1) AS "% in Period"
                        FROM halves
                        GROUP BY cause, period
                        ORDER BY cause, period
                        """,
                    "jvmlog_gc_event")
                    .description("GC cause shift — compares cause distribution in the first vs second half of the run; if 'Allocation Failure' % rises sharply in the second half, the live data set is growing and heap headroom is shrinking."),

            // GC phase aggregated summary — total and average duration per phase name across all GCs
            new View(
                    "jvmlog-gc-phase-summary", "jvmlog",
                    "GC Log: GC Phase Aggregated Duration Summary", null,
                    """
                        CREATE VIEW "jvmlog-gc-phase-summary" AS
                        SELECT phaseName                                       AS "Phase",
                               count(*)                                       AS "Occurrences",
                               round(sum(durationMs), 2)                     AS "Total (ms)",
                               round(avg(durationMs), 2)                     AS "Avg (ms)",
                               round(approx_quantile(durationMs, 0.50), 2)   AS "P50 (ms)",
                               round(approx_quantile(durationMs, 0.95), 2)   AS "P95 (ms)",
                               round(max(durationMs), 2)                     AS "Max (ms)"
                        FROM jvmlog_gc_phase
                        WHERE durationMs IS NOT NULL
                        GROUP BY phaseName
                        ORDER BY "Total (ms)" DESC
                        """,
                    "jvmlog_gc_phase")
                    .description("GC phase aggregated timing — total and P50/P95/Max per phase; the phase with the highest total time is the dominant cost driver; outlier Max vs P95 ratios indicate occasional phase stalls."),

            // Heap pressure events — GCs where heap before exceeds 80% of committed capacity
            new View(
                    "jvmlog-heap-pressure-events", "jvmlog",
                    "GC Log: High Heap Pressure Events (>80% Committed)", null,
                    """
                        CREATE VIEW "jvmlog-heap-pressure-events" AS
                        SELECT h.gcId                                          AS "GC ID",
                               e.gcType                                       AS "GC Type",
                               e.cause                                        AS "Cause",
                               round(h.heapBefore / 1048576.0, 1)            AS "Heap Before (MB)",
                               round(h.heapCommittedBefore / 1048576.0, 1)   AS "Committed (MB)",
                               round(h.heapBefore * 100.0 /
                                     nullif(h.heapCommittedBefore, 0), 1)    AS "Utilisation %",
                               round(e.pauseMs, 2)                           AS "Pause (ms)",
                               round(e.uptimeSecs, 1)                        AS "Uptime (s)"
                        FROM jvmlog_heap_snapshot h
                        JOIN jvmlog_gc_event e USING (gcId)
                        WHERE h.heapCommittedBefore > 0
                          AND h.heapBefore * 100.0 / h.heapCommittedBefore >= 80
                        ORDER BY "Utilisation %" DESC
                        """,
                    "jvmlog_heap_snapshot", "jvmlog_gc_event")
                    .addAlternative(
                        """
                        SELECT gcId                                            AS "GC ID",
                               round(heapBefore / 1048576.0, 1)              AS "Heap Before (MB)",
                               round(heapCommittedBefore / 1048576.0, 1)     AS "Committed (MB)",
                               round(heapBefore * 100.0 /
                                     nullif(heapCommittedBefore, 0), 1)      AS "Utilisation %"
                        FROM jvmlog_heap_snapshot
                        WHERE heapCommittedBefore > 0
                          AND heapBefore * 100.0 / heapCommittedBefore >= 80
                        ORDER BY "Utilisation %" DESC
                        """,
                        "jvmlog_heap_snapshot")
                    .description("High heap pressure events — GCs where the heap before collection exceeded 80% of committed capacity; repeated high-utilisation events mean the heap is consistently near full and a single large allocation could trigger an OOM."),

            // Worker thread saturation rate — average worker utilisation weighted by phase frequency
            new View(
                    "jvmlog-worker-saturation-rate", "jvmlog",
                    "GC Log: GC Worker Thread Saturation Rate", null,
                    """
                        CREATE VIEW "jvmlog-worker-saturation-rate" AS
                        SELECT taskName                                        AS "Task",
                               count(*)                                       AS "Occurrences",
                               max(workersMax)                                AS "Max Workers Available",
                               round(avg(workersUsed), 1)                    AS "Avg Workers Used",
                               round(avg(workersUsed) * 100.0 /
                                     nullif(max(workersMax), 0), 1)          AS "Avg Saturation %",
                               min(workersUsed)                              AS "Min Workers Used",
                               sum(CASE WHEN workersUsed = workersMax THEN 1 ELSE 0 END) AS "Fully Saturated Runs"
                        FROM jvmlog_gc_workers
                        WHERE workersMax > 0
                        GROUP BY taskName
                        ORDER BY "Avg Saturation %" ASC
                        """,
                    "jvmlog_gc_workers")
                    .description("Worker thread saturation by task — tasks with saturation below 70% are under-utilising available GC threads; increase `-XX:ParallelGCThreads` or investigate why threads are not being assigned to phases."),
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
