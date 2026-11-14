#include "fireblock/controller.hpp"
#include <cstdlib>
#include <fstream>
#include <stdexcept>
#include <cctype>

namespace fireblock {
namespace {
std::string base64(const std::string& input) {
    constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string result;
    unsigned value = 0; int bits = -6;
    for (unsigned char c : input) {
        value = (value << 8) | c; bits += 8;
        while (bits >= 0) { result += table[(value >> bits) & 63]; bits -= 6; }
    }
    if (bits > -6) result += table[((value << 8) >> (bits + 8)) & 63];
    while (result.size() % 4) result += '=';
    return result;
}
void headerValue(const std::string& value) {
    if (value.find_first_of("\r\n") != std::string::npos) throw std::runtime_error("Invalid newline in HTTP header");
}
std::string trim(std::string s) {
    const auto first = s.find_first_not_of(" \t\r\n");
    return first == std::string::npos ? "" : s.substr(first, s.find_last_not_of(" \t\r\n") - first + 1);
}
}
std::string environment(const char* name) {
    char* value = nullptr; size_t size = 0;
    if (_dupenv_s(&value, &size, name) != 0) return "";
    std::string result = value ? value : "";
    free(value); return result;
}
void loadEnv(const std::filesystem::path& file) {
    if (!std::filesystem::exists(file)) return;
    std::ifstream input(file);
    if (!input) throw std::runtime_error("Cannot read credential file");
    std::string line;
    while (std::getline(input, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#') continue;
        auto pos = line.find('=');
        if (pos == std::string::npos) throw std::runtime_error("Invalid .env line: expected NAME=value");
        auto name = trim(line.substr(0, pos)), value = trim(line.substr(pos + 1));
        if (name != "B2_APPLICATION_KEY_ID" && name != "B2_APPLICATION_KEY" && name != "B2_BUCKET_NAME") continue;
        if (value.size() >= 2 && ((value.front() == '"' && value.back() == '"') || (value.front() == '\'' && value.back() == '\'')))
            value = value.substr(1, value.size() - 2);
        if (environment(name.c_str()).empty() && _putenv_s(name.c_str(), value.c_str()) != 0)
            throw std::runtime_error("Cannot set credential environment variable");
    }
}
std::string encode(const std::string& value, bool preserveSlash) {
    constexpr char hex[] = "0123456789ABCDEF";
    std::string result;
    for (unsigned char c : value) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~' || (preserveSlash && c == '/')) result += static_cast<char>(c);
        else { result += '%'; result += hex[c >> 4]; result += hex[c & 15]; }
    }
    return result;
}
Controller::Controller(std::string id, std::string key, Transport transport)
    : keyId_(std::move(id)), key_(std::move(key)), transport_(std::move(transport)) {
    if (keyId_.empty() || key_.empty() || keyId_.rfind("replace-with-", 0) == 0 || key_.rfind("replace-with-", 0) == 0)
        throw std::runtime_error("Set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY in .env or your environment. See .env.example.");
    headerValue(keyId_); headerValue(key_);
}
Json Controller::checked(const Response& r) const {
    auto data = Json::parse(r.body, nullptr, false);
    if (r.status < 200 || r.status >= 300) {
        // Do not print raw responses: they may contain credentials or signed URLs.
        std::string code = data.is_object() ? data.value("code", "unknown") : "invalid_response";
        if (code.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::string::npos) code = "unknown";
        throw std::runtime_error("Backblaze HTTP " + std::to_string(r.status) + " (" + code + "). Check key capabilities, bucket, and file identifiers.");
    }
    if (data.is_discarded()) throw std::runtime_error("Backblaze returned invalid JSON");
    return data;
}
void Controller::authorize() {
    auto data = checked(transport_({"GET", "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        {{"Authorization", "Basic " + base64(keyId_ + ":" + key_)}}, "", {}, {}}));
    token_ = data.at("authorizationToken"); accountId_ = data.at("accountId");
    const auto& storage = data.at("apiInfo").at("storageApi");
    apiUrl_ = storage.at("apiUrl"); downloadUrl_ = storage.at("downloadUrl"); allowed_ = storage.at("allowed");
}
Json Controller::api(const std::string& operation, const Json& body) {
    if (token_.empty()) authorize();
    for (int attempt = 0; attempt < 2; ++attempt) {
        auto r = transport_({"POST", apiUrl_ + "/b2api/v4/" + operation,
            {{"Authorization", token_}, {"Content-Type", "application/json"}}, body.dump(), {}, {}});
        if (r.status == 401 && attempt == 0) {
            auto error = Json::parse(r.body, nullptr, false);
            if (error.is_object() && (error.value("code", "") == "expired_auth_token" || error.value("code", "") == "bad_auth_token")) {
                authorize(); continue;
            }
        }
        return checked(r);
    }
    throw std::runtime_error("Authorization failed");
}
Json Controller::account() {
    if (token_.empty()) authorize();
    return {{"accountId", accountId_}, {"allowed", allowed_}};
}
Json Controller::buckets() {
    if (token_.empty()) authorize();
    return api("b2_list_buckets", {{"accountId", accountId_}}).at("buckets");
}
Json Controller::bucket(const std::string& name) {
    if (name.empty()) throw std::runtime_error("Supply --bucket NAME or set B2_BUCKET_NAME");
    if (token_.empty()) authorize();
    if (allowed_.contains("buckets") && allowed_["buckets"].is_array())
        for (const auto& b : allowed_["buckets"])
            if (b.value("name", Json()) == name) return {{"bucketId", b.at("id")}, {"bucketName", name}};
    auto listed = api("b2_list_buckets", {{"accountId", accountId_}, {"bucketName", name}});
    for (const auto& b : listed.at("buckets"))
        if (b.at("bucketName") == name) return b;
    throw std::runtime_error("Bucket not found or key cannot access it: " + name);
}
Json Controller::createBucket(const std::string& name, bool publicRead) {
    if (token_.empty()) authorize();
    return api("b2_create_bucket", {{"accountId", accountId_}, {"bucketName", name}, {"bucketType", publicRead ? "allPublic" : "allPrivate"},
        {"defaultServerSideEncryption", {{"mode", "SSE-B2"}, {"algorithm", "AES256"}}}});
}
Json Controller::setBucketPublic(const std::string& name, bool publicRead) {
    auto b = bucket(name);
    return api("b2_update_bucket", {{"accountId", accountId_}, {"bucketId", b.at("bucketId")}, {"bucketType", publicRead ? "allPublic" : "allPrivate"}});
}
Json Controller::deleteBucket(const std::string& name) {
    auto b = bucket(name);
    return api("b2_delete_bucket", {{"accountId", accountId_}, {"bucketId", b.at("bucketId")}});
}
Json Controller::files(const std::string& name, const std::string& prefix, bool versions) {
    auto b = bucket(name);
    Json body = {{"bucketId", b.at("bucketId")}, {"prefix", prefix}, {"maxFileCount", 1000}};
    Json results = Json::array();
    do {
        auto page = api(versions ? "b2_list_file_versions" : "b2_list_file_names", body);
        for (auto& f : page.at("files")) results.push_back(std::move(f));
        if (!page.contains("nextFileName") || page["nextFileName"].is_null()) break;
        if (body.contains("startFileName") && body["startFileName"] == page["nextFileName"] &&
            (!versions || body.value("startFileId", Json()) == page.value("nextFileId", Json())))
            throw std::runtime_error("Backblaze pagination did not advance");
        body["startFileName"] = page["nextFileName"];
        if (versions) body["startFileId"] = page.at("nextFileId");
    } while (true);
    return results;
}
Json Controller::upload(const std::string& name, const std::filesystem::path& local, const std::string& remote, const std::string& type) {
    if (remote.empty()) throw std::runtime_error("Remote file name cannot be empty");
    headerValue(type);
    if (!std::filesystem::is_regular_file(local)) throw std::runtime_error("Upload source must be a regular file");
    if (std::filesystem::file_size(local) > 5000000000ULL) throw std::runtime_error("Files above 5 GB require multipart upload, which this controller does not yet support");
    auto checksum = sha1File(local);
    auto b = bucket(name);
    auto destination = api("b2_get_upload_url", {{"bucketId", b.at("bucketId")}});
    // Streaming upload with a precomputed SHA-1; never retry an ambiguous upload automatically.
    return checked(transport_({"POST", destination.at("uploadUrl"),
        {{"Authorization", destination.at("authorizationToken")}, {"X-Bz-File-Name", encode(remote)},
         {"Content-Type", type}, {"X-Bz-Content-Sha1", checksum}}, "", local, {}}));
}
std::string Controller::url(const std::string& name, const std::string& remote) {
    bucket(name);
    return downloadUrl_ + "/file/" + encode(name) + "/" + encode(remote, true);
}
void Controller::download(const std::string& name, const std::string& remote, const std::filesystem::path& local) {
    if (std::filesystem::exists(local)) throw std::runtime_error("Download destination already exists; choose another path");
    auto address = url(name, remote);
    auto temp = local; temp += ".part";
    if (std::filesystem::exists(temp)) throw std::runtime_error("Download .part file already exists; choose another path or remove the partial file");
    try {
        auto response = transport_({"GET", address, {{"Authorization", token_}}, "", {}, temp});
        if (response.status < 200 || response.status >= 300) checked(response);
        std::filesystem::rename(temp, local);
    } catch (...) { std::error_code ec; std::filesystem::remove(temp, ec); throw; }
}
Json Controller::info(const std::string& id) { return api("b2_get_file_info", {{"fileId", id}}); }
void Controller::downloadVersion(const std::string& id, const std::filesystem::path& local) {
    if (id.empty()) throw std::runtime_error("File ID is required");
    if (std::filesystem::exists(local)) throw std::runtime_error("Download destination already exists");
    auto temp=local; temp += ".part";
    if (std::filesystem::exists(temp)) throw std::runtime_error("Download partial file already exists");
    auto metadata=info(id);
    auto checksum=metadata.at("contentSha1").get<std::string>();
    if (metadata.at("fileId")!=id || checksum.size()!=40 ||
        checksum.find_first_not_of("0123456789abcdef")!=std::string::npos)
        throw std::runtime_error("Version metadata lacks a verifiable SHA-1");
    auto bytes=metadata.at("contentLength").get<uintmax_t>();
    try {
        for (int attempt=0;attempt<2;++attempt) {
            auto r=transport_({"GET",downloadUrl_+"/b2api/v4/b2_download_file_by_id?fileId="+encode(id),
                {{"Authorization",token_}},"",{},temp});
            if (r.status==401 && attempt==0) {
                auto error=Json::parse(r.body,nullptr,false);
                if (error.is_object() && (error.value("code","")=="expired_auth_token" || error.value("code","")=="bad_auth_token")) {
                    authorize(); continue;
                }
            }
            if (r.status!=200) { checked(r); throw std::runtime_error("Unexpected download status"); }
            if (std::filesystem::file_size(temp)!=bytes || sha1File(temp)!=checksum)
                throw std::runtime_error("Downloaded version failed size/SHA-1 verification");
            std::filesystem::rename(temp,local); return;
        }
        throw std::runtime_error("Download authentication failed");
    } catch (...) { std::error_code ec; std::filesystem::remove(temp,ec); throw; }
}
Json Controller::deleteVersion(const std::string& remote, const std::string& id) {
    return api("b2_delete_file_version", {{"fileName", remote}, {"fileId", id}});
}
Json Controller::hide(const std::string& name, const std::string& remote) {
    auto b = bucket(name);
    return api("b2_hide_file", {{"bucketId", b.at("bucketId")}, {"fileName", remote}});
}
std::string Controller::share(const std::string& name, const std::string& remote, int seconds) {
    if (remote.empty() || seconds < 1 || seconds > 604800) throw std::runtime_error("Sharing requires a file name and duration of 1..604800 seconds");
    auto b = bucket(name);
    auto result = api("b2_get_download_authorization", {{"bucketId", b.at("bucketId")}, {"fileNamePrefix", remote}, {"validDurationInSeconds", seconds}});
    return url(name, remote) + "?Authorization=" + encode(result.at("authorizationToken"));
}
}
