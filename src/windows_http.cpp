#include "fireblock/controller.hpp"
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <array>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <limits>

namespace fireblock {
namespace {
void require(BOOL ok) {
    if (!ok) throw std::runtime_error("Windows HTTPS/I/O operation failed (error " + std::to_string(GetLastError()) + ")");
}
std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8 string");
    std::wstring result(size, L'\0');
    require(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), result.data(), size));
    return result;
}
struct Handle {
    HINTERNET value;
    explicit Handle(HINTERNET v) : value(v) { require(value != nullptr); }
    ~Handle() { WinHttpCloseHandle(value); }
    Handle(const Handle&) = delete;
};
void crypto(NTSTATUS status) {
    if (status < 0) throw std::runtime_error("Windows SHA-1 operation failed");
}
}
std::string sha1File(const std::filesystem::path& path) {
    struct Algorithm {
        BCRYPT_ALG_HANDLE h = nullptr;
        ~Algorithm() { if (h) BCryptCloseAlgorithmProvider(h, 0); }
    } algorithm;
    crypto(BCryptOpenAlgorithmProvider(&algorithm.h, BCRYPT_SHA1_ALGORITHM, nullptr, 0));
    struct Hash {
        BCRYPT_HASH_HANDLE h = nullptr;
        ~Hash() { if (h) BCryptDestroyHash(h); }
    } hash;
    crypto(BCryptCreateHash(algorithm.h, &hash.h, nullptr, 0, nullptr, 0, 0));
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("Cannot open upload source");
    std::array<char, 65536> buffer;
    while (file.read(buffer.data(), buffer.size()) || file.gcount())
        crypto(BCryptHashData(hash.h, reinterpret_cast<PUCHAR>(buffer.data()), static_cast<ULONG>(file.gcount()), 0));
    if (!file.eof()) throw std::runtime_error("Cannot read upload source");
    std::array<unsigned char, 20> digest;
    crypto(BCryptFinishHash(hash.h, digest.data(), static_cast<ULONG>(digest.size()), 0));
    std::string result; constexpr char hex[] = "0123456789abcdef";
    for (auto byte : digest) { result += hex[byte >> 4]; result += hex[byte & 15]; }
    return result;
}
Response windowsHttp(const Request& input) {
    auto address = wide(input.url);
    URL_COMPONENTS parts{}; parts.dwStructSize = sizeof(parts);
    parts.dwHostNameLength = parts.dwUrlPathLength = parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    require(WinHttpCrackUrl(address.c_str(), 0, 0, &parts));
    if (parts.nScheme != INTERNET_SCHEME_HTTPS) throw std::runtime_error("HTTPS is required");
    std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    Handle session(WinHttpOpen(L"FireBlock/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    require(WinHttpSetTimeouts(session.value, 30000, 30000, 300000, 300000));
    Handle connection(WinHttpConnect(session.value, host.c_str(), parts.nPort, 0));
    auto method = wide(input.method);
    Handle request(WinHttpOpenRequest(connection.value, method.c_str(), path.c_str(), nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    // Never forward B2 credentials to a redirect destination.
    DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    require(WinHttpSetOption(request.value, WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof(policy)));
    std::wstring headers;
    for (const auto& h : input.headers) {
        if (h.first.find_first_of("\r\n:") != std::string::npos || h.second.find_first_of("\r\n") != std::string::npos)
            throw std::runtime_error("Invalid HTTP header");
        headers += wide(h.first + ": " + h.second + "\r\n");
    }
    std::ifstream upload;
    uint64_t length = input.body.size();
    if (!input.upload.empty()) {
        upload.open(input.upload, std::ios::binary);
        if (!upload) throw std::runtime_error("Cannot open upload source");
        length = std::filesystem::file_size(input.upload);
    }
    if (input.method == "POST") headers += L"Content-Length: " + std::to_wstring(length) + L"\r\n";
    const DWORD total = length > MAXDWORD ? WINHTTP_IGNORE_REQUEST_TOTAL_LENGTH : static_cast<DWORD>(length);
    require(WinHttpSendRequest(request.value, headers.c_str(), static_cast<DWORD>(headers.size()),
        WINHTTP_NO_REQUEST_DATA, 0, total, 0));
    auto write = [&](const char* data, DWORD count) {
        DWORD offset = 0;
        while (offset < count) {
            DWORD sent = 0;
            require(WinHttpWriteData(request.value, data + offset, count - offset, &sent));
            if (!sent) throw std::runtime_error("Upload write stalled");
            offset += sent;
        }
    };
    if (upload.is_open()) {
        std::array<char, 65536> buffer;
        uint64_t remaining = length;
        while (remaining) {
            auto count = static_cast<std::streamsize>((std::min)(remaining, uint64_t(buffer.size())));
            upload.read(buffer.data(), count);
            if (upload.gcount() != count) throw std::runtime_error("Upload source changed or became unreadable");
            write(buffer.data(), static_cast<DWORD>(count)); remaining -= count;
        }
    } else if (!input.body.empty()) {
        if (input.body.size() > MAXDWORD) throw std::runtime_error("JSON request too large");
        write(input.body.data(), static_cast<DWORD>(input.body.size()));
    }
    require(WinHttpReceiveResponse(request.value, nullptr));
    DWORD status = 0, statusSize = sizeof(status);
    require(WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX));
    Response response{status, "", ""};
    DWORD locationSize = 0;
    WinHttpQueryHeaders(request.value, WINHTTP_QUERY_LOCATION, WINHTTP_HEADER_NAME_BY_INDEX,
        nullptr, &locationSize, WINHTTP_NO_HEADER_INDEX);
    if (GetLastError() == ERROR_INSUFFICIENT_BUFFER && locationSize) {
        std::wstring location(locationSize / sizeof(wchar_t), L'\0');
        require(WinHttpQueryHeaders(request.value, WINHTTP_QUERY_LOCATION, WINHTTP_HEADER_NAME_BY_INDEX,
            location.data(), &locationSize, WINHTTP_NO_HEADER_INDEX));
        location.resize(locationSize / sizeof(wchar_t));
        while (!location.empty() && location.back() == L'\0') location.pop_back();
        int count = WideCharToMultiByte(CP_UTF8, 0, location.data(), static_cast<int>(location.size()), nullptr, 0, nullptr, nullptr);
        response.location.resize(count);
        WideCharToMultiByte(CP_UTF8, 0, location.data(), static_cast<int>(location.size()), response.location.data(), count, nullptr, nullptr);
    }
    std::ofstream download;
    if (!input.download.empty() && status >= 200 && status < 300) {
        download.open(input.download, std::ios::binary | std::ios::trunc);
        if (!download) throw std::runtime_error("Cannot create download destination; ensure its parent folder exists");
    }
    std::array<char, 65536> buffer;
    for (;;) {
        DWORD received = 0;
        require(WinHttpReadData(request.value, buffer.data(), static_cast<DWORD>(buffer.size()), &received));
        if (!received) break;
        if (download.is_open()) {
            download.write(buffer.data(), received);
            if (!download) throw std::runtime_error("Cannot write download (disk may be full)");
        } else {
            if (response.body.size() + received > 32 * 1024 * 1024) throw std::runtime_error("API response exceeds 32 MB limit");
            response.body.append(buffer.data(), received);
        }
    }
    if (download.is_open()) {
        download.flush();
        if (!download) throw std::runtime_error("Cannot flush download to disk");
        download.close();
        if (download.fail()) throw std::runtime_error("Cannot close downloaded file");
    }
    return response;
}
}
