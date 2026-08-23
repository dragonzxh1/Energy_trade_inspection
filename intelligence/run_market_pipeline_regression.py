"""One-command deterministic regression suite for the structured market pipeline."""

from __future__ import annotations

import unittest
import sys
from pathlib import Path


def main() -> None:
    root=Path(__file__).resolve().parent.parent
    sys.path.insert(0,str(root))
    suite=unittest.defaultTestLoader.discover(
        str(Path(__file__).parent),pattern="test_*.py",top_level_dir=str(root)
    )
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful(): raise SystemExit(1)


if __name__=="__main__": main()
