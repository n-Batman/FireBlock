#include "fireblock/parsing.hpp"
#include <windows.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

using namespace fireblock;
namespace {
void check(bool ok,const char* message) { if (!ok) throw std::runtime_error(message); }
template<class F> void fails(F fn) { bool caught=false; try { fn(); } catch (const std::exception&) { caught=true; } check(caught,"Expected failure"); }
void write(const std::filesystem::path& p,const std::string& s) {
    std::filesystem::create_directories(p.parent_path()); std::ofstream out(p,std::ios::binary); out << s;
}
Json read(const std::filesystem::path& p) { std::ifstream in(p); return Json::parse(in); }
Response response(const Json& j) { return {200,j.dump()}; }
Json auth() {
    Json storage = {{"apiUrl","https://api.test"},{"downloadUrl","https://download.test"},
        {"allowed",{{"buckets",Json::array({{{"id","bucket-id"},{"name","test-bucket"}}})}}}};
    return {{"accountId","test"},{"authorizationToken","secret"},{"apiInfo",{{"storageApi",storage}}}};
}
Json config(const std::filesystem::path& root) {
    return {{"input_root",(root/"input").u8string()},{"output_root",(root/"output").u8string()},
        {"firms",{{"enabled",true},{"invalid_rows","fail"}}},{"copernicus",{{"enabled",true}}},
        {"storage",{{"enabled",false},{"bucket","test-bucket"},{"prefix","parsed"},{"upload_assets",true}}}};
}
}
int main() {
    auto root=std::filesystem::temp_directory_path() / ("fireblock-parsing-"+std::to_string(GetCurrentProcessId())+"-"+
        std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directory(root);
    struct Cleanup { std::filesystem::path p; ~Cleanup() { std::error_code ec; std::filesystem::remove_all(p,ec); } } cleanup{root};
    try {
        std::vector<std::string> fields;
        std::istringstream csv("a,\"b,b\",\"line\r\nbreak\",\"say \"\"hi\"\"\",\r\nlast,row");
        check(readCsvRecord(csv,fields) && fields==std::vector<std::string>({"a","b,b","line\r\nbreak","say \"hi\"",""}),"CSV quoting failed");
        check(readCsvRecord(csv,fields) && fields.size()==2 && fields[0]=="last","Final CSV record lost");
        check(!readCsvRecord(csv,fields),"EOF mishandled");
        fails([&] { std::istringstream bad("\"unterminated"); readCsvRecord(bad,fields); });
        fails([&] { std::istringstream bad("\"closed\"extra"); readCsvRecord(bad,fields); });
        fails([&] { std::istringstream bad("123456"); readCsvRecord(bad,fields,5); });
        auto input=root/"input/firms/fires.csv", out=root/"standalone/fires.ndjson";
        write(input,"\xEF\xBB\xBF\"latitude\",longitude,acq_date,acq_time,confidence,note\r\n"
            "38,-122,2024-02-29,5,n,\"smoke, plume\"\r\n"
            "999,-122,2024-02-29,1200,80,bad\r\n");
        Json opts={{"invalid_rows","skip"}};
        auto stats=ParsingController::parseFirms(input,out,opts,"firms/fires.csv");
        check(stats.accepted==1 && stats.rejected==1,"Invalid-row policy failed");
        auto feature=read(out);
        check(feature["geometry"]["coordinates"]==Json::array({-122.0,38.0}),"Longitude/latitude swapped");
        check(feature["properties"]["acquired_at"]=="2024-02-29T00:05:00Z","UTC timestamp normalization failed");
        check(feature["properties"]["attributes"]["confidence"]=="n","Confidence semantics changed");
        fails([&] { ParsingController::parseFirms(input,out,Json::object(),"fires.csv"); });
        check(read(out)==feature,"Failed parse overwrote existing completed output");
        check(!std::filesystem::exists(out.u8string()+".part"),"Failed parse left partial output");
        write(root/"bad/date.csv","latitude,longitude,acq_date,acq_time\n1,2,2023-02-29,2400\n");
        fails([&] { ParsingController::parseFirms(root/"bad/date.csv",out,Json::object(),"bad.csv"); });
        write(root/"mapped.csv","lat,lon,day,clock\n1,2,2024-01-01,1234\n");
        auto mapped=ParsingController::parseFirms(root/"mapped.csv",out,{{"columns",{{"latitude","lat"},{"longitude","lon"},{"date","day"},{"time","clock"}}}},"mapped.csv");
        check(mapped.accepted==1,"Column mapping failed");
        write(root/"duplicate.csv","latitude,latitude,acq_date,acq_time\n");
        fails([&] { ParsingController::parseFirms(root/"duplicate.csv",out,opts,"duplicate.csv"); });
        write(root/"empty.csv","latitude,longitude,acq_date,acq_time\n");
        check(ParsingController::parseFirms(root/"empty.csv",out,opts,"empty.csv").accepted==0,"Empty detection file rejected");

        write(input,"latitude,longitude,acq_date,acq_time\n38,-122,2024-02-29,2359\n");
        Json product={{"Id","product-id"},{"Name","product.SAFE"},{"ContentDate",{{"Start","2024-02-29T00:00:00Z"}}},
            {"GeoFootprint",{{"type","Polygon"},{"coordinates",Json::array({Json::array({{0,0},{1,0},{1,1},{0,0}})})}}}};
        auto metadata=root/"input/copernicus/product-id/metadata.json";
        write(metadata,product.dump());
        write(root/"input/copernicus/product-id/quicklook.image","binary-image");
        write(root/"input/copernicus/catalogue.json","[]");
        auto c=config(root); ParsingController::validate(c);
        auto bad=c; bad["storage"]["enabled"]=true; bad["storage"]["prefix"]="../escape";
        fails([&] { ParsingController::validate(bad); });
        bad=c; bad["output_root"]=bad["input_root"];
        fails([&] { ParsingController{}.run(bad); });
        auto manifest=ParsingController{}.run(c);
        check(manifest["artifacts"].size()==2 && manifest["assets"].size()==1,"Discovery counted catalogue twice or missed assets");
        auto run=root/"output"/manifest["run_id"].get<std::string>();
        auto normalized=read(run/"copernicus/product-id/metadata.ndjson");
        check(normalized["geometry"]==product["GeoFootprint"] && normalized["properties"]["metadata"]==product,"Copernicus metadata lost");

        c["storage"]["enabled"]=true;
        int uploads=0; std::vector<std::string> uploaded;
        Controller storage("id","key",[&](const Request& r)->Response {
            if (r.url.find("b2_authorize_account")!=std::string::npos) return response(auth());
            if (r.url.find("b2_get_upload_url")!=std::string::npos) return response({{"uploadUrl","https://upload.test"},{"authorizationToken","upload-secret"}});
            check(r.url=="https://upload.test","Unexpected storage call"); ++uploads;
            std::string key,type,hash;
            for (const auto& h : r.headers) {
                if (h.first=="X-Bz-File-Name") key=h.second;
                if (h.first=="Content-Type") type=h.second;
                if (h.first=="X-Bz-Content-Sha1") hash=h.second;
            }
            check(hash==sha1File(r.upload),"Storage checksum missing"); uploaded.push_back(key);
            if (r.upload.filename()=="manifest.json") {
                check(uploads==4 && type=="application/json","Manifest not published last");
                auto m=read(r.upload); check(m["status"]=="complete","Incomplete manifest published");
                for (const auto& a : m["artifacts"]) check(a["upload_status"]=="uploaded","Artifact upload unrecorded");
            } else if (r.upload.extension()==".ndjson") check(type=="application/x-ndjson","Wrong NDJSON MIME type");
            return response({{"fileId","file-"+std::to_string(uploads)}});
        });
        manifest=ParsingController{}.run(c,&storage);
        check(uploads==4 && manifest["status"]=="complete","End-to-end B2 pipeline failed");
        check(uploaded.back().find("manifest.json")!=std::string::npos,"Manifest upload order failed");

        int failedUploads=0;
        Controller failing("id","key",[&](const Request& r)->Response {
            if (r.url.find("b2_authorize_account")!=std::string::npos) return response(auth());
            if (r.url.find("b2_get_upload_url")!=std::string::npos) return response({{"uploadUrl","https://upload.test"},{"authorizationToken","secret"}});
            if (r.url.find("b2_list_file_versions")!=std::string::npos) return response({{"files",Json::array()},{"nextFileName",nullptr}});
            ++failedUploads; return {500,"{\"code\":\"server_error\"}"};
        },[](unsigned){});
        fails([&] { ParsingController{}.run(c,&failing); });
        check(failedUploads==4,"Upload did not stop after four attempts");
        bool foundFailure=false;
        for (const auto& e : std::filesystem::directory_iterator(root/"output"))
            if (read(e.path()/"manifest.json")["status"]=="failed") foundFailure=true;
        check(foundFailure,"Failed run has no durable manifest");
        write(root/"input/firms/bad.csv","invalid schema\n");
        int before=uploads; fails([&] { ParsingController{}.run(c,&storage); });
        check(uploads==before,"Parsing failure uploaded an incomplete batch");
        std::cout << "Parsing and B2 integration tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
