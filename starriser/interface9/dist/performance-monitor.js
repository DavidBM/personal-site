/**
 * Performance monitoring for WebGL operations, specifically getProgramInfoLog calls
 * that were causing 28ms delays during hover interactions.
 */
export class PerformanceMonitor {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.logThreshold = options.logThreshold ?? 10; // Log calls taking longer than 10ms
        this.maxRecords = options.maxRecords ?? 100;
        this.records = [];
        this.stats = {
            totalCalls: 0,
            totalTime: 0,
            maxTime: 0,
            minTime: Infinity,
            callsOverThreshold: 0,
        };
        if (this.enabled) {
            this.interceptWebGLCalls();
        }
    }
    interceptWebGLCalls() {
        // Intercept WebGLRenderingContext
        if (typeof WebGLRenderingContext !== "undefined") {
            this.interceptContext(WebGLRenderingContext.prototype);
        }
        // Intercept WebGL2RenderingContext
        if (typeof WebGL2RenderingContext !== "undefined") {
            this.interceptContext(WebGL2RenderingContext.prototype);
        }
    }
    interceptContext(contextPrototype) {
        const originalGetProgramInfoLog = contextPrototype.getProgramInfoLog;
        const monitor = this;
        contextPrototype.getProgramInfoLog = function (program) {
            if (!monitor.enabled) {
                return originalGetProgramInfoLog.call(this, program);
            }
            const startTime = performance.now();
            const result = originalGetProgramInfoLog.call(this, program);
            const endTime = performance.now();
            const duration = endTime - startTime;
            monitor.recordCall(duration, result, new Error().stack);
            return result;
        };
    }
    recordCall(duration, result, stackTrace) {
        this.stats.totalCalls++;
        this.stats.totalTime += duration;
        this.stats.maxTime = Math.max(this.stats.maxTime, duration);
        this.stats.minTime = Math.min(this.stats.minTime, duration);
        if (duration > this.logThreshold) {
            this.stats.callsOverThreshold++;
            const record = {
                timestamp: Date.now(),
                duration: duration.toFixed(2),
                result: result || "(empty)",
                stackTrace: this.parseStackTrace(stackTrace),
            };
            this.records.push(record);
            // Keep only the most recent records
            if (this.records.length > this.maxRecords) {
                this.records.shift();
            }
            console.warn(`[PerformanceMonitor] Slow getProgramInfoLog call: ${duration.toFixed(2)}ms`, {
                result: result,
                stack: record.stackTrace,
            });
        }
    }
    parseStackTrace(stackTrace) {
        if (!stackTrace)
            return "Unknown";
        const lines = stackTrace.split("\n");
        // Find the first line that's not from this monitor or WebGL internals
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes("galaxy") || line.includes("three") || line.includes("THREE")) {
                return line;
            }
        }
        return lines[2] || "Unknown";
    }
    getStats() {
        const avgTime = this.stats.totalCalls > 0 ? this.stats.totalTime / this.stats.totalCalls : 0;
        return {
            ...this.stats,
            averageTime: avgTime.toFixed(2),
            percentageOverThreshold: this.stats.totalCalls > 0
                ? ((this.stats.callsOverThreshold / this.stats.totalCalls) * 100).toFixed(1)
                : "0.0",
        };
    }
    getRecentSlowCalls(count = 10) {
        return this.records.slice(-count);
    }
    printReport() {
        const stats = this.getStats();
        const recentCalls = this.getRecentSlowCalls(5);
        console.group("📊 WebGL Performance Report - getProgramInfoLog");
        console.log("Statistics:", stats);
        if (recentCalls.length > 0) {
            console.log("Recent slow calls:");
            recentCalls.forEach((record, index) => {
                console.log(`  ${index + 1}. ${record.duration}ms - ${record.stackTrace}`);
                if (record.result && record.result !== "(empty)") {
                    console.log(`     Result: ${record.result.substring(0, 100)}...`);
                }
            });
        }
        if (stats.callsOverThreshold > 0) {
            console.warn(`⚠️  ${stats.callsOverThreshold} calls exceeded ${this.logThreshold}ms threshold`);
            console.warn(`⚠️  This indicates potential shader compilation/linking issues`);
        }
        else {
            console.log("✅ All calls were under the threshold - performance looks good!");
        }
        console.groupEnd();
    }
    reset() {
        this.records = [];
        this.stats = {
            totalCalls: 0,
            totalTime: 0,
            maxTime: 0,
            minTime: Infinity,
            callsOverThreshold: 0,
        };
    }
    enable() {
        this.enabled = true;
    }
    disable() {
        this.enabled = false;
    }
}
// Global instance for easy access
export const webglMonitor = new PerformanceMonitor({
    enabled: true,
    logThreshold: 5, // Log anything over 5ms
    maxRecords: 50,
});
// Auto-attach to window for dev tools access
if (typeof window !== "undefined") {
    window.webglMonitor = webglMonitor;
    // Auto-report every 30 seconds if there are slow calls
    setInterval(() => {
        if (webglMonitor.stats.callsOverThreshold > 0) {
            webglMonitor.printReport();
        }
    }, 30000);
    console.log("🔍 WebGL Performance Monitor active. Use window.webglMonitor.printReport() for details.");
}
//# sourceMappingURL=performance-monitor.js.map