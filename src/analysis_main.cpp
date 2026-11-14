#include "fireblock/analysis_worker.hpp"
#include <iostream>

#ifndef FIREBLOCK_ANALYSIS_ENTRY
#define FIREBLOCK_ANALYSIS_ENTRY "python/worker_entry.py"
#endif
int wmain(int argc, wchar_t** argv) {
    if (argc == 1 || std::wstring(argv[1]) == L"--help") {
        std::cout << "FireBlock Python analysis connector\n"
            "Usage: fireblock_analyze --python PATH [--worker ENTRY.py] run JOB.json [--validate]\n"
            "       fireblock_analyze --python PATH [--worker ENTRY.py] ingest INGEST.json --storage-config JOB.json --job-out NEW_JOB.json\n"
            "Uses inherited credentials and returns the Python worker's exit code.\n";
        return 0;
    }
    try {
        std::filesystem::path python, entry = FIREBLOCK_ANALYSIS_ENTRY;
        int i = 1;
        for (; i < argc; ++i) {
            std::wstring arg = argv[i];
            if (arg == L"run" || arg == L"ingest") break;
            if ((arg == L"--python" || arg == L"--worker") && i + 1 < argc) {
                if (arg == L"--python") python = argv[++i]; else entry = argv[++i];
            } else throw std::runtime_error("Unknown connector option or missing value");
        }
        if (python.empty() || i == argc) throw std::runtime_error("Provide --python and run/ingest; see --help");
        std::vector<std::wstring> arguments;
        for (; i < argc; ++i) arguments.emplace_back(argv[i]);
        auto status = fireblock::runAnalysisWorker(python, entry, arguments);
        if (status) std::cerr << "Python analysis worker failed with exit code " << status << ". Run python/worker_entry.py directly for diagnostics.\n";
        return static_cast<int>(status);
    } catch (const std::exception& error) {
        std::cerr << "Analysis connector: " << error.what() << '\n'; return 1;
    }
}
