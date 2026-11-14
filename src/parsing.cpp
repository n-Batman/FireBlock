#include "fireblock/parsing.hpp"
#include <windows.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <locale>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>

namespace fireblock {
namespace {
void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
void commit(const std::filesystem::path& from, const std::filesystem::path& to) {
    require(MoveFileExW(from.c_str(),to.c_str(),MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)!=0,"Cannot commit parsing output");
}
struct AtomicOutput {
    std::filesystem::path target, part;
    std::ofstream stream;
    explicit AtomicOutput(const std::filesystem::path& p) : target(p), part(p) {
        part += ".part";
        std::filesystem::create_directories(p.parent_path());
        stream.open(part,std::ios::binary | std::ios::trunc);
        require(bool(stream),"Cannot open parsing output");
    }
    void finish() {
        stream.close(); require(bool(stream),"Cannot write parsing output"); commit(part,target);
    }
    ~AtomicOutput() { stream.close(); std::error_code ec; std::filesystem::remove(part,ec); }
};
void save(const std::filesystem::path& file, const Json& value) {
    AtomicOutput out(file); out.stream << value.dump(2) << '\n'; out.finish();
}
double number(const std::string& text) {
    std::istringstream in(text); in.imbue(std::locale::classic()); double result=0;
    require(bool(in >> result),"Invalid numeric field"); in >> std::ws;
    require(in.eof() && std::isfinite(result),"Invalid numeric field"); return result;
}
std::string timestamp(const std::string& day, std::string time) {
    require(day.size()==10 && day[4]=='-' && day[7]=='-',"Invalid acquisition date");
    for (size_t i=0;i<day.size();++i) if (i!=4 && i!=7) require(day[i]>='0' && day[i]<='9',"Invalid acquisition date");
    int y=std::stoi(day.substr(0,4)), m=std::stoi(day.substr(5,2)), d=std::stoi(day.substr(8,2));
    static const int days[]{31,28,31,30,31,30,31,31,30,31,30,31};
    require(y>=1900 && m>=1 && m<=12,"Invalid acquisition date");
    int maximum=days[m-1]+(m==2 && y%4==0 && (y%100!=0 || y%400==0));
    require(d>=1 && d<=maximum,"Invalid acquisition date");
    require(!time.empty() && time.size()<=4 && time.find_first_not_of("0123456789")==std::string::npos,"Invalid acquisition time");
    time.insert(0,4-time.size(),'0');
    require(std::stoi(time.substr(0,2))<24 && std::stoi(time.substr(2,2))<60,"Invalid acquisition time");
    return day + "T" + time.substr(0,2) + ":" + time.substr(2,2) + ":00Z";
}
std::string column(const Json& options, const std::string& logical, const std::string& fallback) {
    return options.value("columns",Json::object()).value(logical,fallback);
}
bool within(const std::filesystem::path& child, const std::filesystem::path& parent) {
    auto a=child.begin(), b=parent.begin();
    for (; b!=parent.end();++a,++b)
        if (a==child.end() || _wcsicmp(a->c_str(),b->c_str())!=0) return false;
    return true;
}
std::string runId() {
    return std::to_string(std::chrono::system_clock::now().time_since_epoch().count()) + "-" + std::to_string(GetCurrentProcessId());
}
std::string remotePrefix(const Json& storage) {
    auto prefix=storage.value("prefix",std::string("parsed"));
    while (!prefix.empty() && prefix.back()=='/') prefix.pop_back();
    return prefix;
}
}
void ParsingController::validate(const Json& c) {
    require(c.is_object(),"Parsing configuration must be an object");
    require(!c.at("input_root").get<std::string>().empty(),"input_root is required");
    require(!c.at("output_root").get<std::string>().empty(),"output_root is required");
    const auto& f=c.at("firms"); const auto& cp=c.at("copernicus");
    bool firms=f.at("enabled").get<bool>(), copernicus=cp.at("enabled").get<bool>();
    require(firms || copernicus,"Enable at least one parser");
    auto policy=f.value("invalid_rows",std::string("fail"));
    require(policy=="fail" || policy=="skip","invalid_rows must be fail or skip");
    if (f.contains("columns")) {
        require(f.at("columns").is_object(),"firms.columns must be an object");
        std::set<std::string> allowed{"latitude","longitude","date","time"}, used;
        for (auto it=f.at("columns").begin();it!=f.at("columns").end();++it) {
            require(allowed.count(it.key())!=0,"Unknown FIRMS column mapping");
            require(!it.value().get<std::string>().empty(),"Empty FIRMS column mapping");
        }
        for (auto pair : {std::make_pair("latitude","latitude"),{"longitude","longitude"},{"date","acq_date"},{"time","acq_time"}})
            require(used.insert(column(f,pair.first,pair.second)).second,"Required FIRMS fields must use distinct columns");
    }
    const auto& s=c.at("storage");
    s.value("upload_assets",false);
    if (s.at("enabled").get<bool>()) {
        require(!s.at("bucket").get<std::string>().empty(),"storage.bucket is required");
        auto prefix=remotePrefix(s);
        require(!prefix.empty() && prefix.front()!='/' && prefix.find('\\')==std::string::npos &&
            prefix.find_first_of("\r\n") == std::string::npos,"Invalid storage prefix");
        std::istringstream pieces(prefix); std::string piece;
        while (std::getline(pieces,piece,'/')) require(!piece.empty() && piece!="." && piece!="..","Invalid storage prefix component");
    }
}
ParseStats ParsingController::parseFirms(const std::filesystem::path& input,
        const std::filesystem::path& output, const Json& options, const std::string& name) {
    std::ifstream in(input,std::ios::binary); require(bool(in),"Cannot open FIRMS input");
    // Remove UTF-8 BOM before CSV tokenization (including a quoted first header).
    std::array<char,3> bom{}; in.read(bom.data(),3);
    bool hasBom=in.gcount()==3 && static_cast<unsigned char>(bom[0])==0xef &&
        static_cast<unsigned char>(bom[1])==0xbb && static_cast<unsigned char>(bom[2])==0xbf;
    in.clear(); in.seekg(hasBom ? 3 : 0);
    std::vector<std::string> headers, fields;
    require(readCsvRecord(in,headers),"FIRMS CSV has no header");
    std::map<std::string,size_t> indexes;
    for (size_t i=0;i<headers.size();++i) require(!headers[i].empty() && indexes.emplace(headers[i],i).second,"Empty or duplicate CSV header");
    std::array<size_t,4> required; size_t index=0;
    for (auto pair : {std::make_pair("latitude","latitude"),{"longitude","longitude"},{"date","acq_date"},{"time","acq_time"}}) {
        auto found=indexes.find(column(options,pair.first,pair.second));
        require(found!=indexes.end(),"Missing required FIRMS CSV column"); required[index++]=found->second;
    }
    AtomicOutput out(output); ParseStats stats; uint64_t record=1;
    while (readCsvRecord(in,fields)) {
        ++record;
        if (fields.size()==1 && fields[0].empty()) continue;
        Json feature;
        try {
            require(fields.size()==headers.size(),"CSV column count differs from header");
            double lat=number(fields[required[0]]), lon=number(fields[required[1]]);
            require(lat>=-90 && lat<=90 && lon>=-180 && lon<=180,"Coordinate outside WGS84 bounds");
            auto acquired=timestamp(fields[required[2]],fields[required[3]]);
            Json attributes=Json::object();
            for (size_t i=0;i<headers.size();++i) attributes[headers[i]]=fields[i];
            feature={{"type","Feature"},{"geometry",{{"type","Point"},{"coordinates",{lon,lat}}}},
                {"properties",{{"provider","NASA FIRMS"},{"acquired_at",acquired},{"source_file",name},{"source_record",record},{"attributes",attributes}}}};
            // Validate UTF-8 as part of record validation, before writing anything.
            feature.dump();
        } catch (const std::exception& e) {
            if (options.value("invalid_rows",std::string("fail"))!="skip")
                throw std::runtime_error("Invalid FIRMS record " + std::to_string(record));
            ++stats.rejected;
            if (stats.diagnostics.size()<100) stats.diagnostics.push_back("Rejected record " + std::to_string(record));
            (void)e; continue;
        }
        out.stream << feature.dump() << '\n'; require(bool(out.stream),"Cannot write parsed FIRMS records"); ++stats.accepted;
    }
    out.finish(); return stats;
}
ParseStats ParsingController::parseCopernicus(const std::filesystem::path& input,
        const std::filesystem::path& output, const std::string& name) {
    require(std::filesystem::file_size(input)<=32ULL*1024*1024,"Copernicus metadata exceeds 32 MB limit");
    std::ifstream in(input,std::ios::binary); require(bool(in),"Cannot open Copernicus metadata");
    auto product=Json::parse(in,nullptr,false);
    require(product.is_object() && product.contains("Id") && product.at("Id").is_string() &&
        !product.at("Id").get<std::string>().empty() && product.contains("Name") && product.at("Name").is_string(),"Invalid Copernicus product metadata");
    Json geometry=nullptr;
    for (const auto* field : {"GeoFootprint","Geofootprint"}) if (product.contains(field) && !product.at(field).is_null()) {
        geometry=product.at(field);
        require(geometry.is_object() && geometry.contains("type") && geometry.at("type").is_string() &&
            geometry.contains("coordinates") && geometry.at("coordinates").is_array(),"Invalid Copernicus footprint");
        auto type=geometry.at("type").get<std::string>();
        require(type=="Polygon" || type=="MultiPolygon","Unsupported Copernicus footprint type"); break;
    }
    Json feature={{"type","Feature"},{"geometry",geometry},{"properties",{{"provider","Copernicus CDSE"},
        {"product_id",product.at("Id")},{"source_file",name},{"metadata",product}}}};
    AtomicOutput out(output); out.stream << feature.dump() << '\n'; out.finish(); return {1,0,{}};
}
Json ParsingController::run(const Json& c, Controller* storage) const {
    validate(c); const auto& settings=c.at("storage"); bool upload=settings.at("enabled").get<bool>();
    require(!upload || storage,"An initialized Backblaze Controller is required");
    auto input=std::filesystem::weakly_canonical(std::filesystem::u8path(c.at("input_root").get<std::string>()));
    auto output=std::filesystem::weakly_canonical(std::filesystem::u8path(c.at("output_root").get<std::string>()));
    require(std::filesystem::is_directory(input),"input_root must be an existing directory");
    require(!within(output,input) && !within(input,output),"Input and output roots must be separate directory trees");
    auto id=runId(); auto root=output/id;
    std::filesystem::create_directories(output);
    require(std::filesystem::create_directory(root),"Run output already exists");
    auto manifestPath=root/"manifest.json";
    Json manifest={{"schema_version",1},{"run_id",id},{"status","parsing"},
        {"artifacts",Json::array()},{"assets",Json::array()},{"errors",Json::array()}};
    save(manifestPath,manifest);
    std::vector<std::filesystem::path> files;
    try {
        for (const auto& entry : std::filesystem::recursive_directory_iterator(input)) {
            if (entry.is_symlink() || !entry.is_regular_file()) continue;
            require(within(std::filesystem::weakly_canonical(entry.path()),input),"Input file resolves outside input_root");
            files.push_back(entry.path());
        }
        std::sort(files.begin(),files.end());
        for (const auto& path : files) {
            auto relative=path.lexically_relative(input); auto name=relative.generic_u8string();
            bool firms=name.rfind("firms/",0)==0 && path.extension()==".csv" && c.at("firms").at("enabled").get<bool>();
            bool cp=name.rfind("copernicus/",0)==0 && path.filename()=="metadata.json" && c.at("copernicus").at("enabled").get<bool>();
            if (!firms && !cp) {
                if (name.rfind("copernicus/",0)==0 && (path.filename()=="quicklook.image" || path.filename()=="product.zip" || path.filename()=="product.nc"))
                    manifest["assets"].push_back({{"source",name},{"bytes",std::filesystem::file_size(path)}});
                continue;
            }
            try {
                auto result=relative; result.replace_extension(".ndjson");
                auto before=sha1File(path);
                auto stats=firms ? parseFirms(path,root/result,c.at("firms"),name) : parseCopernicus(path,root/result,name);
                require(sha1File(path)==before,"Input changed during parsing; run again after ingestion finishes");
                manifest["artifacts"].push_back({{"source",name},{"source_sha1",before},{"parser",firms ? "firms_csv" : "copernicus_metadata"},
                    {"output",result.generic_u8string()},{"sha1",sha1File(root/result)},
                    {"bytes",std::filesystem::file_size(root/result)},{"accepted",stats.accepted},{"rejected",stats.rejected},
                    {"diagnostics",stats.diagnostics},{"upload_status",upload ? "pending" : "not_requested"}});
            } catch (const std::exception& e) {
                // These exceptions come only from local parsing and filesystem work.
                manifest["errors"].push_back({{"source",name},{"message",e.what()}});
            }
            save(manifestPath,manifest);
        }
        require(!manifest["artifacts"].empty(),"No supported data files were successfully parsed");
        require(manifest["errors"].empty(),"One or more input files failed; inspect the run manifest");
        manifest["status"]="parsed"; save(manifestPath,manifest);
        if (upload) {
            auto bucket=settings.at("bucket").get<std::string>(); auto prefix=remotePrefix(settings)+"/"+id+"/";
            manifest["status"]="uploading"; save(manifestPath,manifest);
            for (auto& artifact : manifest["artifacts"]) {
                auto relative=artifact.at("output").get<std::string>();
                artifact["upload_status"]="uploading"; save(manifestPath,manifest);
                auto response=storage->upload(bucket,root/std::filesystem::u8path(relative),prefix+relative,"application/x-ndjson");
                artifact["upload_status"]="uploaded";
                artifact["storage"]={{"bucket",bucket},{"key",prefix+relative},{"file_id",response.at("fileId")}};
                save(manifestPath,manifest);
            }
            if (settings.value("upload_assets",false)) for (auto& asset : manifest["assets"]) {
                auto name=asset.at("source").get<std::string>(); asset["upload_status"]="uploading"; save(manifestPath,manifest);
                auto response=storage->upload(bucket,input/std::filesystem::u8path(name),prefix+"assets/"+name);
                asset["upload_status"]="uploaded";
                asset["storage"]={{"bucket",bucket},{"key",prefix+"assets/"+name},{"file_id",response.at("fileId")}};
                save(manifestPath,manifest);
            }
            manifest["status"]="complete";
            manifest["storage"]={{"bucket",bucket},{"manifest_key",prefix+"manifest.json"}}; save(manifestPath,manifest);
            // Publish last: this is the marker that the batch is ready to consume.
            storage->upload(bucket,manifestPath,prefix+"manifest.json","application/json");
        } else manifest["status"]="complete";
        save(manifestPath,manifest); return manifest;
    } catch (...) {
        manifest["status"]="failed";
        if (manifest["errors"].empty()) manifest["errors"].push_back({{"message","Run failed during discovery, parsing or upload; uploaded objects are retained"}});
        save(manifestPath,manifest); throw;
    }
}
}
