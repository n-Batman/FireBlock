#include "fireblock/controller.hpp"
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <windows.h>
using namespace fireblock;
void check(bool ok) { if (!ok) throw std::runtime_error("Test assertion failed"); }
template<class F> void fails(F f) { bool threw = false; try { f(); } catch (const std::exception&) { threw = true; } check(threw); }
Response json(Json value) { return {200, value.dump()}; }
Response auth() {
    Json storage = {{"apiUrl", "https://api.example"}, {"downloadUrl", "https://download.example"},
        {"allowed", {{"buckets", Json::array({{{"id", "bucket-id"}, {"name", "photos"}}})}, {"capabilities", {"readFiles"}}}}};
    return json({{"accountId", "account"}, {"authorizationToken", "secret-token"},
                 {"apiInfo", {{"storageApi", storage}}}});
}
int main() {
    try {
        check(encode("images/a b+#?.png", true) == "images/a%20b%2B%23%3F.png");
        check(encode("\xC3\xA9") == "%C3%A9");
        fails([] { Controller c("", ""); });
        auto temp = std::filesystem::temp_directory_path() / ("fireblock-tests-" + std::to_string(GetCurrentProcessId()));
        std::filesystem::create_directory(temp);
        struct Cleanup { std::filesystem::path path; ~Cleanup() { std::error_code ec; std::filesystem::remove_all(path, ec); } } cleanup{temp};
        auto source = temp / "source.bin";
        { std::ofstream out(source, std::ios::binary); out << "abc"; }
        check(sha1File(source) == "a9993e364706816aba3e25717850c26c9cd0d89d");
        int page = 0, authorizations = 0;
        Controller c("id", "key", [&](const Request& r) -> Response {
            if (r.url.find("b2_authorize_account") != std::string::npos) {
                check(r.headers[0].second == "Basic aWQ6a2V5"); ++authorizations; return auth();
            }
            auto body = r.body.empty() ? Json::object() : Json::parse(r.body);
            if (r.url.find("b2_list_file_names") != std::string::npos) {
                check(body["bucketId"] == "bucket-id"); check(body["prefix"] == "images/");
                if (++page == 1) return json({{"files", Json::array({{{"fileName", "images/a"}}})}, {"nextFileName", "images/b"}});
                check(body["startFileName"] == "images/b");
                return json({{"files", Json::array({{{"fileName", "images/b"}}})}, {"nextFileName", nullptr}});
            }
            if (r.url.find("b2_get_upload_url") != std::string::npos) return json({{"uploadUrl", "https://upload.example"}, {"authorizationToken", "upload-secret"}});
            if (r.url == "https://upload.example") {
                check(r.upload == source); bool hash = false, type = false;
                for (auto& h : r.headers) {
                    if (h.first == "X-Bz-Content-Sha1") hash = h.second == sha1File(source);
                    if (h.first == "Content-Type") type = h.second == "b2/x-auto";
                }
                check(hash && type); return json({{"fileId", "uploaded"}});
            }
            if (r.url.find("b2_get_download_authorization") != std::string::npos) {
                check(body["fileNamePrefix"] == "images/a b.png"); check(body["validDurationInSeconds"] == 60);
                return json({{"authorizationToken", "share+secret"}});
            }
            if (r.url.find("b2_delete_file_version") != std::string::npos) {
                check(body["fileId"] == "exact-version"); check(body["fileName"] == "images/a"); return json(body);
            }
            if (r.url.find("/file/photos/") != std::string::npos) {
                std::ofstream out(r.download, std::ios::binary); out << "partial";
                return {404, R"({"code":"file_not_present"})"};
            }
            throw std::runtime_error("Unexpected request: " + r.url);
        });
        check(!c.account().contains("authorizationToken"));
        check(c.files("photos", "images/").size() == 2);
        check(c.upload("photos", source, "data/source.bin")["fileId"] == "uploaded");
        check(c.share("photos", "images/a b.png", 60) == "https://download.example/file/photos/images/a%20b.png?Authorization=share%2Bsecret");
        check(c.deleteVersion("images/a", "exact-version")["fileId"] == "exact-version");
        fails([&] { c.share("photos", "a", 0); });
        fails([&] { c.upload("photos", source, "a", "image/png\r\nInjected: bad"); });
        auto destination = temp / "download.bin";
        fails([&] { c.download("photos", "missing", destination); });
        check(!std::filesystem::exists(destination)); check(!std::filesystem::exists(destination.string() + ".part"));
        fails([&] { c.download("photos", "a", source); });
        check(sha1File(source) == "a9993e364706816aba3e25717850c26c9cd0d89d");
        check(authorizations == 1);
        int attempts = 0;
        Controller refresh("id", "key", [&](const Request& r) -> Response {
            if (r.url.find("b2_authorize_account") != std::string::npos) return auth();
            if (++attempts == 1) return {401, R"({"code":"expired_auth_token"})"};
            return json({{"fileId", "ok"}});
        });
        check(refresh.info("id")["fileId"] == "ok"); check(attempts == 2);
        Controller rejected("id", "key", [](const Request&) -> Response { return {403, R"({"code":"unauthorized","message":"secret-value"})"}; });
        try { rejected.account(); check(false); } catch (const std::exception& e) { check(std::string(e.what()).find("secret-value") == std::string::npos); }
        std::cout << "Controller contract tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
