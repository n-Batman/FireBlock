"""Stable file entry point used by the C++ launcher (no PYTHONPATH required)."""
from fireblock_analysis.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
