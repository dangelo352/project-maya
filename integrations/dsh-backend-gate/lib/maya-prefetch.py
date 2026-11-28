"""Warm Maya's original GGUF files in the reclaimable Windows file cache."""

import ctypes
from ctypes import wintypes
import json
import msvcrt
from pathlib import Path
import re
import sys


class MemoryStatus(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)]
    _fields_ += [(name, ctypes.c_uint64) for name in (
        "total_phys", "avail_phys", "total_page", "avail_page", "total_virtual",
        "avail_virtual", "avail_extended_virtual",
    )]


def available_ram():
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise OSError("Could not read available physical memory")
    return status.avail_phys


def checkpoints(config_path):
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    args = config.get("args", [])
    cwd = Path(config.get("cwd") or ".")
    paths = {}
    for flag in ("--model", "--draft"):
        if flag not in args:
            continue
        path = (cwd / args[args.index(flag) + 1]).resolve(strict=True)
        if path.suffix.lower() != ".gguf":
            continue
        shards = re.fullmatch(r"(.*)-00001-of-(\d{5})\.gguf", path.name, re.I)
        if shards:
            count = int(shards[2])
            if not 1 <= count <= 256:
                raise ValueError("Invalid GGUF shard count")
            for i in range(1, count + 1):
                shard = path.with_name(f"{shards[1]}-{i:05d}-of-{shards[2]}.gguf")
                paths[shard] = shard.stat().st_size
        else:
            paths[path] = path.stat().st_size
    return paths


class MemoryRange(ctypes.Structure):
    _fields_ = [("address", ctypes.c_void_p), ("length", ctypes.c_size_t)]


def prefetch_file(source, length, reserve):
    kernel = ctypes.windll.kernel32
    create = kernel.CreateFileMappingW
    create.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                       wintypes.DWORD, wintypes.DWORD, wintypes.LPCWSTR]
    create.restype = wintypes.HANDLE
    view = kernel.MapViewOfFile
    view.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                     wintypes.DWORD, ctypes.c_size_t]
    view.restype = ctypes.c_void_p
    unmap = kernel.UnmapViewOfFile
    unmap.argtypes = [ctypes.c_void_p]
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    prefetch = kernel.PrefetchVirtualMemory
    prefetch.argtypes = [wintypes.HANDLE, ctypes.c_size_t,
                         ctypes.POINTER(MemoryRange), wintypes.ULONG]
    mapping = create(msvcrt.get_osfhandle(source.fileno()), None, 0x02, 0, 0, None)
    if not mapping:
        return False
    try:
        start = view(mapping, 0x0004, 0, 0, 0)
        if not start:
            return False
        try:
            chunk = 256 * 1024 ** 2
            for offset in range(0, length, chunk):
                if available_ram() < reserve:
                    return False
                region = MemoryRange(start + offset, min(chunk, length - offset))
                if not prefetch(kernel.GetCurrentProcess(), 1, ctypes.byref(region), 0):
                    return False
            return True
        finally:
            unmap(start)
    finally:
        close(mapping)


def warm(config_path):
    files = checkpoints(config_path)
    reserve = 8 * 1024 ** 3
    total = sum(files.values())
    if not total or available_ram() < total + reserve:
        return 2
    for path, expected in files.items():
        with path.open("rb", buffering=0) as source:
            if path.stat().st_size != expected or not prefetch_file(source, expected, reserve):
                return 2
    return 0


if __name__ == "__main__":
    if sys.platform != "win32":
        sys.exit(2)
    try:
        sys.exit(warm(Path(sys.argv[1])))
    except (OSError, ValueError, TypeError, IndexError):
        sys.exit(2)
