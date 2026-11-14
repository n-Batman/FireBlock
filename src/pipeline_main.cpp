#include "fireblock/raw_data.hpp"
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>

int main(int argc,char** argv) {
    if (argc==1 || std::string(argv[1])=="--help" || std::string(argv[1])=="help") {
        std::cout << "FireBlock raw-data storage pipeline (no parser required)\n"
            "  fireblock_pipeline scrape INGEST.json [--work raw-work] [--bucket NAME] [--prefix raw] [--env FILE]\n"
            "  fireblock_pipeline publish INPUT_ROOT [--bucket NAME] [--prefix raw] [--env FILE]\n"
            "  fireblock_pipeline pull MANIFEST_FILE_ID DESTINATION [--env FILE]\n"
            "Scrape downloads into a fresh work directory and archives raw files in B2.\n"
            "Publish archives existing raw ingestion files. Pull restores a complete,\n"
            "checksum-verified dataset into a NEW destination for a future parser.\n"
            "B2 credentials/bucket come from environment or .env; provider credentials use environment.\n";
        return 0;
    }
    try {
        std::string command=argv[1];
        if (command!="scrape" && command!="publish" && command!="pull") throw std::runtime_error("Unknown pipeline command");
        std::vector<std::string> args; std::map<std::string,std::string> options;
        std::set<std::string> allowed{"--env"};
        if (command!="pull") { allowed.insert("--bucket"); allowed.insert("--prefix"); }
        if (command=="scrape") allowed.insert("--work");
        for (int i=2;i<argc;++i) {
            std::string arg=argv[i];
            if (arg.rfind("--",0)!=0) { args.push_back(arg); continue; }
            if (!allowed.count(arg) || options.count(arg) || i+1>=argc) throw std::runtime_error("Unknown/duplicate option or missing value");
            auto value=std::string(argv[++i]);
            if (value.empty() || value.rfind("--",0)==0) throw std::runtime_error("Missing option value");
            options[arg]=value;
        }
        if (args.size()!=static_cast<size_t>(command=="pull" ? 2 : 1)) throw std::runtime_error("Wrong argument count; run fireblock_pipeline --help");
        auto env=std::filesystem::u8path(options.count("--env") ? options.at("--env") : ".env");
        if (options.count("--env") && !std::filesystem::exists(env)) throw std::runtime_error("Specified credential file does not exist");
        fireblock::loadEnv(env);
        auto bucket=options.count("--bucket") ? options.at("--bucket") : fireblock::environment("B2_BUCKET_NAME");
        auto prefix=options.count("--prefix") ? options.at("--prefix") : "raw";
        fireblock::Controller storage(fireblock::environment("B2_APPLICATION_KEY_ID"),fireblock::environment("B2_APPLICATION_KEY"));
        fireblock::RawDataController pipeline(storage); fireblock::Json result;
        if (command=="publish") result=pipeline.publish(std::filesystem::u8path(args[0]),bucket,prefix);
        else if (command=="pull") result=pipeline.pull(args[0],std::filesystem::u8path(args[1]));
        else {
            std::ifstream in(std::filesystem::u8path(args[0])); if (!in) throw std::runtime_error("Cannot open ingestion configuration");
            auto config=fireblock::Json::parse(in,nullptr,false);
            auto work=std::filesystem::u8path(options.count("--work") ? options.at("--work") : "raw-work");
            result=pipeline.scrape(config,work,bucket,prefix);
        }
        std::cout << result.dump(2) << '\n'; return 0;
    } catch (const std::exception& e) { std::cerr << "Raw pipeline failed: " << e.what() << '\n'; return 1; }
}
