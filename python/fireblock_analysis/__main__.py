import argparse
import json
import sys
from pathlib import Path
from .pipeline import ingest_to_cloud, run, validate


def main():
    parser = argparse.ArgumentParser(description="Sentinel-2 and FIRMS worker connected to the FireBlock C++ backend")
    sub = parser.add_subparsers(dest="command", required=True)
    analysis = sub.add_parser("run", help="Download B2 inputs, analyze, and upload a completed manifest")
    analysis.add_argument("job")
    analysis.add_argument("--validate", action="store_true", help="Check job structure without network or raster dependencies")
    ingest = sub.add_parser("ingest", help="Run C++ scraper and stage raw data in B2")
    ingest.add_argument("ingest_config")
    ingest.add_argument("--storage-config", required=True, help="Analysis job containing storage settings")
    ingest.add_argument("--job-out", required=True, help="Write generated analysis job here")
    args = parser.parse_args()
    try:
        if args.command == "run":
            job = json.loads(Path(args.job).read_text(encoding="utf-8-sig"))
            if args.validate:
                validate(job)
                print("Analysis configuration valid")
            else:
                print(run(job))
        else:
            storage = json.loads(Path(args.storage_config).read_text(encoding="utf-8-sig"))["storage"]
            ingest_to_cloud(args.ingest_config, storage, args.job_out)
            print(args.job_out)
        return 0
    except Exception as exc:
        # Provider URLs/credentials are never echoed by this CLI.
        print(f"Analysis failed ({type(exc).__name__}). Check inputs, dependencies and backend configuration.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
