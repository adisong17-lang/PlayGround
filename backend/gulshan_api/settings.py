from dataclasses import dataclass
from pathlib import Path
import os
import secrets

from .security import hash_passphrase


DEFAULT_ORIGINS = (
    "http://localhost:3002",
    "http://127.0.0.1:3002",
)


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str
    session_secret: str
    passphrase_hash: str
    allowed_origins: tuple[str, ...]
    session_ttl_minutes: int = 30
    cookie_name: str = "gt_session"
    cookie_secure: bool = False
    state_file: Path | None = None
    login_max_attempts: int = 6
    login_window_seconds: int = 300
    uses_demo_passphrase: bool = False
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @classmethod
    def from_env(cls) -> "Settings":
        environment = os.getenv("GT_ENV", "development").strip().lower()
        production = environment == "production"

        session_secret = os.getenv("GT_SESSION_SECRET", "").strip()
        if not session_secret:
            if production:
                raise ValueError("GT_SESSION_SECRET is required in production.")
            session_secret = secrets.token_urlsafe(48)
        elif len(session_secret) < 32:
            raise ValueError("GT_SESSION_SECRET must be at least 32 characters.")

        passphrase_hash = os.getenv("GT_PASSPHRASE_HASH", "").strip()
        uses_demo_passphrase = False
        if not passphrase_hash:
            if production:
                raise ValueError("GT_PASSPHRASE_HASH is required in production.")
            passphrase_hash = hash_passphrase("demo")
            uses_demo_passphrase = True

        origins_raw = os.getenv("GT_ALLOWED_ORIGINS", ",".join(DEFAULT_ORIGINS))
        allowed_origins = tuple(
            origin.strip().rstrip("/")
            for origin in origins_raw.split(",")
            if origin.strip()
        )

        state_file_raw = os.getenv("GT_STATE_FILE", "").strip()
        state_file = (
            Path(state_file_raw).expanduser().resolve() if state_file_raw else None
        )

        return cls(
            environment=environment,
            session_secret=session_secret,
            passphrase_hash=passphrase_hash,
            allowed_origins=allowed_origins,
            session_ttl_minutes=int(os.getenv("GT_SESSION_TTL_MINUTES", "30")),
            cookie_name=os.getenv("GT_COOKIE_NAME", "gt_session"),
            cookie_secure=os.getenv("GT_COOKIE_SECURE", "1" if production else "0")
            == "1",
            state_file=state_file,
            login_max_attempts=int(os.getenv("GT_LOGIN_MAX_ATTEMPTS", "6")),
            login_window_seconds=int(os.getenv("GT_LOGIN_WINDOW_SECONDS", "300")),
            uses_demo_passphrase=uses_demo_passphrase,
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip() or None,
            telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip() or None,
        )
