#include "fireblock/analysis_worker.hpp"
#include <windows.h>
#include <stdexcept>

namespace fireblock {
namespace {
// Quote according to the Microsoft C runtime argv rules, including trailing slashes.
std::wstring quote(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { ++slashes; continue; }
        if (c == L'\"') result.append(slashes * 2 + 1, L'\\');
        else result.append(slashes, L'\\');
        slashes = 0; result += c;
    }
    result.append(slashes * 2, L'\\'); result += L'\"';
    return result;
}
}
unsigned long runAnalysisWorker(const std::filesystem::path& python,
                                const std::filesystem::path& entryPoint,
                                const std::vector<std::wstring>& arguments) {
    auto interpreter = std::filesystem::absolute(python);
    auto entry = std::filesystem::absolute(entryPoint);
    if (!std::filesystem::is_regular_file(interpreter) || !std::filesystem::is_regular_file(entry))
        throw std::runtime_error("Python interpreter or analysis entry point does not exist");
    std::wstring command = quote(interpreter.wstring()) + L" " + quote(entry.wstring());
    for (const auto& argument : arguments) command += L" " + quote(argument);
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(interpreter.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                        nullptr, nullptr, &startup, &process))
        throw std::runtime_error("Could not start Python analysis worker");
    CloseHandle(process.hThread);
    auto waited = WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exitCode = 1;
    BOOL read = GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hProcess);
    if (waited != WAIT_OBJECT_0 || !read) throw std::runtime_error("Could not read analysis worker exit status");
    return exitCode;
}
}
