import {afterEach,describe,it,expect,vi} from "vitest";
const mocked=vi.hoisted(()=>({create:vi.fn(),download:vi.fn()}));
vi.mock("./grantReports",()=>({GrantReports:class{create=mocked.create;download=mocked.download;}}));
import {POST,GET} from "@/app/api/grant-reports/route";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
function request(body:unknown,token="private-token"){
  return new Request("https://app.test/api/grant-reports",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
}
describe("private grant report API",()=>{
  it("blocks anonymous callers before parsing or invoking AI/storage",async()=>{
    vi.stubEnv("CLOUD_WRITE_TOKEN","");expect((await POST(request({}))).status).toBe(503);
    vi.stubEnv("CLOUD_WRITE_TOKEN","private-token");expect((await POST(request({},"wrong"))).status).toBe(401);
    expect((await GET(new Request("https://app.test/api/grant-reports?report_id=x"))).status).toBe(401);expect(mocked.create).not.toHaveBeenCalled();
  });
  it("creates reports and downloads private PDFs without caching or exposing secrets",async()=>{
    vi.stubEnv("CLOUD_WRITE_TOKEN","private-token");mocked.create.mockResolvedValue({report_id:"report"});
    const made=await POST(request({project_name:"Example"}));expect(made.status).toBe(201);expect(made.headers.get("Cache-Control")).toContain("no-store");
    mocked.download.mockResolvedValue(Buffer.from("%PDF-test"));const response=await GET(new Request("https://app.test/api/grant-reports?report_id=report",{headers:{Authorization:"Bearer private-token"}}));
    expect(response.headers.get("Content-Type")).toBe("application/pdf");expect(await response.text()).toBe("%PDF-test");
  });
  it("caps payloads and redacts backend failure messages",async()=>{
    vi.stubEnv("CLOUD_WRITE_TOKEN","private-token");
    const huge=await POST(request({large:"x".repeat(12*1024*1024)}));expect(huge.status).toBe(413);expect(mocked.create).not.toHaveBeenCalled();
    mocked.create.mockRejectedValue(new Error("OpenAI key secret-value"));const failed=await POST(request({}));expect(failed.status).toBe(502);expect(await failed.text()).not.toContain("secret-value");
  });
});
