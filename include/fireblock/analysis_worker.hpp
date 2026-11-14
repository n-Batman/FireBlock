#pragma once
#include <filesystem>
#include <string>
#include <vector>

namespace fireblock {
// Synchronous process boundary: JSON jobs and a versioned artifact manifest.
// Inherits the environment for the storage/scraper's credential providers.
// Throws only for process setup errors; returns the Python worker's exit code.
unsigned long runAnalysisWorker(const std::filesystem::path& python,
                                const std::filesystem::path& entryPoint,
                                const std::vector<std::wstring>& arguments);
}
