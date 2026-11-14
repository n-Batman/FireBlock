#include "fireblock/csv.hpp"
#include <stdexcept>
#include <utility>

namespace fireblock {
bool readCsvRecord(std::istream& in, std::vector<std::string>& fields, size_t limit) {
    auto require=[](bool ok,const char* message) { if (!ok) throw std::runtime_error(message); };
    enum class State { start, plain, quoted, closed };
    fields.clear(); std::string field; State state=State::start; size_t bytes=0; bool any=false;
    for (;;) {
        int next=in.get();
        if (next==std::char_traits<char>::eof()) {
            require(!in.bad(),"Cannot read CSV input");
            require(state!=State::quoted,"Unterminated CSV quote");
            if (!any) return false;
            fields.push_back(std::move(field)); return true;
        }
        any=true; require(++bytes<=limit,"CSV record exceeds byte limit"); char ch=static_cast<char>(next);
        if (state==State::quoted) {
            if (ch=='"') state=State::closed; else field+=ch;
            continue;
        }
        if (state==State::closed && ch=='"') { field+='"'; state=State::quoted; continue; }
        if (ch==',' || ch=='\n' || ch=='\r') {
            fields.push_back(std::move(field)); field.clear(); state=State::start;
            if (ch==',') continue;
            if (ch=='\r' && in.peek()=='\n') in.get();
            return true;
        }
        require(state!=State::closed,"Unexpected character after CSV quote");
        if (ch=='"') { require(state==State::start,"Quote inside unquoted CSV field"); state=State::quoted; }
        else { field+=ch; state=State::plain; }
    }
}
}
