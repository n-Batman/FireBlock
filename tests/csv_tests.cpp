#include "fireblock/csv.hpp"
#include <iostream>
#include <sstream>
#include <stdexcept>

using fireblock::readCsvRecord;
void check(bool ok) { if (!ok) throw std::runtime_error("CSV assertion failed"); }
int main() {
    try {
        std::vector<std::string> fields;
        for (auto newline : {std::string("\n"),std::string("\r\n"),std::string("\r")}) {
            std::istringstream in("a,\"b,b\",\"line\r\nbreak\",\"say \"\"hi\"\"\"," + newline + "last,row");
            check(readCsvRecord(in,fields));
            check(fields==std::vector<std::string>({"a","b,b","line\r\nbreak","say \"hi\"",""}));
            check(readCsvRecord(in,fields) && fields==std::vector<std::string>({"last","row"}));
            check(!readCsvRecord(in,fields));
        }
        for (auto malformed : {"\"unterminated","\"closed\"junk","unquoted\"quote"}) {
            bool caught=false; try { std::istringstream in(malformed); readCsvRecord(in,fields); }
            catch (const std::runtime_error&) { caught=true; } check(caught);
        }
        std::istringstream empty(""); check(!readCsvRecord(empty,fields));
        std::istringstream blanks("\n,,\n\"\"\n");
        check(readCsvRecord(blanks,fields) && fields==std::vector<std::string>({""}));
        check(readCsvRecord(blanks,fields) && fields==std::vector<std::string>({"","",""}));
        check(readCsvRecord(blanks,fields) && fields==std::vector<std::string>({""}));
        std::istringstream exact("12345"); check(readCsvRecord(exact,fields,5));
        bool caught=false; try { std::istringstream large("123456"); readCsvRecord(large,fields,5); }
        catch (const std::runtime_error&) { caught=true; } check(caught);
        std::istringstream broken("x"); broken.setstate(std::ios::badbit);
        caught=false; try { readCsvRecord(broken,fields); } catch (const std::runtime_error&) { caught=true; } check(caught);
        std::cout << "CSV tokenizer tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
