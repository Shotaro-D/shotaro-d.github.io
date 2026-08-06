#!/usr/bin/env python3
"""Create one password hash for APP_USERS_JSON without printing the password."""

from __future__ import annotations

import argparse
import getpass
import json
from werkzeug.security import generate_password_hash

MINIMUM_PASSWORD_LENGTH = 12


def password_meets_policy(password: str) -> bool:
    """Keep the locally generated credentials at a minimum passphrase length."""

    return len(password) >= MINIMUM_PASSWORD_LENGTH


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
    if not password_meets_policy(first):
        parser.error(f"passwords must be at least {MINIMUM_PASSWORD_LENGTH} characters long")
    print(json.dumps({email: generate_password_hash(first)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
