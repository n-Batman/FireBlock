#include "fireblock/raw_data.hpp"
#include <windows.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cwchar>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>
#include <regex>

namespace fireblock {
namespace {
void require(bool ok,const char* message) { if (!ok) throw std::runtime_error(message); }
std::string identifier() {
    static std::atomic<unsigned long long> sequence{0};
    return std::to_string(std::chrono::system_clock::now().time_since_epoch().count())+"-"+
        std::to_string(GetCurrentProcessId())+"-"+std::to_string(sequence.fetch_add(1));
}
std::string lower(std::string s) {
    std::transform(s.begin(),s.end(),s.begin(),[](unsigned char ch) { return static_cast<char>(std::tolower(ch)); }); return s;
}
// Manifest paths are a portable slash-separated subset that is safe on Windows.
void relativePath(const std::string& name) {
    require(!name.empty() && name.front()!='/' && name.back()!='/' &&
        name.find_first_of("\\:*?\"<>|\r\n") == std::string::npos,"Invalid manifest path");
    for (unsigned char ch : name) require(ch>=32 && ch!=127,"Invalid manifest path character");
    std::istringstream in(name); std::string component;
    while (std::getline(in,component,'/')) {
        require(!component.empty() && component!="." && component!=".." && component.back()!='.' && component.back()!=' ',"Invalid manifest path component");
        auto base=lower(component.substr(0,component.find('.')));
        require(base!="con" && base!="prn" && base!="aux" && base!="nul" &&
            !(base.size()==4 && (base.rfind("com",0)==0 || base.rfind("lpt",0)==0) && base[3]>='0' && base[3]<='9'),"Reserved manifest filename");
        // ASCII filenames are sufficient for the generated ingestion layout and
        // avoid Unicode case-alias ambiguity when restoring on Windows.
        require(component.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-. ()") == std::string::npos,
            "Unsupported raw-data filename");
    }
}
bool rawFile(const std::string& name) {
    return name.rfind("firms/",0)==0 || name.rfind("copernicus/",0)==0;
}
bool within(const std::filesystem::path& child,const std::filesystem::path& parent) {
    auto a=child.begin();
    for (auto b=parent.begin();b!=parent.end();++a,++b)
        if (a==child.end() || _wcsicmp(a->c_str(),b->c_str())!=0) return false;
    return true;
}
void save(const std::filesystem::path& file,const Json& data) {
    auto part=file; part += ".part";
    std::ofstream out(part,std::ios::binary|std::ios::trunc); out << data.dump(2) << '\n'; out.close();
    require(bool(out),"Cannot save raw-data manifest");
    require(MoveFileExW(part.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0,"Cannot commit raw-data manifest");
}
std::filesystem::path indexDirectory() {
    auto configured=environment("FIREBLOCK_INDEX_DIR");
    return configured.empty()?std::filesystem::current_path()/".cache":std::filesystem::u8path(configured);
}
struct IndexLock {
    static thread_local int depth;
    HANDLE handle=INVALID_HANDLE_VALUE;
    IndexLock(){
        if(depth==0){
            auto dir=indexDirectory();std::filesystem::create_directories(dir);
            handle=CreateFileW((dir/"satellite.lock").c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
            require(handle!=INVALID_HANDLE_VALUE,"Another satellite collection is active; retry when it finishes");
        }
        ++depth;
    }
    ~IndexLock(){--depth;if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
};
thread_local int IndexLock::depth=0;
std::string satelliteKey(const std::string& path) {
    static const std::regex pattern("copernicus/([a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})/(product\\.zip|product\\.nc|quicklook\\.image)");
    std::smatch match;if(!std::regex_match(path,match,pattern))return "";
    return "satellite/"+lower(match[1].str())+"/"+match[3].str();
}
class SatelliteIndex {
    Controller& storage;
    std::string bucket;
    Json records=Json::object();
    std::filesystem::path file=indexDirectory()/"satellite-index.json";
public:
    SatelliteIndex(Controller& s,std::string b):storage(s),bucket(std::move(b)) {
        if(std::filesystem::exists(file)&&std::filesystem::file_size(file)<=4*1024*1024){
            std::ifstream in(file);auto value=Json::parse(in,nullptr,false);if(value.is_object())records=std::move(value);
        }
    }
    Json find(const std::string& key){
        auto cacheKey=bucket+"/"+key;
        if(records.contains(cacheKey)){
            try{
                const auto& record=records.at(cacheKey);
                auto info=storage.info(record.at("file_id").get<std::string>());
                if(info.value("fileName","")==key && info.at("contentLength")==record.at("bytes") && info.at("contentSha1")==record.at("sha1"))return record;
            }catch(const Json::exception&){
                // Malformed local metadata is disposable; recover from B2 below.
            }catch(const std::exception& e){
                if(std::string(e.what()).find("HTTP 404")==std::string::npos)throw;
            }
            records.erase(cacheKey);
        }
        // A lost/evicted local index is recoverable from a tiny UUID-specific
        // cloud listing, never a full-bucket scan or imagery download.
        auto objects=storage.files(bucket,key);
        for(const auto& object:objects)if(object.value("fileName","")==key){
            auto info=storage.info(object.at("fileId").get<std::string>());
            auto hash=info.value("contentSha1",std::string());
            if(hash.size()!=40 || hash.find_first_not_of("0123456789abcdef")!=std::string::npos)continue;
            Json record={{"key",key},{"file_id",object.at("fileId")},{"bytes",info.at("contentLength")},{"sha1",hash}};
            remember(key,record);return record;
        }
        return nullptr;
    }
    void remember(const std::string& key,const Json& record){records[bucket+"/"+key]=record;}
    void flush(){
        while(records.size()>5000)records.erase(records.begin());
        while(records.dump(2).size()+1>4*1024*1024 && !records.empty())records.erase(records.begin());
        save(file,records);
    }
};
std::string mime(const std::filesystem::path& p) {
    if (p.extension()==".json") return "application/json";
    if (p.extension()==".csv") return "text/csv";
    if (p.extension()==".zip") return "application/zip";
    if (p.extension()==".nc") return "application/x-netcdf";
    return "application/octet-stream";
}
}
Json RawDataController::scrape(const Json& config,const std::filesystem::path& work,
        const std::string& bucket,const std::string& prefix,Transport transport) {
    Ingestor::validate(config); relativePath(prefix); require(!bucket.empty(),"Bucket is required");
    auto root=std::filesystem::absolute(work)/identifier();
    std::filesystem::create_directories(root.parent_path());
    require(std::filesystem::create_directory(root),"Scrape work directory already exists");
    auto adjusted=config; adjusted["output"]=root.u8string();
    adjusted["copernicus"].erase("local_cache_root"); // archives must be self-contained apart from verified cloud references
    // Every scrape starts from an isolated tree, so old NRT files cannot leak into
    // a new archive. Provider failures prevent publication of the raw manifest.
    IndexLock lock;
    SatelliteIndex index(storage_,bucket);
    Ingestor(std::move(transport),[&](const std::string& id,const std::string& asset){
        auto path="copernicus/"+id+"/"+asset;
        auto key=satelliteKey(path);if(key.empty())return false;
        auto record=index.find(key);if(record.is_null())return false;
        auto refs=root/"copernicus"/id/"cloud-assets.json";
        Json entries=Json::object();if(std::filesystem::exists(refs)){std::ifstream in(refs);entries=Json::parse(in);}
        entries[asset]=record;save(refs,entries);
        std::cout<<"Reusing cloud satellite asset: "<<id<<"/"<<asset<<'\n';return true;
    }).run(adjusted);
    index.flush();
    auto result=publish(root,bucket,prefix);
    if(result.value("verified",false)) {
        bool cleaned=true;
        std::ifstream in(std::filesystem::u8path(result.at("local_manifest").get<std::string>()));
        auto manifest=Json::parse(in); in.close();
        // The fresh scrape directory belongs to this call. Remove only verified
        // inventory files, not user-selected publish inputs or arbitrary trees.
        for(const auto& entry : manifest.at("files")) {
            auto name=entry.at("path").get<std::string>(); relativePath(name);
            auto file=root/std::filesystem::u8path(name);
            if(!std::filesystem::exists(file))continue; // shared cloud reference, never downloaded here
            if(!std::filesystem::is_symlink(file) && within(std::filesystem::canonical(file),std::filesystem::canonical(root))) {
                std::error_code ec; std::filesystem::remove(file,ec); if(ec)cleaned=false;
            } else cleaned=false;
        }
        result["local_raw_files_removed"]=cleaned;
    }
    return result;
}
Json RawDataController::publish(const std::filesystem::path& input,const std::string& bucket,const std::string& prefix) {
    IndexLock lock;
    SatelliteIndex index(storage_,bucket);
    std::cerr << std::unitbuf;
    relativePath(prefix); require(!bucket.empty(),"Bucket is required");
    auto root=std::filesystem::canonical(input); require(std::filesystem::is_directory(root),"Raw input must be a directory");
    std::vector<std::filesystem::path> files; std::set<std::string> paths;
    for (const auto& entry : std::filesystem::recursive_directory_iterator(root)) {
        if (!entry.is_regular_file()) continue;
        auto name=entry.path().lexically_relative(root).generic_u8string();
        if (!rawFile(name)) continue;
        require(!entry.is_symlink() && within(std::filesystem::canonical(entry.path()),root),"Raw input resolves outside dataset");
        require(entry.path().extension()!=".part","Finish ingestion before publishing: partial file exists");
        require(std::filesystem::file_size(entry.path())<=5000000000ULL,"Raw file exceeds storage layer's 5 GB single-file limit");
        relativePath(name); require(paths.insert(lower(name)).second,"Raw paths collide on Windows");
        files.push_back(entry.path());
    }
    require(!files.empty(),"No raw provider files found");
    require(files.size()<=100000,"Raw batch exceeds 100000 files; split the batch");
    std::sort(files.begin(),files.end());
    auto id=identifier(), remote=prefix+"/"+id+"/";
    auto receipt=root/("raw-manifest-"+id+".json");
    Json manifest={{"schema_version",1},{"kind","fireblock.raw"},{"run_id",id},{"status","uploading"},
        {"bucket",bucket},{"prefix",remote},{"files",Json::array()}};
    save(receipt,manifest);
    bool verified=true;
    std::cerr << "Archiving raw dataset: " << files.size() << " files\n";
    try {
        for (const auto& file : files) {
            auto name=file.lexically_relative(root).generic_u8string();
            std::cerr << "Uploading " << manifest["files"].size()+1 << "/" << files.size() << ": " << name << '\n';
            auto bytes=std::filesystem::file_size(file);
            auto hash=sha1File(file);
            auto canonical=satelliteKey(name);
            auto existing=canonical.empty()?Json():index.find(canonical);
            Json result;
            auto key=canonical.empty()?remote+name:canonical;
            if(!existing.is_null()){
                require(existing.at("sha1")==hash && existing.at("bytes")==bytes,"Satellite UUID asset changed; refusing to overwrite its immutable identity");
                result={{"fileId",existing.at("file_id")},{"contentSha1",hash},{"contentLength",bytes}};
            }else result=storage_.upload(bucket,file,key,mime(file));
            verified=verified && result.value("contentSha1",std::string())==hash && result.value("contentLength",uintmax_t(-1))==bytes;
            require(std::filesystem::file_size(file)==bytes && sha1File(file)==hash,"Raw input changed during upload");
            auto fileId=result.at("fileId").get<std::string>(); require(!fileId.empty(),"Missing uploaded file ID");
            Json entry={{"path",name},{"key",key},{"file_id",fileId},{"bytes",bytes},{"sha1",hash}};
            if(!canonical.empty()){
                entry["storage_kind"]="shared_satellite";
                entry["metadata_key"]=remote+"copernicus/"+std::filesystem::path(name).parent_path().filename().u8string()+"/metadata.json";
                if(result.value("contentSha1",std::string())==hash && result.value("contentLength",uintmax_t(-1))==bytes)index.remember(key,entry);
            }
            manifest["files"].push_back(entry);
            if(file.filename()=="cloud-assets.json"){
                std::ifstream in(file);auto references=Json::parse(in);
                for(auto it=references.begin();it!=references.end();++it){
                    auto assetPath=file.parent_path().lexically_relative(root).generic_u8string()+"/"+it.key();
                    auto assetKey=satelliteKey(assetPath);require(!assetKey.empty(),"Invalid satellite reference path");
                    auto reference=index.find(assetKey);require(!reference.is_null() && reference==it.value(),"Satellite reference is no longer valid");
                    reference["path"]=assetPath;reference["storage_kind"]="shared_satellite";
                    reference["metadata_key"]=remote+file.parent_path().lexically_relative(root).generic_u8string()+"/metadata.json";
                    manifest["files"].push_back(reference);
                }
            }
            save(receipt,manifest);
        }
        index.flush();
        manifest["status"]="complete"; save(receipt,manifest);
        require(std::filesystem::file_size(receipt)<=32ULL*1024*1024,"Raw manifest exceeds restore limit; split the batch");
        auto result=storage_.upload(bucket,receipt,remote+"manifest.json","application/json");
        verified=verified && result.value("contentSha1",std::string())==sha1File(receipt) && result.value("contentLength",uintmax_t(-1))==std::filesystem::file_size(receipt);
        return {{"manifest_file_id",result.at("fileId")},{"manifest_key",remote+"manifest.json"},
            {"local_manifest",receipt.u8string()},{"files",manifest["files"].size()},{"run_id",id},{"verified",verified}};
    } catch (...) { manifest["status"]="failed"; save(receipt,manifest); throw; }
}
Json RawDataController::pull(const std::string& id,const std::filesystem::path& destination) {
    require(!id.empty(),"Manifest file ID is required");
    auto target=std::filesystem::absolute(destination).lexically_normal();
    require(!std::filesystem::exists(target),"Restore destination must not exist");
    auto info=storage_.info(id);
    require(info.at("contentLength").get<uintmax_t>()<=32ULL*1024*1024,"Raw manifest exceeds 32 MB limit");
    std::filesystem::create_directories(target.parent_path());
    auto stage=target.parent_path()/(".raw-pull-"+identifier());
    require(std::filesystem::create_directory(stage),"Restore staging directory already exists");
    try {
        auto file=stage/"raw-manifest.json"; storage_.downloadVersion(id,file);
        std::ifstream in(file,std::ios::binary); auto manifest=Json::parse(in,nullptr,false); in.close();
        require(manifest.is_object() && manifest.value("schema_version",0)==1 &&
            manifest.value("kind","")=="fireblock.raw" && manifest.value("status","")=="complete","Not a completed raw-data manifest");
        require(manifest.contains("files") && manifest["files"].is_array() && !manifest["files"].empty() && manifest["files"].size()<=100000,"Invalid raw file inventory");
        auto prefix=manifest.at("prefix").get<std::string>();
        require(!prefix.empty() && prefix.back()=='/',"Invalid raw batch prefix"); relativePath(prefix.substr(0,prefix.size()-1));
        std::set<std::string> paths,ids;
        for (const auto& entry : manifest["files"]) {
            auto name=entry.at("path").get<std::string>(); relativePath(name);
            require(rawFile(name) && std::filesystem::u8path(name).extension()!=".part","Unsupported raw inventory path");
            require(paths.insert(lower(name)).second,"Duplicate raw inventory path");
            auto expected=entry.value("storage_kind","")=="shared_satellite"?satelliteKey(name):prefix+name;
            require(!expected.empty() && entry.at("key").get<std::string>()==expected,"Raw object is outside its batch or satellite identity");
            auto fileId=entry.at("file_id").get<std::string>(); require(!fileId.empty() && ids.insert(fileId).second,"Invalid or duplicate raw file ID");
            auto hash=entry.at("sha1").get<std::string>();
            require(hash.size()==40 && hash.find_first_not_of("0123456789abcdef")==std::string::npos,"Invalid raw SHA-1");
            require(entry.at("bytes").is_number_unsigned(),"Invalid raw byte count");
            require(entry.at("bytes").get<uintmax_t>()<=5000000000ULL,"Raw inventory exceeds single-file limit");
        }
        // Validate the complete inventory before creating any inventory paths.
        for (const auto& entry : manifest["files"]) {
            auto local=stage/std::filesystem::u8path(entry.at("path").get<std::string>());
            std::filesystem::create_directories(local.parent_path());
            storage_.downloadVersion(entry.at("file_id").get<std::string>(),local);
            require(std::filesystem::file_size(local)==entry.at("bytes").get<uintmax_t>() &&
                sha1File(local)==entry.at("sha1").get<std::string>(),"Restored raw file does not match manifest");
        }
        // The parser sees the target directory only after every file is verified.
        require(MoveFileExW(stage.c_str(),target.c_str(),MOVEFILE_WRITE_THROUGH)!=0,"Cannot commit restored dataset; destination must remain absent");
        return {{"input_root",target.u8string()},{"manifest_file_id",id},{"files",manifest["files"].size()},{"run_id",manifest.at("run_id")}};
    } catch (...) { std::error_code ec; std::filesystem::remove_all(stage,ec); throw; }
}
}
