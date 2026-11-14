#include "fireblock/controller.hpp"
#include <windows.h>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>
using namespace fireblock;
namespace {
void check(bool ok) { if (!ok) throw std::runtime_error("Retry assertion failed"); }
template<class F> std::string failure(F fn) {
    try { fn(); } catch (const std::exception& error) { return error.what(); }
    throw std::runtime_error("Expected retry failure");
}
Response json(const Json& value) { return {200,value.dump()}; }
Response auth() { return json({{"accountId","account"},{"authorizationToken","private-token"},
    {"apiInfo",{{"storageApi",{{"apiUrl","https://api.test"},{"downloadUrl","https://download.test"},
    {"allowed",{{"buckets",Json::array({{{"id","bucket"},{"name","test"}}})}}}}}}}}); }
struct Storage {
    int uploads=0,targets=0,lists=0;
    unsigned uploadStatus=500,listStatus=200;
    int failures=1;
    bool accepted=false,oldVersion=false,overflow=false;
    std::string identity;
    std::vector<unsigned> waits;
    Json receipt;
    Response request(const Request& r) {
        if (r.url.find("b2_authorize_account")!=std::string::npos) return auth();
        if (r.url.find("b2_get_upload_url")!=std::string::npos) {
            ++targets;
            return json({{"uploadUrl","https://upload.test/"+std::to_string(targets)},
                         {"authorizationToken","private-upload-token"}});
        }
        if (r.url.rfind("https://upload.test/",0)==0) {
            ++uploads;
            std::map<std::string,std::string> headers(r.headers.begin(),r.headers.end());
            const auto& marker=headers.at("X-Bz-Info-fireblock_upload_id");
            check(!marker.empty());
            if (identity.empty()) identity=marker; else check(identity==marker);
            check(headers.at("X-Bz-Content-Sha1")==sha1File(r.upload));
            receipt={{"fileName","data/file.bin"},{"fileId","new-version"},{"action","upload"},
                {"contentSha1",sha1File(r.upload)},{"contentLength",std::filesystem::file_size(r.upload)},
                {"fileInfo",{{"fireblock_upload_id",marker}}}};
            if (uploads<=failures) return {uploadStatus,"{\"code\":\"internal_error\",\"message\":\"secret-provider-response\"}"};
            return json(receipt);
        }
        if (r.url.find("b2_list_file_versions")!=std::string::npos) {
            ++lists;
            auto body=Json::parse(r.body);
            check(body.at("prefix")=="data/file.bin" && body.at("maxFileCount")==1000);
            if (listStatus!=200) return {listStatus,"{\"code\":\"unauthorized\"}"};
            Json files=Json::array();
            if (accepted) files.push_back(receipt);
            else if (oldVersion) { auto old=receipt; old["fileInfo"]["fireblock_upload_id"]="another-upload"; files.push_back(old); }
            return json({{"files",files},{"nextFileName",overflow?Json("data/file.bin"):Json()}});
        }
        throw std::runtime_error("Unexpected retry request");
    }
    Controller controller() {
        return Controller("id","key",[this](const Request& r){return request(r);},
            [this](unsigned seconds){waits.push_back(seconds);});
    }
};
}
int main() {
    auto root=std::filesystem::temp_directory_path()/("fireblock-retry-"+std::to_string(GetCurrentProcessId()));
    std::filesystem::create_directory(root);
    struct Cleanup { std::filesystem::path p; ~Cleanup(){std::error_code ec;std::filesystem::remove_all(p,ec);} } cleanup{root};
    auto source=root/"source.bin";
    { std::ofstream out(source);out<<"abc"; }
    try {
        Storage recovered;
        check(recovered.controller().upload("test",source,"data/file.bin")["fileId"]=="new-version");
        check(recovered.uploads==2 && recovered.targets==2 && recovered.lists==1 && recovered.waits==std::vector<unsigned>{1});
        Storage accepted;accepted.accepted=true;
        check(accepted.controller().upload("test",source,"data/file.bin")["fileId"]=="new-version");
        check(accepted.uploads==1 && accepted.waits.empty());
        Storage older;older.oldVersion=true;
        check(older.controller().upload("test",source,"data/file.bin")["fileId"]=="new-version");
        check(older.uploads==2); // Same bytes from a different logical upload do not count.
        Storage exhausted;exhausted.failures=100;
        auto message=failure([&]{exhausted.controller().upload("test",source,"data/file.bin");});
        check(exhausted.uploads==4 && exhausted.targets==4 && exhausted.lists==4);
        check(exhausted.waits==std::vector<unsigned>({1,2,4}));
        check(message.find("HTTP 500")!=std::string::npos && message.find("after 4 attempts")!=std::string::npos);
        check(message.find("secret")==std::string::npos);
        Storage permanent;permanent.uploadStatus=403;
        failure([&]{permanent.controller().upload("test",source,"data/file.bin");});
        check(permanent.uploads==1 && permanent.lists==0 && permanent.waits.empty());
        Storage unverifiable;unverifiable.listStatus=403;
        check(failure([&]{unverifiable.controller().upload("test",source,"data/file.bin");}).find("could not verify")!=std::string::npos);
        check(unverifiable.uploads==1 && unverifiable.waits.empty());
        Storage overflow;overflow.overflow=true;
        failure([&]{overflow.controller().upload("test",source,"data/file.bin");});
        check(overflow.uploads==1);
        Storage finalAccepted;finalAccepted.failures=4;
        auto c=Controller("id","key",[&](const Request& r){
            finalAccepted.accepted=finalAccepted.uploads==4;
            return finalAccepted.request(r);
        },[&](unsigned s){finalAccepted.waits.push_back(s);});
        check(c.upload("test",source,"data/file.bin")["fileId"]=="new-version");
        check(finalAccepted.uploads==4);
        int authCalls=0,infoCalls=0,mutations=0;
        std::vector<unsigned> waits;
        Controller metadata("id","key",[&](const Request& r)->Response {
            if(r.url.find("b2_authorize_account")!=std::string::npos) {
                if(++authCalls<3)return {500,""}; return auth();
            }
            if(r.url.find("b2_get_file_info")!=std::string::npos) {
                if(++infoCalls<3)return {503,""}; return json({{"fileId","ok"}});
            }
            ++mutations;return {500,""};
        },[&](unsigned s){waits.push_back(s);});
        check(metadata.info("id")["fileId"]=="ok" && authCalls==3 && infoCalls==3);
        check(waits==std::vector<unsigned>({1,2,1,2}));
        failure([&]{metadata.hide("test","name");});check(mutations==1);
        int calls=0;
        Controller down("id","key",[&](const Request& r)->Response {
            if(r.url.find("b2_authorize_account")!=std::string::npos)return auth();
            ++calls;return {500,""};
        },[](unsigned){});
        check(failure([&]{down.info("id");}).find("after 4 attempts")!=std::string::npos && calls==4);
        Storage changed;
        Controller changing("id","key",[&](const Request& r){return changed.request(r);},[&](unsigned){std::ofstream out(source);out<<"changed";});
        check(failure([&]{changing.upload("test",source,"data/file.bin");}).find("source changed")!=std::string::npos);
        check(changed.uploads==1);
        std::cout<<"Backblaze retry, receipt recovery and exhaustion tests passed\n";
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
