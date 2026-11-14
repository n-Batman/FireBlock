#include "fireblock/ingest.hpp"
#include <cstdlib>
#include <chrono>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace fireblock;
namespace {
void expect(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
Json config(const std::filesystem::path& root) {
    return {{"bbox",{-123,37,-121,39}},{"start","2024-02-27"},{"end","2024-03-05"},
        {"output",root.u8string()},
        {"copernicus",{{"enabled",false},{"collection","SENTINEL-2"},{"max_products",2},{"products",false},{"quicklooks",true}}},
        {"firms",{{"enabled",true},{"sources",{"VIIRS_NOAA20_NRT"}}}}};
}
void reject(const Json& c) {
    bool threw = false; try { Ingestor::validate(c); } catch (...) { threw = true; }
    expect(threw,"Invalid config accepted");
}
void write(const Request& r, const std::string& body) {
    std::ofstream out(r.download,std::ios::binary); out << body;
}
}
int main() {
    auto root = std::filesystem::temp_directory_path() / ("fireblock-ingest-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    try {
        auto c = config(root); Ingestor::validate(c);
        auto bad = c; bad["start"]="2023-02-29"; reject(bad);
        bad=c; bad["end"]="2024-02-27"; reject(bad);
        bad=c; bad["bbox"]={170,-10,-170,10}; reject(bad);
        bad=c; bad["firms"]["sources"]={"invalid"}; reject(bad);
        bad=c; bad["copernicus"]["enabled"]=true; bad["copernicus"]["max_products"]=0; reject(bad);
        _putenv_s("FIRMS_MAP_KEY","unit-test-secret");
        int calls=0;
        Ingestor firms([&](const Request& r) -> Response {
            ++calls;
            expect(r.url.find(calls == 1 ? "/5/2024-02-27" : "/2/2024-03-03") != std::string::npos,"Date chunking failed over leap day");
            write(r,"latitude,longitude,confidence\n38,-122,high\n"); return {200,""};
        });
        firms.run(c); expect(calls==2,"Expected two FIRMS chunks");
        firms = Ingestor([&](const Request& r) -> Response { write(r,"Invalid MAP_KEY."); return {200,""}; });
        bool failed=false; try { firms.run(c); } catch (...) {failed=true;}
        expect(failed,"FIRMS HTTP 200 error not detected");
        auto csv = root / "firms/VIIRS_NOAA20_NRT_2024-02-27_2024-03-03.csv";
        std::ifstream old(csv); std::string header; std::getline(old,header); old.close();
        expect(header.rfind("latitude,longitude,",0)==0,"Failed refresh damaged existing output");
        expect(!std::filesystem::exists(csv.u8string()+".part"),"Partial failure file remains");

        c["firms"]["enabled"]=false; c["copernicus"]["enabled"]=true;
        std::string id1="00000000-0000-0000-0000-000000000001", id2="00000000-0000-0000-0000-000000000002";
        std::string next="https://catalogue.dataspace.copernicus.eu/odata/v1/Products?next=1";
        auto product = [&](std::string id) { return Json{{"Id",id},{"Name","test.SAFE"},{"Online",true},{"Assets",Json::array({{{"Type","QUICKLOOK"},{"DownloadLink","https://catalogue.dataspace.copernicus.eu/odata/v1/Assets("+id+")/$value"}}})}}; };
        int searches=0, images=0;
        Ingestor cp([&](const Request& r) -> Response {
            if (r.download.empty()) {
                ++searches;
                if (r.url==next) return {200,Json{{"value",Json::array({product(id2)})}}.dump()};
                expect(r.url.find("%27SENTINEL-2%27")!=std::string::npos,"Filter not encoded");
                expect(r.url.find("&$expand=Assets&$expand=Attributes&")!=std::string::npos,
                    "Copernicus requires separate expansion parameters");
                return {200,Json{{"value",Json::array({product(id1)})},{"@odata.nextLink",next}}.dump()};
            }
            expect(r.headers.empty(),"Public image carries credentials");
            ++images; write(r,"image-bytes"); return {200,""};
        });
        cp.run(c); expect(searches==2 && images==2,"Catalogue pagination/quicklooks failed");
        cp.run(c); expect(images==2,"Completed images were downloaded again");
        std::filesystem::remove(root / "copernicus" / id1 / "quicklook.image.complete.json");
        cp.run(c); expect(images==3,"Missing completion receipt did not trigger retry");

        _putenv_s("CDSE_USERNAME","test-user"); _putenv_s("CDSE_PASSWORD","test-password");
        c["output"]=(root / "auth").u8string(); c["copernicus"]["max_products"]=1;
        c["copernicus"]["quicklooks"]=false; c["copernicus"]["products"]=true;
        int auths=0, downloads=0;
        Ingestor authorized([&](const Request& r) -> Response {
            if (r.method=="POST") { ++auths; return {200,"{\"access_token\":\"secret-token\"}"}; }
            if (r.download.empty()) return {200,Json{{"value",Json::array({product(id1)})}}.dump()};
            ++downloads;
            if (r.url.rfind("https://download.dataspace.",0)==0) {
                expect(!r.headers.empty(),"Product request missing authorization");
                if (downloads==1) return {401,""};
                return {302,"","https://storage.example.test/object"};
            }
            expect(r.headers.empty(),"Token leaked across redirect host");
            write(r,"archive-bytes"); return {200,""};
        });
        authorized.run(c); expect(auths==2 && downloads==3,"401 refresh / redirect handling failed");
        std::filesystem::remove_all(root);
        std::cout << "Ingestion tests passed\n"; return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n'; std::error_code ec; std::filesystem::remove_all(root,ec); return 1;
    }
}
