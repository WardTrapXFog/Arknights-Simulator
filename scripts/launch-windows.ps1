$ErrorActionPreference = 'Stop'
$launchArguments = @($args)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# The job handle belongs only to this PowerShell process. Windows closes it on
# console shutdown and kills the launcher, server and their descendants.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class SimulatorProcessJob {
    private static IntPtr job;
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static void Attach() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(typeof(ExtendedLimits));
        IntPtr memory = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits, memory, false);
            if (!SetInformationJobObject(job, 9, memory, (uint)size)) throw new Win32Exception();
            if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
        } catch {
            CloseHandle(job);
            job = IntPtr.Zero;
            throw;
        } finally {
            Marshal.FreeHGlobal(memory);
        }
        // Keep the non-inheritable handle alive until PowerShell itself exits.
    }
}

public static class SimulatorWindowIcon {
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int cx, int cy, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    public static void Apply(string path) {
        IntPtr window = GetConsoleWindow();
        if (window == IntPtr.Zero) return;
        IntPtr small = LoadImage(IntPtr.Zero, path, 1, 16, 16, 0x10);
        IntPtr large = LoadImage(IntPtr.Zero, path, 1, 32, 32, 0x10);
        if (small != IntPtr.Zero) SendMessage(window, 0x80, IntPtr.Zero, small);
        if (large != IntPtr.Zero) SendMessage(window, 0x80, new IntPtr(1), large);
    }
}
'@

try {
    [SimulatorProcessJob]::Attach()
    try { [SimulatorWindowIcon]::Apply((Join-Path $PSScriptRoot '../public/icons/favicon.ico')) } catch { }
    $env:SI_WINDOW_JOB = '1'
    $nodeExecutable = (Get-Command node -CommandType Application).Source
    & $nodeExecutable (Join-Path $PSScriptRoot 'launch.mjs') @launchArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Cannot start the managed server process: ' + $_.Exception.Message)
    exit 1
}
