import argparse
import json
import sys
from pathlib import Path
from .pipeline import ingest_to_cloud, run, validate
from .controller import ParserController


def main():
    parser = argparse.ArgumentParser(description="Sentinel-2 and FIRMS worker connected to the FireBlock C++ backend")
    sub = parser.add_subparsers(dest="command", required=True)
    analysis = sub.add_parser("run", help="Download B2 inputs, analyze, and upload a completed manifest")
    analysis.add_argument("job")
    analysis.add_argument("--validate", action="store_true", help="Check job structure without network or raster dependencies")
    risk = sub.add_parser("risk", help="Parse local/B2 inputs and generate a relative fire-risk map")
    risk.add_argument("job")
    risk.add_argument("--validate", action="store_true", help="Validate map and source settings without processing")
    cloud = sub.add_parser("cloud", help="Discover stored datasets through the C++ storage controller and parse them")
    cloud.add_argument("job")
    cloud.add_argument("--validate", action="store_true", help="Validate settings without accessing B2")
    cloud.add_argument("--discover-only", action="store_true", help="Resolve inputs without parsing or uploading results")
    cloud.add_argument("--job-out", help="Save the resolved version-pinned analysis job")
    ingest = sub.add_parser("ingest", help="Run C++ scraper and stage raw data in B2")
    ingest.add_argument("ingest_config")
    ingest.add_argument("--storage-config", required=True, help="Analysis job containing storage settings")
    ingest.add_argument("--job-out", required=True, help="Write generated analysis job here")
    args = parser.parse_args()
    try:
        if args.command == "risk":
            job = json.loads(Path(args.job).read_text(encoding="utf-8-sig"))
            if not job.get("risk", {}).get("enabled", False):
                raise ValueError("Risk command requires risk.enabled=true")
            if "source" in job:
                ParserController.validate(job)
                if args.validate:
                    print("Cloud risk-map configuration valid")
                else:
                    print(ParserController.from_config(job).run(job))
            else:
                validate(job)
                if args.validate:
                    print("Risk-map configuration valid")
                else:
                    print(run(job))
        elif args.command == "cloud":
            from .pipeline import write_json
            job = json.loads(Path(args.job).read_text(encoding="utf-8-sig"))
            if args.validate:
                ParserController.validate(job)
                print("Cloud parser configuration valid")
            else:
                controller = ParserController.from_config(job)
                if args.discover_only or args.job_out:
                    resolved = controller.discover(job)
                    if args.job_out:
                        Path(args.job_out).parent.mkdir(parents=True, exist_ok=True)
                        write_json(args.job_out, resolved)
                    if args.discover_only:
                        print(json.dumps(resolved["discovery"], indent=2))
                    else:
                        print(run(resolved, controller.storage))
                else:
                    print(controller.run(job))
        elif args.command == "run":
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
