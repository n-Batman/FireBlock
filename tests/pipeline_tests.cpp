#include "fireblock/raw_data.hpp"
#include <windows.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <stdexcept>

using namespace fireblock;
namespace {
void check(bool ok,const char* message) { if (!ok) throw std::runtime_error(message); }
template<class F> void fails(F fn) { bool caught=false; try { fn(); } catch (const std::exception&) { caught=true; } check(caught,"Expected operation to fail"); }
std::string bytes(const std::filesystem::path& p) {
    std::ifstream in(p,std::ios::binary); return {std::istreambuf_iterator<char>(in),std::istreambuf_iterator<char>()};
}
void write(const std::filesystem::path& p,const std::string& data) {
    std::filesystem::create_directories(p.parent_path()); std::ofstream out(p,std::ios::binary); out.write(data.data(),static_cast<std::streamsize>(data.size()));
}
Response response(const Json& j) { return {200,j.dump()}; }
Json auth() {
    Json storage = {{"apiUrl","https://api.test"},{"downloadUrl","https://download.test"},
        {"allowed",{{"buckets",Json::array({{{"id","bucket-id"},{"name","raw-bucket"}}})}}}};
    return {{"accountId","account"},{"authorizationToken","secret"},{"apiInfo",{{"storageApi",storage}}}};
}
struct Object { std::string data,hash; };
}
int main() {
    auto root=std::filesystem::temp_directory_path()/("fireblock-pipeline-"+std::to_string(GetCurrentProcessId())+"-"+
        std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directory(root);
    struct Cleanup { std::filesystem::path path; ~Cleanup() { std::error_code ec; std::filesystem::remove_all(path,ec); } } cleanup{root};
    try {
        std::map<std::string,Object> objects; int uploads=0,downloads=0,authorizations=0,manifests=0;
        bool corrupt=false,expire=false,uploadFailure=false; std::string lastUpload;
        Controller storage("id","key",[&](const Request& r)->Response {
            if (r.url.find("b2_authorize_account")!=std::string::npos) { ++authorizations; return response(auth()); }
            if (r.url.find("b2_get_upload_url")!=std::string::npos)
                return response({{"uploadUrl","https://upload.test"},{"authorizationToken","upload-secret"}});
            if (r.url=="https://upload.test") {
                ++uploads;
                if (uploadFailure) return {500,"{\"code\":\"server_error\"}"};
                auto data=bytes(r.upload), hash=sha1File(r.upload); auto id="version-"+std::to_string(uploads);
                objects[id]={data,hash}; lastUpload=id;
                auto j=Json::parse(data,nullptr,false);
                if (j.is_object() && j.value("kind","")=="fireblock.raw") {
                    ++manifests; check(j["status"]=="complete","Partial raw manifest was uploaded");
                    for (const auto& f : j["files"]) check(objects.count(f["file_id"].get<std::string>())==1,"Manifest references an unuploaded object");
                }
                return response({{"fileId",id}});
            }
            if (r.url.find("b2_get_file_info")!=std::string::npos) {
                auto id=Json::parse(r.body).at("fileId").get<std::string>(); const auto& obj=objects.at(id);
                return response({{"fileId",id},{"contentLength",obj.data.size()},{"contentSha1",obj.hash}});
            }
            const std::string query="/b2api/v4/b2_download_file_by_id?fileId=";
            auto p=r.url.find(query);
            check(p!=std::string::npos,"Unexpected B2 request"); ++downloads;
            check(!r.headers.empty() && r.headers[0].first=="Authorization","Download lacks authentication");
            if (expire) { expire=false; return {401,"{\"code\":\"expired_auth_token\"}"}; }
            auto id=r.url.substr(p+query.size());
            write(r.download,corrupt ? "damaged" : objects.at(id).data); return {200,""};
        });
        RawDataController pipeline(storage);
        _putenv_s("FIRMS_MAP_KEY","test-map-key");
        Json cfg={{"bbox",{-123,37,-121,39}},{"start","2026-11-10"},{"end","2026-11-11"},{"output","ignored"},
            {"copernicus",{{"enabled",false}}},{"firms",{{"enabled",true},{"sources",{"VIIRS_NOAA20_NRT"}}}}};
        const std::string csv="latitude,longitude,acq_date,acq_time\n38,-122,2026-11-10,1200\n";
        auto result=pipeline.scrape(cfg,root/"work","raw-bucket","raw",[&](const Request& r)->Response {
            check(uploads==0,"Storage upload started before scraper finished");
            check(r.url.find("/VIIRS_NOAA20_NRT/")!=std::string::npos,"Source controller not connected");
            write(r.download,csv); return {200,""};
        });
        check(result["files"]==3 && manifests==1,"Scraper outputs/sidecars not all archived");
        auto manifestId=result["manifest_file_id"].get<std::string>();
        check(manifestId==lastUpload,"Manifest was not uploaded last");
        expire=true; int previousAuth=authorizations;
        auto restored=pipeline.pull(manifestId,root/"parser-input");
        check(authorizations==previousAuth+1,"Version download did not refresh expired token");
        check(bytes(root/"parser-input/firms/VIIRS_NOAA20_NRT_2026-11-10_2026-11-11.csv")==csv,"Scraper-to-storage-to-parser input changed bytes/layout");
        check(std::filesystem::exists(root/"parser-input/raw-manifest.json"),"Restored tree missing provenance");
        check(restored["files"]==3,"Restore inventory mismatch");
        fails([&] { pipeline.pull(manifestId,root/"parser-input"); });
        corrupt=true;
        fails([&] { pipeline.pull(manifestId,root/"corrupt-target"); });
        check(!std::filesystem::exists(root/"corrupt-target"),"Corrupt data exposed to parser"); corrupt=false;

        // Existing files, binary imagery, and metadata take the same raw route.
        write(root/"existing/copernicus/product/metadata.json","{\"Id\":\"product\",\"Name\":\"example\"}");
        const std::string image("\0\1\2image\0bytes",14);
        write(root/"existing/copernicus/product/quicklook.image",image);
        result=pipeline.publish(root/"existing","raw-bucket");
        pipeline.pull(result["manifest_file_id"].get<std::string>(),root/"binary-target");
        check(bytes(root/"binary-target/copernicus/product/quicklook.image")==image,"Binary data altered");

        auto addManifest=[&](Json manifest) {
            auto path=root/"test-manifest.json"; write(path,manifest.dump());
            auto id="fixture-"+std::to_string(objects.size()); objects[id]={bytes(path),sha1File(path)}; return id;
        };
        auto manifest=Json::parse(objects.at(manifestId).data);
        auto bad=manifest; bad["files"][0]["path"]="firms/../../escape.csv";
        int previousDownloads=downloads;
        fails([&] { pipeline.pull(addManifest(bad),root/"unsafe-target"); });
        check(downloads==previousDownloads+1,"Unsafe inventory downloaded objects before validation");
        check(!std::filesystem::exists(root/"escape.csv"),"Path traversal escaped staging");
        bad=manifest; auto duplicate=bad["files"][0]; duplicate["path"]="FIRMS/"+duplicate["path"].get<std::string>().substr(6);
        duplicate["key"]=bad["prefix"].get<std::string>()+duplicate["path"].get<std::string>(); bad["files"].push_back(duplicate);
        fails([&] { pipeline.pull(addManifest(bad),root/"duplicate-target"); });
        bad=manifest; bad["status"]="uploading";
        fails([&] { pipeline.pull(addManifest(bad),root/"partial-target"); });
        bad=manifest; bad["files"][0]["sha1"]=std::string(40,'0');
        fails([&] { pipeline.pull(addManifest(bad),root/"wrong-hash-target"); });
        check(!std::filesystem::exists(root/"wrong-hash-target"),"Manifest mismatch exposed a dataset");
        write(root/"existing/copernicus/product/download.part","unfinished"); int before=uploads;
        fails([&] { pipeline.publish(root/"existing","raw-bucket"); });
        check(uploads==before,"Partial dataset was uploaded");
        before=uploads;
        fails([&] { pipeline.scrape(cfg,root/"failed-work","raw-bucket","raw",[](const Request&)->Response { return {403,""}; }); });
        check(uploads==before,"Failed scraper published raw batch");
        uploadFailure=true; before=uploads; int completed=manifests;
        fails([&] { pipeline.publish(root/"parser-input","raw-bucket"); });
        check(uploads==before+1 && manifests==completed,"Upload failure retried or published ready manifest");
        for (const auto& e : std::filesystem::directory_iterator(root))
            check(e.path().filename().u8string().rfind(".raw-pull-",0)!=0,"Failed restore left staging directory");
        std::cout << "Raw scraper/B2/restore contract tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
