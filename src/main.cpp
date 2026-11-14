#include "fireblock/controller.hpp"
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <windows.h>

const char* help = R"(FireBlock - Backblaze B2 storage controller
Usage: fireblock COMMAND [arguments] [--bucket NAME] [--env FILE]

  account                             Show account ID and key permissions
  buckets                             List accessible buckets
  create-bucket NAME [--public]        Create encrypted private bucket by default
  visibility private|public --yes      Change selected bucket visibility
  delete-bucket --yes                  Delete selected EMPTY bucket
  list [PREFIX]                       List all current files (JSON)
  versions [PREFIX]                   List all versions and hide markers (JSON)
  upload LOCAL [REMOTE] [--type MIME]  Upload any file; default REMOTE is LOCAL basename
  download REMOTE LOCAL               Download without overwriting an existing file
  download-version FILE_ID LOCAL      Download and verify an exact stored version
  info FILE_ID                        Inspect one file version
  delete REMOTE FILE_ID --yes          Permanently delete exactly one version
  hide REMOTE                         Hide current file; keeps existing versions
  url REMOTE                          Print URL (public bucket or auth required)
  share REMOTE [--seconds 3600]        Print temporary bearer URL for private file
  help                                Show this help; no credentials needed

Credentials: B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY in .env or environment.
Default bucket: B2_BUCKET_NAME. Environment variables override .env.
Remote paths may use images/ or data/ prefixes. Quote paths containing spaces.
Sharing tokens grant access to ALL names starting with REMOTE; use unique names.
Uploads are streamed, SHA-1 verified by B2, and limited to 5 GB per file.
)";

int run(int argc, char** argv) {
    try {
        if (argc < 2 || std::string(argv[1]) == "help" || std::string(argv[1]) == "--help") { std::cout << help; return 0; }
        std::string command = argv[1];
        std::vector<std::string> args;
        std::map<std::string, std::string> options;
        const std::set<std::string> flags{"--yes", "--public"};
        const std::set<std::string> values{"--bucket", "--env", "--type", "--seconds"};
        for (int i = 2; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg.rfind("--", 0) != 0) { args.push_back(arg); continue; }
            if (options.count(arg)) throw std::runtime_error("Duplicate option: " + arg);
            if (flags.count(arg)) options[arg] = "true";
            else if (values.count(arg) && i + 1 < argc) options[arg] = argv[++i];
            else throw std::runtime_error("Unknown option or missing value: " + arg);
        }
        std::map<std::string, std::pair<size_t, size_t>> counts{
            {"account", {0,0}}, {"buckets", {0,0}}, {"create-bucket", {1,1}}, {"visibility", {1,1}},
            {"delete-bucket", {0,0}}, {"list", {0,1}}, {"versions", {0,1}}, {"upload", {1,2}},
            {"download", {2,2}}, {"download-version", {2,2}}, {"info", {1,1}}, {"delete", {2,2}}, {"hide", {1,1}}, {"url", {1,1}}, {"share", {1,1}}};
        auto count = counts.find(command);
        if (count == counts.end()) throw std::runtime_error("Unknown command: " + command);
        if (args.size() < count->second.first || args.size() > count->second.second) throw std::runtime_error("Wrong number of arguments; run fireblock help");
        std::set<std::string> allowed{"--env"};
        if (command != "account" && command != "buckets" && command != "create-bucket" && command != "info" && command != "delete" && command != "download-version") allowed.insert("--bucket");
        if (command == "create-bucket") allowed.insert("--public");
        if (command == "upload") allowed.insert("--type");
        if (command == "share") allowed.insert("--seconds");
        if (command == "delete" || command == "delete-bucket" || command == "visibility") allowed.insert("--yes");
        for (const auto& o : options) if (!allowed.count(o.first)) throw std::runtime_error("Option not supported by this command: " + o.first);
        if ((command == "delete" || command == "delete-bucket" || command == "visibility") && !options.count("--yes"))
            throw std::runtime_error("This operation requires --yes. Review the target first.");
        if (command == "visibility" && args[0] != "private" && args[0] != "public") throw std::runtime_error("Visibility must be private or public");
        int seconds = 3600;
        if (options.count("--seconds")) {
            size_t end = 0; seconds = std::stoi(options["--seconds"], &end);
            if (end != options["--seconds"].size() || seconds < 1 || seconds > 604800) throw std::runtime_error("--seconds must be 1..604800");
        }
        auto envFile = options.count("--env") ? std::filesystem::u8path(options["--env"]) : std::filesystem::path(".env");
        if (options.count("--env") && !std::filesystem::exists(envFile)) throw std::runtime_error("Specified --env file does not exist");
        fireblock::loadEnv(envFile);
        fireblock::Controller controller(fireblock::environment("B2_APPLICATION_KEY_ID"), fireblock::environment("B2_APPLICATION_KEY"));
        auto bucket = options.count("--bucket") ? options["--bucket"] : fireblock::environment("B2_BUCKET_NAME");
        fireblock::Json result;
        if (command == "account") result = controller.account();
        else if (command == "buckets") result = controller.buckets();
        else if (command == "create-bucket") result = controller.createBucket(args[0], options.count("--public") != 0);
        else if (command == "visibility") result = controller.setBucketPublic(bucket, args[0] == "public");
        else if (command == "delete-bucket") result = controller.deleteBucket(bucket);
        else if (command == "list" || command == "versions") result = controller.files(bucket, args.empty() ? "" : args[0], command == "versions");
        else if (command == "upload") {
            auto local = std::filesystem::u8path(args[0]);
            result = controller.upload(bucket, local, args.size() == 2 ? args[1] : local.filename().u8string(), options.count("--type") ? options["--type"] : "b2/x-auto");
        } else if (command == "download") {
            controller.download(bucket, args[0], std::filesystem::u8path(args[1]));
            result = {{"downloaded", args[1]}};
        } else if (command == "download-version") {
            controller.downloadVersion(args[0], std::filesystem::u8path(args[1]));
            result = {{"downloaded", args[1]}, {"fileId", args[0]}};
        } else if (command == "info") result = controller.info(args[0]);
        else if (command == "delete") result = controller.deleteVersion(args[0], args[1]);
        else if (command == "hide") result = controller.hide(bucket, args[0]);
        else if (command == "url") { std::cout << controller.url(bucket, args[0]) << '\n'; return 0; }
        else if (command == "share") { std::cout << controller.share(bucket, args[0], seconds) << '\n'; return 0; }
        std::cout << result.dump(2) << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FireBlock: " << error.what() << '\n'; return 1;
    }
}

int wmain(int argc, wchar_t** argv) {
    // Windows supplies UTF-16 arguments; preserve Unicode file and object names.
    std::vector<std::string> utf8;
    for (int i = 0; i < argc; ++i) {
        int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, nullptr, 0, nullptr, nullptr);
        if (!size) { std::cerr << "FireBlock: Invalid Unicode argument\n"; return 1; }
        std::string value(size, '\0');
        if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, value.data(), size, nullptr, nullptr)) return 1;
        value.pop_back(); utf8.push_back(std::move(value));
    }
    std::vector<char*> args;
    for (auto& value : utf8) args.push_back(value.data());
    args.push_back(nullptr);
    return run(argc, args.data());
}
