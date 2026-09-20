#!/usr/bin/env python3
"""Keep the journal offline: thin wrapper over local_boundary.check (see that module for the rules)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_boundary import main
sys.exit(main(Path(__file__).resolve().parents[1]))
