#pragma once
#include <filesystem>
#include <functional>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace fireblock {
using Json = nlohmann::json;
struct Request {
    std::string method, url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    std::filesystem::path upload, download;
};
struct Response { unsigned status; std::string body; std::string location; };
using Transport = std::function<Response(const Request&)>;
Response windowsHttp(const Request& request);
std::string sha1File(const std::filesystem::path& file);
std::string encode(const std::string& value, bool preserveSlash = false);
void loadEnv(const std::filesystem::path& file);
std::string environment(const char* name);

// One instance per thread. Tokens stay in memory; API results omit auth tokens.
class Controller {
public:
    Controller(std::string keyId, std::string applicationKey, Transport transport = windowsHttp);
    Json account();
    Json buckets();
    Json bucket(const std::string& name);
    Json createBucket(const std::string& name, bool publicRead = false);
    Json setBucketPublic(const std::string& name, bool publicRead);
    Json deleteBucket(const std::string& name);
    Json files(const std::string& bucketName, const std::string& prefix = "", bool versions = false);
    Json upload(const std::string& bucketName, const std::filesystem::path& local,
                const std::string& remote, const std::string& contentType = "b2/x-auto");
    void download(const std::string& bucketName, const std::string& remote, const std::filesystem::path& local);
    // Fetch an immutable B2 version; verify service metadata size/SHA-1 before commit.
    void downloadVersion(const std::string& fileId, const std::filesystem::path& local);
    Json info(const std::string& fileId);
    Json deleteVersion(const std::string& remote, const std::string& fileId);
    Json hide(const std::string& bucketName, const std::string& remote);
    std::string url(const std::string& bucketName, const std::string& remote);
    std::string share(const std::string& bucketName, const std::string& remote, int seconds = 3600);
private:
    void authorize();
    Json api(const std::string& operation, const Json& body);
    Json checked(const Response& response) const;
    std::string keyId_, key_, token_, apiUrl_, downloadUrl_, accountId_;
    Json allowed_;
    Transport transport_;
};
}
