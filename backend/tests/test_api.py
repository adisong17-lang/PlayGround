from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from gulshan_api.main import create_app
from gulshan_api.notifications import NotificationResult, TelegramNotifier
from gulshan_api.security import hash_passphrase
from gulshan_api.settings import Settings


PASSPHRASE = "correct-horse-battery-staple"


def build_settings(state_file: Path | None = None) -> Settings:
    return Settings(
        environment="test",
        session_secret="test-session-secret-" + "x" * 40,
        passphrase_hash=hash_passphrase(PASSPHRASE),
        allowed_origins=("http://localhost:3002",),
        session_ttl_minutes=30,
        cookie_secure=False,
        state_file=state_file,
        login_max_attempts=6,
        login_window_seconds=300,
    )


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(build_settings(tmp_path / "ledger.json"))
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient) -> str:
    response = client.post("/api/auth/login", json={"passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    assert "httponly" in response.headers["set-cookie"].lower()
    return response.json()["csrf_token"]


def csrf_headers(token: str, idempotency_key: str | None = None) -> dict[str, str]:
    headers = {"X-CSRF-Token": token}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def order_payload(**overrides):
    payload = {
        "symbol": "RELIANCE",
        "name": "Reliance Industries",
        "entry": 100.0,
        "stop": 95.0,
        "target": 115.0,
        "liquidity_cr": 50,
        "requested_qty": 100,
        "order_type": "MARKET",
        "signal_id": "sig-demo-1",
    }
    payload.update(overrides)
    return payload


def test_health_is_public_and_truthful(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "PAPER"
    assert body["live_execution"] == "DISABLED"
    assert body["broker_connected"] is False
    assert body["engine_connected"] is False
    assert body["telegram_configured"] is False
    assert "passphrase" not in response.text.lower()
    assert "secret" not in response.text.lower()


def test_authentication_and_protected_routes(client: TestClient) -> None:
    assert client.get("/api/account").status_code == 401
    assert client.get("/api/auth/session").status_code == 401

    wrong = client.post("/api/auth/login", json={"passphrase": "wrong-passphrase"})
    assert wrong.status_code == 401

    token = login(client)
    session = client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.json()["csrf_token"] == token


def test_mutating_routes_require_csrf(client: TestClient) -> None:
    login(client)
    response = client.post(
        "/api/orders/paper",
        json=order_payload(),
        headers={"Idempotency-Key": "csrf-missing-key"},
    )
    assert response.status_code == 403
    assert "CSRF" in response.json()["detail"]


def test_origin_allowlist_is_enforced(client: TestClient) -> None:
    token = login(client)
    response = client.post(
        "/api/orders/paper",
        json=order_payload(),
        headers={
            **csrf_headers(token, "origin-block-key"),
            "Origin": "https://attacker.example",
        },
    )
    assert response.status_code == 403


def test_risk_rejection_and_server_side_execution(client: TestClient) -> None:
    token = login(client)

    rejected = client.post(
        "/api/orders/paper",
        json=order_payload(requested_qty=500_000),
        headers=csrf_headers(token, "oversize-order-key"),
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"] == "Risk governor rejected the paper order."
    assert any(
        check["id"] == "sizing-cap" and not check["passed"]
        for check in rejected.json()["checks"]
    )

    first = client.post(
        "/api/orders/paper",
        json=order_payload(),
        headers=csrf_headers(token, "fill-order-key"),
    )
    assert first.status_code == 200, first.text
    filled = first.json()
    assert filled["replayed"] is False
    assert filled["order"]["status"] == "EXECUTED"
    assert filled["order"]["mode"] == "PAPER"
    assert filled["position"]["qty"] == 100

    replay = client.post(
        "/api/orders/paper",
        json=order_payload(),
        headers=csrf_headers(token, "fill-order-key"),
    )
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert len(client.get("/api/orders").json()) == 1

    duplicate = client.post(
        "/api/orders/paper",
        json=order_payload(),
        headers=csrf_headers(token, "duplicate-order-key"),
    )
    assert duplicate.status_code == 409
    assert any(
        check["id"] == "duplicate" and not check["passed"]
        for check in duplicate.json()["checks"]
    )

    account = client.get("/api/account").json()
    assert account["positions"][0]["symbol"] == "RELIANCE"
    assert account["cash"] < 1_000_000

    closed = client.post(
        f"/api/positions/{filled['position']['id']}/close",
        headers=csrf_headers(token),
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["order"]["side"] == "SELL"
    assert closed.json()["trade"]["symbol"] == "RELIANCE"
    assert client.get("/api/positions").json() == []
    assert len(client.get("/api/journal").json()["trades"]) == 1

    refreshed = client.get("/api/account").json()
    assert refreshed["positions"] == []
    assert refreshed["realized_pnl"] == pytest.approx(
        closed.json()["trade"]["pnl"],
        abs=0.01,
    )


def test_limit_order_requires_fillable_price(client: TestClient) -> None:
    token = login(client)
    response = client.post(
        "/api/orders/paper",
        json=order_payload(order_type="LIMIT", limit_price=90),
        headers=csrf_headers(token, "limit-order-key"),
    )
    assert response.status_code == 400


def test_risk_config_validation_and_update(client: TestClient) -> None:
    token = login(client)
    invalid = client.put(
        "/api/risk",
        json={
            **client.get("/api/risk").json(),
            "risk_per_trade_pct": 99,
        },
        headers=csrf_headers(token),
    )
    assert invalid.status_code == 422

    current = client.get("/api/risk").json()
    current["risk_per_trade_pct"] = 0.5
    current["max_open_positions"] = 5
    updated = client.put("/api/risk", json=current, headers=csrf_headers(token))
    assert updated.status_code == 200, updated.text
    assert updated.json()["max_open_positions"] == 5


def test_logout_invalidates_session(client: TestClient) -> None:
    token = login(client)
    response = client.post("/api/auth/logout", headers=csrf_headers(token))
    assert response.status_code == 200
    assert client.get("/api/account").status_code == 401


def test_ledger_persists_across_app_restarts(tmp_path: Path) -> None:
    state_file = tmp_path / "persistent-ledger.json"
    first_app = create_app(build_settings(state_file))
    with TestClient(first_app) as first:
        token = login(first)
        created = first.post(
            "/api/orders/paper",
            json=order_payload(),
            headers=csrf_headers(token, "persistent-order-key"),
        )
        assert created.status_code == 200

    second_app = create_app(build_settings(state_file))
    with TestClient(second_app) as second:
        login(second)
        positions = second.get("/api/positions").json()
        assert len(positions) == 1
        assert positions[0]["symbol"] == "RELIANCE"


def test_production_requires_explicit_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GT_ENV", "production")
    monkeypatch.delenv("GT_SESSION_SECRET", raising=False)
    monkeypatch.delenv("GT_PASSPHRASE_HASH", raising=False)
    with pytest.raises(ValueError, match="GT_SESSION_SECRET"):
        Settings.from_env()


def test_telegram_status_offline_by_default(client: TestClient) -> None:
    token = login(client)
    status = client.get("/api/notifications/telegram")
    assert status.status_code == 200
    assert status.json()["configured"] is False
    assert status.json()["chat_id"] is None

    blocked = client.post(
        "/api/notifications/telegram/test",
        headers=csrf_headers(token),
    )
    assert blocked.status_code == 409


def test_telegram_delivery_and_paper_alerts(tmp_path: Path) -> None:
    calls: list[str] = []

    class StubNotifier:
        configured = True
        masked_chat_id = "***6789"

        async def send(self, text: str) -> NotificationResult:
            calls.append(text)
            return NotificationResult(True, "Telegram message delivered.")

    app = create_app(build_settings(tmp_path / "telegram-ledger.json"))
    app.state.telegram = StubNotifier()
    with TestClient(app) as client:
        token = login(client)
        status = client.get("/api/notifications/telegram")
        assert status.json()["configured"] is True
        assert status.json()["chat_id"] == "***6789"
        assert client.get("/api/system").json()["telegram_configured"] is True

        delivery = client.post(
            "/api/notifications/telegram/test",
            headers=csrf_headers(token),
        )
        assert delivery.status_code == 200
        assert calls[-1].startswith("Gulshan Command Center:")

        filled = client.post(
            "/api/orders/paper",
            json=order_payload(),
            headers=csrf_headers(token, "telegram-fill-key"),
        )
        assert filled.status_code == 200
        assert calls[-1].startswith("PAPER FILL: RELIANCE")


def test_telegram_notifier_uses_expected_payload() -> None:
    received: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received["path"] = request.url.path
        received["payload"] = request.read()
        return httpx.Response(200, json={"ok": True})

    notifier = TelegramNotifier(
        token="123456789:" + "A" * 35,
        chat_id="123456789",
        transport=httpx.MockTransport(handler),
    )
    assert notifier.configured is True
    result = asyncio.run(notifier.send("paper alert"))
    assert result.delivered is True
    assert received["path"].endswith("/sendMessage")
    assert b"paper alert" in received["payload"]

    invalid = TelegramNotifier(
        "not-a-token", "123", transport=httpx.MockTransport(handler)
    )
    assert invalid.configured is False
