"""JSON/files connector to existing C++ executables; never passes keys in argv."""
import json
import subprocess
from pathlib import Path


class Backend:
    def __init__(self, config):
        self.config = config
        self.executable = str(Path(config.get("executable", "build/native/fireblock.exe")).resolve())
        self.env_file = str(Path(config.get("env_file", ".env")).resolve())
        self.bucket = config.get("bucket", "")

    @staticmethod
    def execute(arguments):
        # C++ diagnostics and stdout are captured, since sharing/error output may be sensitive.
        try:
            result = subprocess.run(arguments, capture_output=True, encoding="utf-8", errors="replace",
                                    timeout=3600, check=False, shell=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("Could not execute C++ backend; check executable and build status") from exc
        if result.returncode:
            raise RuntimeError("C++ backend command failed; check credentials, capabilities, and input configuration")
        return result.stdout

    def call(self, *arguments):
        command = [self.executable, *map(str, arguments), "--env", self.env_file]
        if self.bucket and arguments[0] != "download-version":
            command += ["--bucket", self.bucket]
        return json.loads(self.execute(command))

    def download(self, key, destination):
        self.call("download", key, destination)

    def list_objects(self, prefix):
        return self.call("list", prefix)

    def download_version(self, file_id, destination):
        self.call("download-version", file_id, destination)

    def upload(self, source, key):
        response = self.call("upload", source, key)
        return {"key": key, "file_id": response["fileId"]}

    def ingest(self, config_path):
        executable = str(Path(self.config.get("ingest_executable", "build/native/fireblock_ingest.exe")).resolve())
        # Scraper takes CDSE/FIRMS credentials from its inherited environment.
        self.execute([executable, str(config_path)])
