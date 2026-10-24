from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, status

if TYPE_CHECKING:
    from .settings import Settings


PBKDF2_ITERATIONS = 310_000
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_passphrase(passphrase: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        iterations,
    )
    return f"pbkdf2_sha256${iterations}${_b64encode(salt)}${_b64encode(digest)}"


def verify_passphrase(passphrase: str, encoded: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        if iterations < 100_000 or iterations > 2_000_000:
            return False
        salt = _b64decode(salt_raw)
        expected = _b64decode(digest_raw)
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(actual, expected)


def _signature(secret: str, payload: str) -> str:
    return _b64encode(
        hmac.new(
            secret.encode("utf-8"),
            payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )


def issue_session(settings: Settings) -> tuple[str, str, int]:
    now = int(time.time())
    expires_at = now + settings.session_ttl_minutes * 60
    csrf_token = secrets.token_urlsafe(32)
    payload = _b64encode(
        json.dumps(
            {
                "sub": "operator",
                "iat": now,
                "exp": expires_at,
                "csrf": csrf_token,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    token = f"{payload}.{_signature(settings.session_secret, payload)}"
    return token, csrf_token, expires_at


def decode_session(settings: Settings, token: str | None) -> dict | None:
    if not token or token.count(".") != 1:
        return None
    payload, signature = token.split(".", 1)
    expected = _signature(settings.session_secret, payload)
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        data = json.loads(_b64decode(payload))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("sub") != "operator":
        return None
    if int(data.get("exp", 0)) <= int(time.time()):
        return None
    if not isinstance(data.get("csrf"), str) or len(data["csrf"]) < 24:
        return None
    return data


def require_session(request: Request) -> dict:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(settings.cookie_name)
    session = decode_session(settings, token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid server session is required.",
        )
    return session


def require_csrf(request: Request) -> dict:
    session = require_session(request)
    supplied = request.headers.get("x-csrf-token", "")
    if not supplied or not hmac.compare_digest(supplied, session["csrf"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token is missing or invalid.",
        )
    return session


def origin_is_allowed(settings: Settings, origin: str | None) -> bool:
    if not origin:
        return True
    return origin.rstrip("/") in settings.allowed_origins


class LoginLimiter:
    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, values: deque[float], now: float) -> None:
        cutoff = now - self.window_seconds
        while values and values[0] < cutoff:
            values.popleft()

    def retry_after(self, key: str) -> int | None:
        now = time.monotonic()
        with self._lock:
            values = self._attempts[key]
            self._prune(values, now)
            if len(values) < self.max_attempts:
                self._attempts.pop(key, None)
                return None
            return max(1, int(self.window_seconds - (now - values[0])))

    def fail(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            values = self._attempts[key]
            self._prune(values, now)
            values.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)
