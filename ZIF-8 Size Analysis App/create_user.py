#!/usr/bin/env python3
"""Create one password hash for APP_USERS_JSON without printing the password."""

from __future__ import annotations

import argparse
import getpass
import json
from werkzeug.security import generate_password_hash


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    args = parser.parse_args()
    email = args.email.strip().casefold()
    if not email or "@" not in email:
        parser.error("a valid email address is required")
    first = getpass.getpass("Password: ")
    second = getpass.getpass("Password (again): ")
    if not first or first != second:
        parser.error("passwords are empty or do not match")
    print(json.dumps({email: generate_password_hash(first)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
