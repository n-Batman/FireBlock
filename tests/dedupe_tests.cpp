#include "fireblock/raw_data.hpp"
#include <windows.h>
#include <fstream>
#include <map>
#include <iostream>
using namespace fireblock;
void check(bool ok){if(!ok)throw std::runtime_error("Satellite deduplication assertion failed");}
void write(const std::filesystem::path& path,const std::string& data){std::filesystem::create_directories(path.parent_path());std::ofstream out(path,std::ios::binary);out<<data;}
std::string read(const std::filesystem::path& path){std::ifstream in(path,std::ios::binary);return {std::istreambuf_iterator<char>(in),{}};}
Response json(const Json& value){return {200,value.dump()};}
int main(){
 auto root=std::filesystem::temp_directory_path()/("fireblock-dedupe-"+std::to_string(GetCurrentProcessId()));
 std::filesystem::create_directory(root);
 _putenv_s("FIREBLOCK_INDEX_DIR",(root/"index").u8string().c_str());
 try{
  struct Object{std::string key,data,hash;};std::map<std::string,Object> objects;
  int sequence=0,imageUploads=0,listings=0;
  Controller storage("id","key",[&](const Request& r)->Response{
   if(r.url.find("b2_authorize_account")!=std::string::npos)return {200,R"({"accountId":"a","authorizationToken":"token","apiInfo":{"storageApi":{"apiUrl":"https://api.test","downloadUrl":"https://download.test","allowed":{"buckets":[{"id":"b","name":"bucket"}]}}}})"};
   if(r.url.find("b2_get_upload_url")!=std::string::npos)return json({{"uploadUrl","https://upload.test"},{"authorizationToken","upload"}});
   if(r.url=="https://upload.test"){
    std::string encoded;for(auto& h:r.headers)if(h.first=="X-Bz-File-Name")encoded=h.second;
    // Decode percent-encoded ASCII object names emitted by the storage layer.
    std::string key;for(size_t i=0;i<encoded.size();++i){if(encoded[i]=='%'){key+=static_cast<char>(std::stoi(encoded.substr(i+1,2),nullptr,16));i+=2;}else key+=encoded[i];}
    auto id="file-"+std::to_string(++sequence);auto data=read(r.upload),hash=sha1File(r.upload);objects[id]={key,data,hash};
    if(key.rfind("satellite/",0)==0)++imageUploads;
    return json({{"fileId",id},{"contentLength",data.size()},{"contentSha1",hash}});
   }
   auto body=r.body.empty()?Json::object():Json::parse(r.body);
   if(r.url.find("b2_list_file_names")!=std::string::npos){++listings;Json files=Json::array();for(auto& pair:objects)if(pair.second.key.rfind(body.at("prefix").get<std::string>(),0)==0)files.push_back({{"fileName",pair.second.key},{"fileId",pair.first}});return json({{"files",files},{"nextFileName",nullptr}});}
   if(r.url.find("b2_get_file_info")!=std::string::npos){auto id=body.at("fileId").get<std::string>();auto it=objects.find(id);if(it==objects.end())return {404,"{\"code\":\"file_not_present\"}"};auto& o=it->second;return json({{"fileId",id},{"fileName",o.key},{"contentLength",o.data.size()},{"contentSha1",o.hash}});}
   auto at=r.url.find("fileId=");check(at!=std::string::npos);write(r.download,objects.at(r.url.substr(at+7)).data);return {200,""};
  });
  RawDataController raw(storage);std::string id="00000000-0000-0000-0000-000000000001";
  auto product=root/"source/copernicus"/id;
  write(product/"quicklook.image","image-bytes");write(product/"metadata.json","{\"Id\":\""+id+"\",\"Name\":\"test\"}");
  write(product/"product.zip","full-product-bytes");
  raw.publish(root/"source","bucket");check(imageUploads==2);
  int before=listings;raw.publish(root/"source","bucket");check(imageUploads==2 && listings==before);
  std::filesystem::remove(root/"index/satellite-index.json");raw.publish(root/"source","bucket");check(imageUploads==2 && listings>before);
  Json cfg={{"bbox",{0,0,1,1}},{"start","2026-11-01"},{"end","2026-11-02"},{"output","unused"},{"firms",{{"enabled",false}}},{"copernicus",{{"enabled",true},{"collection","SENTINEL-2"},{"max_products",1},{"quicklooks",true},{"products",true}}}};
  int sourceDownloads=0;
  auto receipt=raw.scrape(cfg,root/"work","bucket","raw",[&](const Request& r)->Response{
   if(!r.download.empty()){++sourceDownloads;throw std::runtime_error("Should reuse cloud image");}
   return json({{"value",Json::array({{{"Id",id},{"Name","test"},{"Online",true},{"Assets",Json::array({{{"Type","QUICKLOOK"},{"DownloadLink","https://catalogue.dataspace.copernicus.eu/odata/v1/Assets(test)/$value"}}})}}})}});
  });
  check(sourceDownloads==0 && imageUploads==2 && receipt.at("verified")==true);
  raw.pull(receipt.at("manifest_file_id").get<std::string>(),root/"restored");
  check(read(root/"restored/copernicus"/id/"quicklook.image")=="image-bytes");
  check(read(root/"restored/copernicus"/id/"product.zip")=="full-product-bytes");
  std::cout<<"Satellite reuse, index recovery, no repeat download/upload and exact restore passed\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
 std::error_code ec;std::filesystem::remove_all(root,ec);return 0;
}
