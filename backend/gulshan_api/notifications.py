from __future__ import annotations

from dataclasses import dataclass
import re

import httpx


TOKEN_PATTERN = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{20,}$")
CHAT_ID_PATTERN = re.compile(r"^-?\d{5,20}$")


@dataclass(frozen=True, slots=True)
class NotificationResult:
    delivered: bool
    detail: str


class TelegramNotifier:
    def __init__(
        self,
        token: str | None,
        chat_id: str | None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token.strip() if token else ""
        self._chat_id = chat_id.strip() if chat_id else ""
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(
            TOKEN_PATTERN.fullmatch(self._token)
            and CHAT_ID_PATTERN.fullmatch(self._chat_id)
        )

    @property
    def masked_chat_id(self) -> str | None:
        if not self._chat_id:
            return None
        return f"***{self._chat_id[-4:]}"

    async def send(self, text: str) -> NotificationResult:
        if not self.configured:
            return NotificationResult(False, "Telegram is not configured.")

        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        try:
            async with httpx.AsyncClient(
                timeout=6.0,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    url,
                    json={
                        "chat_id": self._chat_id,
                        "text": text[:4000],
                        "disable_web_page_preview": True,
                    },
                )
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return NotificationResult(False, "Telegram delivery failed.")

        if (
            response.status_code == 200
            and isinstance(payload, dict)
            and payload.get("ok") is True
        ):
            return NotificationResult(True, "Telegram message delivered.")
        return NotificationResult(False, "Telegram rejected the message.")
