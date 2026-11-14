"""Upload a tiny random PNG and verify it by downloading it from Backblaze B2.

Uses only Python's standard library so this diagnostic works independently of
the C++ build and raster dependencies. Leaves the uploaded test object in B2.
"""
import base64
import hashlib
import json
import os
import struct
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def credentials():
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    result = {name: os.environ.get(name) or values.get(name, "") for name in
              ("B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET_NAME")}
    if any(not v or v.startswith(("replace-with-", "your-")) for v in result.values()):
        raise ValueError("Configure B2 credentials and bucket in .env")
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, token, body=None, headers=None):
    if not url.startswith("https://"):
        raise ValueError("HTTPS required")
    header = {"Authorization": token, **(headers or {})}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        header["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=header)
    with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
        return response.read()


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + os.urandom(32 * 3) for _ in range(32))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def main():
    output = ROOT / "build" / "smoke-tests"
    output.mkdir(parents=True, exist_ok=True)
    identity = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8]
    image = png()
    path = output / (identity + ".png")
    path.write_bytes(image)
    receipt = {"status": "created", "local_image": str(path), "bytes": len(image),
               "sha256": hashlib.sha256(image).hexdigest(), "width": 32, "height": 32,
               "object_key": "tests/smoke/" + identity + ".png"}
    stage = "credentials"
    try:
        settings = credentials()
        auth = base64.b64encode((settings["B2_APPLICATION_KEY_ID"] + ":" + settings["B2_APPLICATION_KEY"]).encode()).decode()
        stage = "authorize"
        authorized = json.loads(request("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", "Basic " + auth))
        storage = authorized["apiInfo"]["storageApi"]
        token = authorized["authorizationToken"]
        api = storage["apiUrl"] + "/b2api/v4/"
        bucket_name = settings["B2_BUCKET_NAME"]
        bucket_id = next((b["id"] for b in storage["allowed"].get("buckets") or [] if b.get("name") == bucket_name), None)
        if bucket_id is None:
            stage = "resolve_bucket"
            buckets = json.loads(request(api + "b2_list_buckets", token,
                                {"accountId": authorized["accountId"], "bucketName": bucket_name}))["buckets"]
            bucket_id = next(b["bucketId"] for b in buckets if b["bucketName"] == bucket_name)
        stage = "get_upload_url"
        target = json.loads(request(api + "b2_get_upload_url", token, {"bucketId": bucket_id}))
        stage = "upload"
        uploaded = json.loads(request(target["uploadUrl"], target["authorizationToken"], image,
                    {"Content-Type": "image/png", "X-Bz-File-Name": urllib.parse.quote(receipt["object_key"], safe=""),
                     "X-Bz-Content-Sha1": hashlib.sha1(image).hexdigest()}))
        receipt.update(status="uploaded", bucket=bucket_name, file_id=uploaded["fileId"])
        stage = "download_verify"
        # Verify the exact uploaded version rather than a mutable object name.
        downloaded = request(storage["downloadUrl"] + "/b2api/v4/b2_download_file_by_id?fileId="
                             + urllib.parse.quote(uploaded["fileId"], safe=""), token)
        if downloaded != image:
            raise ValueError("Downloaded bytes differ from the uploaded image")
        receipt.update(status="verified", downloaded_sha256=hashlib.sha256(downloaded).hexdigest())
        return_code = 0
    except Exception as error:
        # Raw errors/response bodies can contain provider information; omit them.
        receipt.update(failed_stage=stage, error_type=type(error).__name__)
        if isinstance(error, urllib.error.HTTPError):
            receipt["http_status"] = error.code
        return_code = 1
    receipt_path = output / (identity + ".json")
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({**receipt, "receipt": str(receipt_path)}, indent=2))
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
