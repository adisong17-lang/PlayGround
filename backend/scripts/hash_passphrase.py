from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gulshan_api.security import hash_passphrase


def main() -> None:
    passphrase = getpass.getpass("New API passphrase: ")
    confirmation = getpass.getpass("Confirm passphrase: ")
    if passphrase != confirmation:
        raise SystemExit("Passphrases do not match.")
    if len(passphrase) < 12:
        raise SystemExit("Use at least 12 characters.")
    print(hash_passphrase(passphrase))


if __name__ == "__main__":
    main()
